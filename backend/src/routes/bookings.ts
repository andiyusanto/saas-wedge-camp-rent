import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { fetchActiveBookingItems, usedUnitsOn, marginDaysFromReadinessHours } from '../lib/availability.js';
import { dateRange, todayInTz, rentalDuration } from '../lib/dates.js';
import { logBookingStatus, resolveActorName } from '../lib/audit.js';
import { isBusinessWritable, SUBSCRIPTION_LOCKED_MESSAGE } from '../lib/subscription.js';
import { getCustomerPhotoSignedUrl } from '../lib/r2.js';
import { computeBundleComponentRatesSnapshot } from '../lib/pricing.js';
import { mergeDuplicateSaleItemRequests } from '../lib/saleItems.js';
import { validateDpPaid } from '../lib/validation.js';

const router = Router();

// subtotal (migration 034) dikirim sudah terhitung dari frontend (lewat
// computeItemRentalPrice(), sama pola trust-the-client seperti total_price
// di bawah — backend tidak pernah validasi/hitung ulang harga sendiri)
// dan disimpan apa adanya sebagai snapshot booking_items.subtotal.
//
// day2_rate_at_booking..extra_day_rate_at_booking SEBALIKNYA tidak pernah
// diterima dari klien — selalu diisi di bawah dari itemRow (tabel items
// SAAT INI), pola yang sama seperti price_at_booking. Dipakai nanti oleh
// denda keterlambatan bertingkat (lib/penalty.ts computeTieredLateFee,
// dipanggil dari routes/trackings.ts), yang TIDAK BOLEH baca harga
// katalog yang mungkin sudah vendor edit setelah transaksi ini dibuat.
// Paket Alat Tahap 1 (brief 15 Nov 2026, migration 064) -- 4 field
// penanda OPSIONAL, trust-the-client sama seperti subtotal (grouping
// key tampilan, bukan data sensitif). bundle_id DIVALIDASI di bawah
// harus milik business booking ini -- tolak kalau tidak (keamanan
// wajib dari koordinator 15 Nov 2026).
type BookingItemInput = {
  item_id: string;
  quantity: number;
  subtotal?: number;
  bundle_id?: string | null;
  bundle_instance_id?: string | null;
  bundle_name?: string | null;
  bundle_quantity?: number | null;
};

// Nomor booking (SWL-YYYYMMDD-NN) dibuat DI DALAM create_booking_atomic
// (migration 070, generate_booking_number_sql) sejak Simpan Transaksi
// Atomik Tahap 1 -- Express TIDAK LAGI menghasilkannya sendiri untuk
// jalur Catat Transaksi baru (fungsi generateBookingNumber() lama
// dihapus dari sini).

router.post('/bookings', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const {
    businessId,
    customer,
    customer_id,
    customer_photo_key,
    start_date,
    end_date,
    items,
    sale_items,
    deposit,
    total_price,
    dp_paid,
    dp_method,
  } = req.body ?? {};

  const requestedItems = items as BookingItemInput[] | undefined;

  if (
    !businessId ||
    (!customer_id && !customer?.name) ||
    !start_date ||
    !end_date ||
    !Array.isArray(requestedItems) ||
    requestedItems.length === 0
  ) {
    res.status(400).json({ error: 'Data tidak lengkap' });
    return;
  }

  if (end_date < start_date) {
    res.status(400).json({ error: 'Tanggal kembali harus setelah tanggal ambil' });
    return;
  }

  // Celah ditemukan koordinator 17 Nov 2026 (dari investigasi "Lebih Rp"
  // di Riwayat): endpoint ini sebelumnya percaya mentah dp_paid dari
  // client tanpa batas atas sama sekali -- bisa membuat booking BARU
  // langsung "lebih bayar" sejak lahir. total_price sendiri TETAP
  // dipercaya dari client (pola lama, tidak diubah -- harga final tetap
  // di tangan vendor, bisa override manual) -- validateDpPaid() CUMA
  // membandingkan dp_paid terhadap total_price yang SAMA-SAMA dikirim
  // client dalam satu payload ini, bukan menghitung ulang harga apa pun.
  const dpError = validateDpPaid(dp_paid, total_price);
  if (dpError) {
    res.status(400).json({ error: dpError });
    return;
  }
  const dpPaidNum = Number(dp_paid) || 0;
  const totalPriceNum = Number(total_price) || 0;

  // Jaminan uang tanpa jumlah bukan jaminan sungguhan — divalidasi di
  // sini (SEBELUM insert bookings/booking_items apa pun, supaya tidak
  // perlu rollback kalau gagal) sebagai penegak SERVER-SIDE, bukan cuma
  // andalan validasi form NewBookingModal.tsx — endpoint ini bisa saja
  // dipanggil langsung (mis. alur konfirmasi Pesanan Online lewat form
  // yang sama, lihat TrackingScreen.tsx, otomatis ikut tercakup karena
  // satu-satunya jalur POST /bookings). Jenis jaminan lain (KTP/SIM/dsb)
  // tidak disentuh — catatan identitas tetap opsional.
  if (deposit?.type === 'uang' && !(Number(deposit.amount) > 0)) {
    res.status(400).json({ error: 'Jumlah Deposit Uang wajib diisi (lebih dari 0) untuk jenis jaminan Uang.' });
    return;
  }

  const supabase = createRequestClient(req);

  // Catat Transaksi baru = "kerja baru" (DIKUNCI, rencana langganan) —
  // RLS (migration 044, business_is_writable di WITH CHECK bookings
  // INSERT) adalah penegak SEBENARNYA; pesan ramah di sini cuma supaya
  // vendor tidak melihat error RLS mentah.
  if (!(await isBusinessWritable(supabase, businessId))) {
    res.status(403).json({ error: SUBSCRIPTION_LOCKED_MESSAGE });
    return;
  }

  // Cara hitung durasi sewa (migration 049) — SELALU dibaca dari
  // businesses SERVER-SIDE (tidak pernah dipercaya dari body request),
  // dipakai dua hal: (1) tolak ambil=kembali hari sama kalau per_malam
  // (sama seperti Bilbo — frontend NewBookingModal juga sudah mencegah
  // ini di date picker, ini jaring pengaman server), (2) disimpan
  // sebagai SNAPSHOT di baris bookings yang dibuat, supaya kalau vendor
  // ganti pengaturan ini belakangan, transaksi yang SUDAH dibuat (nota,
  // struk WA, denda telat bertingkat) tidak pernah ikut berubah.
  const { data: bizRow, error: bizError } = await supabase
    .from('businesses')
    .select(
      'rental_day_mode, timezone, min_rental_days, max_rental_days, return_deadline_time, return_deadline_next_day, late_fee_mode, late_fee_per_hour, late_fee_per_hour_cap_enabled',
    )
    .eq('id', businessId)
    .maybeSingle();

  if (bizError || !bizRow) {
    res.status(400).json({ error: bizError?.message ?? 'Business tidak ditemukan' });
    return;
  }

  if (bizRow.rental_day_mode === 'per_malam' && end_date === start_date) {
    res.status(400).json({ error: 'Tanggal ambil dan kembali tidak boleh di hari yang sama.' });
    return;
  }

  // Paket minimal hari (migration 054) -- batas KERAS, berlaku juga untuk
  // walk-in (Catat Transaksi). Maksimal SENGAJA tidak ditolak di sini --
  // itu cuma batas paket (NewBookingModal.tsx auto-fill + peringatan),
  // walk-in boleh melewatinya (lihat brief Tahap 1).
  if (bizRow.min_rental_days != null) {
    const rentalDays = rentalDuration(start_date, end_date, bizRow.rental_day_mode);
    if (rentalDays < bizRow.min_rental_days) {
      res.status(400).json({ error: `Minimal sewa ${bizRow.min_rental_days} hari.` });
      return;
    }
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from('items')
    .select('id, name, total_units, price_per_day, readiness_hours, day2_rate, day3_rate, day4_rate, day5_rate, extra_day_rate')
    .in('id', requestedItems.map((i) => i.item_id));

  if (itemsError) {
    res.status(400).json({ error: itemsError.message });
    return;
  }

  // Keamanan wajib (koordinator 15 Nov 2026): bundle_id yang dikirim
  // klien harus milik business booking ini -- tolak kalau tidak (jangan
  // andalkan RLS saja, pola sama CLAUDE.md bag 7 untuk query berpotensi
  // lintas-business).
  const requestedBundleIds = [...new Set(requestedItems.map((i) => i.bundle_id).filter((v): v is string => !!v))];
  if (requestedBundleIds.length > 0) {
    const { data: bundleRows, error: bundleError } = await supabase
      .from('bundles')
      .select('id')
      .eq('business_id', businessId)
      .in('id', requestedBundleIds);
    if (bundleError || (bundleRows ?? []).length !== requestedBundleIds.length) {
      res.status(400).json({ error: 'Paket tidak valid atau bukan milik usaha ini.' });
      return;
    }
  }

  const days = dateRange(start_date, end_date);
  // N hari yang sama dipakai frontend saat menghitung subtotal paket
  // (computeItemRentalPrice dengan rentalDuration -- ikut mode per_malam
  // / per_hari_kalender), bukan jumlah hari kalender dari dateRange().
  const rentDuration = rentalDuration(start_date, end_date, bizRow.rental_day_mode);

  let existingBookingItems;
  try {
    existingBookingItems = await fetchActiveBookingItems(supabase, businessId, {
      windowStart: start_date,
      windowEnd: end_date,
      marginDays: marginDaysFromReadinessHours((itemRows ?? []).map((i) => i.readiness_hours)),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  // Paket Alat (migration 064) membuat item_id yang sama bisa muncul di
  // lebih dari satu baris requestedItems dalam SATU request (mis. alat
  // dipilih manual DAN ikut dalam resep paket lain) -- jumlahkan dulu
  // per item_id sebelum validasi stok, supaya tidak under-count
  // permintaan gabungannya (tiap baris dicek sendiri-sendiri terhadap
  // "used" yang sama akan lolos walau totalnya sebenarnya melebihi stok).
  const requestedQuantityByItemId = new Map<string, number>();
  for (const requested of requestedItems) {
    requestedQuantityByItemId.set(requested.item_id, (requestedQuantityByItemId.get(requested.item_id) ?? 0) + requested.quantity);
  }

  for (const [itemId, totalQuantity] of requestedQuantityByItemId) {
    const itemRow = itemRows?.find((i) => i.id === itemId);
    if (!itemRow) {
      res.status(400).json({ error: 'Alat tidak ditemukan' });
      return;
    }

    for (const day of days) {
      const used = usedUnitsOn(existingBookingItems, itemId, day, itemRow.readiness_hours, bizRow.timezone);
      if (used + totalQuantity > itemRow.total_units) {
        res.status(409).json({
          error: `Alat "${itemRow.name}" tidak cukup pada ${day} (sisa ${itemRow.total_units - used}, diminta ${totalQuantity})`,
        });
        return;
      }
    }
  }

  // Jalan diambil hari ini -> langsung 'aktif' (alur walk-in biasa).
  // Tanggal ambil di masa depan -> 'dipesan' (reservasi, belum diambil
  // fisik). status DIHITUNG di Express (butuh todayInTz/timezone bisnis)
  // tapi picked_up_at-nya sendiri SEKARANG dihitung DI DALAM
  // create_booking_atomic() (migration 070, revisi koordinator 17 Nov
  // 2026) -- jam dicatat persis saat RPC itu COMMIT, bukan saat Express
  // menyusun payload (beberapa ratus ms sebelumnya), dan tidak bisa
  // dimanipulasi lewat pemanggilan RPC langsung.
  const status = start_date <= todayInTz(bizRow.timezone) ? 'aktif' : 'dipesan';

  // Audit privasi 2 Nov 2026 — validasi pola key SEBELUM dikirim ke RPC,
  // jangan cuma percaya migration 050's check constraint sebagai
  // satu-satunya penjaga. Key yang tidak cocok pola diam-diam dibuang
  // jadi null, bukan membuat seluruh transaksi gagal — foto penyewa
  // cuma opsional.
  const customerPhotoKeyPrefix = `customers/${businessId}/`;
  const safeCustomerPhotoKey =
    typeof customer_photo_key === 'string' &&
    customer_photo_key.startsWith(customerPhotoKeyPrefix) &&
    !customer_photo_key.includes('..')
      ? customer_photo_key
      : null;

  // Simpan Transaksi Atomik Tahap 1 (brief 17 Nov 2026, migration 070) --
  // SELURUH penulisan (customer/booking/booking_items/deposit/barang
  // jual/riwayat status) SEKARANG satu panggilan RPC SECURITY DEFINER
  // yang mengunci business (pg_advisory_xact_lock), mengecek ULANG stok
  // DI DALAM kunci itu (sumber kebenaran -- pre-check Express di atas
  // cuma fast-path pesan ramah lebih awal, bisa saja sudah basi kalau
  // ada request lain menyelip di antaranya), lalu insert semuanya dalam
  // SATU transaksi -- TIDAK ADA LAGI compensating delete manual di sini
  // sama sekali (4 blok lama dihapus): kalau RPC gagal di langkah mana
  // pun, Postgres sendiri yang rollback seluruh transaksi, termasuk
  // trigger log_initial_dp_payment() (067) yang sebelumnya bisa
  // meninggalkan baris booking_payments yatim kalau unwind manual gagal.
  //
  // Harga/tarif bertingkat/alokasi paket TETAP dihitung di sini
  // (TypeScript, lib/pricing.ts) -- RPC cuma menerima p_items yang SUDAH
  // berisi price_at_booking/subtotal/dst siap pakai, TIDAK menghitung
  // ulang apa pun (jangan duplikasi rumus harga ke SQL, brief eksplisit).
  const bookingItemsPayload = requestedItems.map((i) => {
    const itemRow = itemRows!.find((r) => r.id === i.item_id)!;
    const catalogRates = {
      price_per_day: itemRow.price_per_day,
      day2_rate: itemRow.day2_rate,
      day3_rate: itemRow.day3_rate,
      day4_rate: itemRow.day4_rate,
      day5_rate: itemRow.day5_rate,
      extra_day_rate: itemRow.extra_day_rate,
    };
    const subtotal = typeof i.subtotal === 'number' ? i.subtotal : null;
    // Baris berpenanda paket (migration 064, keputusan koordinator 15
    // Nov 2026): *_at_booking BUKAN tarif katalog asli, melainkan tarif
    // katalog × rasio alokasi (lihat computeBundleComponentRatesSnapshot)
    // -- supaya denda telat, Perpanjang, dan Ubah Jadwal mengikuti
    // "harga paket", bukan melompat ke harga katalog alat satuan saat
    // dihitung ulang untuk hari tambahan.
    const rates =
      i.bundle_id && subtotal != null
        ? computeBundleComponentRatesSnapshot(catalogRates, i.quantity, rentDuration, subtotal)
        : catalogRates;
    return {
      item_id: i.item_id,
      quantity: i.quantity,
      price_at_booking: rates.price_per_day,
      subtotal,
      // Snapshot tarif bertingkat (migration 034) — SERVER-SIDE dari
      // tabel items saat ini (atau rasio alokasi paket di atas), BUKAN
      // dari input klien, supaya denda telat (lib/penalty.ts) tidak
      // pernah membaca harga yang bisa dimanipulasi klien.
      day2_rate_at_booking: rates.day2_rate,
      day3_rate_at_booking: rates.day3_rate,
      day4_rate_at_booking: rates.day4_rate,
      day5_rate_at_booking: rates.day5_rate,
      extra_day_rate_at_booking: rates.extra_day_rate,
      bundle_id: i.bundle_id ?? null,
      bundle_instance_id: i.bundle_instance_id ?? null,
      bundle_name: i.bundle_id ? (i.bundle_name ?? null) : null,
      bundle_quantity: i.bundle_id ? (i.bundle_quantity ?? null) : null,
    };
  });

  const requestedSaleItems = sale_items as { sale_item_id: string; quantity: number }[] | undefined;
  const mergedSaleItems =
    Array.isArray(requestedSaleItems) && requestedSaleItems.length > 0
      ? mergeDuplicateSaleItemRequests(requestedSaleItems)
      : null;

  const { data: actorData } = await supabase.auth.getUser();

  // Revisi koordinator (ronde 2): p_actor_user_id DIHAPUS -- RPC pakai
  // auth.uid() sendiri untuk booking_status_history.changed_by (member
  // bisa memalsukan id lewat payload kalau dipercaya dari sini).
  // rental_day_mode/min-max_rental_days/return_deadline_*/late_fee_*
  // JUGA DIHAPUS dari payload -- RPC membaca businesses LANGSUNG di
  // dalam kunci yang sama (bizRow di atas tetap dipakai Express buat
  // validasi awal per_malam/min hari, bukan buat payload RPC lagi).
  const { data: rpcRows, error: rpcError } = await supabase.rpc('create_booking_atomic', {
    p_business_id: businessId,
    p_customer_id: customer_id ?? null,
    p_customer_name: customer_id ? null : customer.name,
    p_customer_phone: customer_id ? null : (customer.phone ?? null),
    p_customer_address: customer_id ? null : (customer.address ?? null),
    p_customer_photo_key: safeCustomerPhotoKey,
    p_start_date: start_date,
    p_end_date: end_date,
    p_status: status,
    p_total_price: totalPriceNum,
    p_dp_paid: dpPaidNum,
    p_dp_method: ['tunai', 'transfer', 'qris'].includes(dp_method) ? dp_method : null,
    p_items: bookingItemsPayload,
    p_deposit: deposit?.type
      ? { type: deposit.type, amount: deposit.type === 'uang' ? Number(deposit.amount) || 0 : null, note: deposit.note ?? null }
      : null,
    p_sale_items: mergedSaleItems,
    p_actor_name: actorData.user?.email ?? actorData.user?.id ?? 'tidak diketahui',
  });

  if (rpcError) {
    // Error stok (SQLSTATE custom 'P0409', lihat migration 070) -> 409,
    // pesan sudah ramah (nama alat + tanggal + sisa/diminta) apa adanya
    // dari RPC. Selain itu -> 400 (validasi/kepemilikan/dsb).
    res.status(rpcError.code === 'P0409' ? 409 : 400).json({ error: rpcError.message });
    return;
  }

  const bookingRow = rpcRows?.[0];
  if (!bookingRow) {
    res.status(400).json({ error: 'Gagal menyimpan transaksi' });
    return;
  }

  res.status(201).json({ id: bookingRow.booking_id, booking_number: bookingRow.booking_number, status: bookingRow.status });
});

// Audit privasi 2 Nov 2026 — satu-satunya jalur baca foto penyewa.
// bookings.customer_photo_key (migration 050) BUKAN url yang bisa
// langsung dipakai — klien SELALU minta link baru lewat endpoint ini
// tiap kali mau menampilkan foto (TrackingScreen.tsx), tidak pernah
// menyimpan/memakai ulang link lama. RLS (createRequestClient, scoped
// ke JWT pemanggil) sudah otomatis membatasi .select() di bawah ke
// booking milik business caller sendiri — booking milik business lain
// tidak akan pernah kelihatan sama sekali (bukan "ditolak", tapi
// "tidak ada" dari sudut pandang caller), pola yang sama seperti
// endpoint pickup di atas. Validasi pola key diulang eksplisit di sini
// (bukan cuma percaya check constraint migration 050) sebelum
// menandatangani — review -c1: defense in depth, jangan andalkan satu
// lapis saja.
router.get('/bookings/:id/customer-photo', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const supabase = createRequestClient(req);

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, business_id, customer_photo_key')
    .eq('id', id)
    .maybeSingle();

  if (bookingError || !booking) {
    res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    return;
  }

  if (!booking.customer_photo_key) {
    res.status(404).json({ error: 'Transaksi ini tidak punya foto penyewa' });
    return;
  }

  const expectedPrefix = `customers/${booking.business_id}/`;
  if (!booking.customer_photo_key.startsWith(expectedPrefix) || booking.customer_photo_key.includes('..')) {
    // Seharusnya tidak pernah terjadi (migration 050's check constraint
    // + validasi saat insert di POST /bookings di atas) — kalau sampai
    // terjadi, JANGAN tandatangani, lebih baik gagal daripada menyajikan
    // foto yang mungkin bukan milik business ini.
    res.status(500).json({ error: 'Data foto tidak valid, hubungi dukungan Sewalog.' });
    return;
  }

  try {
    const url = await getCustomerPhotoSignedUrl(booking.customer_photo_key);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/bookings/:id/pickup', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const { deposit, payment } = (req.body ?? {}) as {
    deposit?: { type: string; amount?: number; note?: string | null } | null;
    payment?: { amount: number; method?: string | null; note?: string | null } | null;
  };
  const supabase = createRequestClient(req);

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, status, business_id')
    .eq('id', id)
    .maybeSingle();

  if (bookingError || !booking) {
    res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    return;
  }

  if (booking.status !== 'dipesan') {
    res.status(400).json({ error: 'Transaksi ini bukan status "dipesan"' });
    return;
  }

  // Dialog konfirmasi jaminan saat Ambil (brief 15 Nov 2026, Bagian B) —
  // validasi payload SEBELUM menulis apa pun, pola sama POST /bookings.
  if (deposit?.type === 'uang' && !(Number(deposit.amount) > 0)) {
    res.status(400).json({ error: 'Jumlah Deposit Uang wajib diisi (lebih dari 0) untuk jenis jaminan Uang.' });
    return;
  }

  // Review -c1 poin 1: tulis/ubah jaminan DULU, baru ubah status ke
  // 'aktif' — kalau update status di bawah gagal, transaksi tetap
  // 'dipesan' dengan jaminan yang sudah benar tersimpan (aman diulang,
  // staf cukup tekan Ambil lagi). Urutan terbalik (status dulu) bisa
  // meninggalkan transaksi 'aktif' tanpa jaminan tercatat kalau tulis
  // jaminan gagal belakangan — lebih berisiko daripada sebaliknya.
  //
  // Baris deposits existing (dari Catat Transaksi, "rencana" jaminan)
  // DI-UPDATE kalau vendor ganti jenisnya di dialog — bukan insert baris
  // baru. Booking yang belum punya jaminan sama sekali (mis. dari
  // Pesanan Online tanpa jaminan) dapat baris baru. "Tanpa jaminan"
  // (deposit null/tidak dikirim) kalau SUDAH ada baris existing TIDAK
  // menghapusnya — tidak ada jalur hapus deposit di aplikasi ini sama
  // sekali, di luar cakupan brief ini (keputusan Andi 15 Nov 2026).
  if (deposit?.type) {
    const { data: existingDeposit } = await supabase
      .from('deposits')
      .select('id')
      .eq('booking_id', id)
      .eq('status', 'ditahan')
      .maybeSingle();

    const depositPayload = {
      type: deposit.type,
      amount: deposit.type === 'uang' ? Number(deposit.amount) || 0 : null,
      note: deposit.note ?? null,
    };

    const { error: depositError } = existingDeposit
      ? await supabase.from('deposits').update(depositPayload).eq('id', existingDeposit.id)
      : await supabase.from('deposits').insert({ booking_id: id, status: 'ditahan', ...depositPayload });

    if (depositError) {
      res.status(400).json({ error: depositError.message });
      return;
    }
  }

  // Jam pengambilan sungguhan (migration 027) — sebelumnya endpoint ini
  // cuma pindah status, tidak pernah menyimpan momen ambil fisik yang
  // nyata, jadi computeDueAt() (lib/penalty.ts) terpaksa jatuh balik ke
  // created_at (jam booking DICATAT, bisa berhari-hari sebelum pengambilan
  // sungguhan untuk booking yang dipesan duluan) — celah yang ditutup di sini.
  //
  // TIDAK ada cek business_is_writable di sini (keputusan Andi, migration
  // 044: pickup/return/cancel + SEMUA operasi deposits termasuk
  // "selesaikan transaksi berjalan" yang TETAP terbuka walau akun
  // hanya-baca) — jangan tambahkan cek writable baru di jalur ini.
  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'aktif', picked_up_at: new Date().toISOString() })
    .eq('id', id);

  if (updateError) {
    res.status(400).json({ error: updateError.message });
    return;
  }

  const { data: actorData } = await supabase.auth.getUser();
  if (actorData.user) {
    await logBookingStatus(supabase, id, 'aktif', actorData.user.id, actorData.user.email ?? actorData.user.id);
  }

  // "Lunasi sekarang" di PickupConfirmModal (brief 17 Nov 2026) — LANGKAH
  // TERAKHIR, non-blocking: status+jaminan di atas SUDAH tersimpan duluan
  // (pola yang sama seperti restore_sale_item_stock_for_booking saat
  // Batalkan) — kalau pelunasan gagal (mis. race sisa tagihan berubah),
  // pickup TETAP sukses, staf cukup pakai "Catat Pembayaran" manual
  // belakangan. Dicatat kind='pelunasan' (bukan 'dp' — itu cuma untuk
  // trigger DP awal saat booking dibuat).
  let paymentWarning: string | null = null;
  if (payment && Number(payment.amount) > 0) {
    const actorName = actorData.user
      ? await resolveActorName(supabase, booking.business_id, actorData.user.id, actorData.user.email ?? actorData.user.id)
      : 'Konfirmasi Ambil';
    const { error: paymentError } = await supabase.rpc('add_booking_payment', {
      p_booking_id: id,
      p_amount: Number(payment.amount),
      p_method: payment.method ?? null,
      p_note: payment.note ?? null,
      p_kind: 'pelunasan',
      p_created_by_name: actorName,
    });
    if (paymentError) {
      console.error(`add_booking_payment gagal saat pickup booking ${id}:`, paymentError.message);
      paymentWarning = 'Barang sudah ditandai diambil, tapi pelunasan gagal dicatat — coba lagi lewat Catat Pembayaran.';
    }
  }

  res.json({ ok: true, paymentWarning });
});

export default router;
