import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createAnonClient } from '../lib/supabaseClient.js';
import { todayInTz, tzOffsetIso, rentalDuration } from '../lib/dates.js';
import { computeItemRentalPrice } from '../lib/pricing.js';
import { normalizePhone } from '../lib/phone.js';
import { sendPushToBusiness, buildNewOrderPayload } from '../lib/webPush.js';
import {
  MAX_ITEMS_PER_REQUEST,
  validateSubmitRows,
  mergeDuplicateItems,
  mergeDuplicateBundles,
  explodeBundleRow,
} from '../lib/bundleBookingRequest.js';
import type { PublicPageBundle, ExplodedRow } from '../lib/bundleBookingRequest.js';

const router = Router();

// Rencana 2.7: anti-spam untuk endpoint publik (Bilbo tidak punya proteksi
// ini sama sekali, lihat research/etalase-online-ordering-plan-2026-10.md
// bagian 1.5 — murni usulan baru di sini). Dua rate-limiter terpisah:
// per-IP lintas semua vendor (mencegah satu penyerang membanjiri banyak
// vendor), dan per-slug (mencegah satu vendor dibanjiri meski IP
// bervariasi, mis. lewat proxy/botnet kecil).
const perIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak pesanan dari koneksi ini, coba lagi dalam 1 jam.' },
});

// Review -c1 (ronde ketiga): SEBELUMNYA setiap request (termasuk yang
// gagal validasi) ikut dihitung — 15 request sampah dari beberapa IP
// bisa mengunci SEMUA pelanggan sungguhan satu vendor selama sejam. Dan
// mencatat SETIAP slug (termasuk yang salah ketik/acak) bikin Map ini
// tumbuh tak terbatas. Diperbaiki: `peekSlugLimitExceeded` cuma MEMBACA
// (dipanggil di awal handler, sebelum slug diketahui valid — kalau
// belum pernah ada entri, otomatis tidak exceeded, TIDAK menulis apa
// pun ke Map), dan `recordSlugAttempt` cuma dipanggil SETELAH insert ke
// create_booking_request benar-benar sukses (lihat pemanggilannya di
// bawah) — jadi Map ini hanya pernah berisi slug yang valid DAN cuma
// bertambah untuk pesanan yang benar-benar tersimpan.
const slugAttempts = new Map<string, number[]>();
const SLUG_WINDOW_MS = 60 * 60 * 1000;
const SLUG_MAX_PER_HOUR = 15;

function peekSlugLimitExceeded(slug: string): boolean {
  const now = Date.now();
  const timestamps = (slugAttempts.get(slug) ?? []).filter((t) => now - t < SLUG_WINDOW_MS);
  return timestamps.length >= SLUG_MAX_PER_HOUR;
}

function recordSlugAttempt(slug: string): void {
  const now = Date.now();
  const timestamps = (slugAttempts.get(slug) ?? []).filter((t) => now - t < SLUG_WINDOW_MS);
  timestamps.push(now);
  slugAttempts.set(slug, timestamps);
}

// Format sama longgarnya dengan yang dipakai manusia menulis nomor WA di
// Indonesia (08xx / +62xx / 62xx), tanpa karakter selain digit/spasi/+/-.
// Tidak ada validasi format nomor WA di form Catat Transaksi internal
// (routes/bookings.ts tidak memvalidasi phone sama sekali, cuma field
// bebas), jadi ini validasi BARU, bukan reuse, khusus endpoint publik ini
// karena di sini sumbernya tidak tepercaya (siapa saja tanpa login).
const PHONE_RE = /^(\+?62|0)8[0-9]{8,12}$/;

// normalizePhone() dipindah ke lib/phone.ts (brief 23 Nov 2026) supaya
// dipakai ulang oleh POST /bookings juga, bukan diduplikasi di sini.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Bentuk items[] dari get_public_page (019) — sudah difilter aktif saja
// di dalam RPC itu sendiri (deactivated_at is null), jadi "item tidak ada
// di daftar ini" = "tidak valid untuk dipesan", tidak perlu cek
// deactivated_at terpisah.
type PublicPageItem = {
  id: string;
  name: string;
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
};

// Bentuk hasil get_public_availability (028) — remaining sudah dihitung
// dengan logic SAMA PERSIS seperti usedUnitsOn() (readiness_hours
// termasuk), titik TERBURUK (minimum) di sepanjang rentang tanggal — ini
// SATU-SATUNYA sumber kebenaran ketersediaan publik (CLAUDE.md bagian 6:
// jalur ini dan usedUnitsOn() WAJIB selalu sepakat), yang sama dipakai
// pelanggan untuk melihat "Sisa X unit" di halaman Etalase SEBELUM
// memesan — jadi validasi stok di sini otomatis konsisten dengan apa
// yang sudah mereka lihat, bukan sumber kedua yang bisa berbeda.
type PublicAvailabilityItem = { id: string; total_units: number; remaining: number };

router.post('/public/booking-requests/:slug', perIpLimiter, async (req, res) => {
  const { slug } = req.params;

  if (peekSlugLimitExceeded(slug)) {
    res.status(429).json({ error: 'Terlalu banyak pesanan untuk toko ini, coba lagi nanti atau hubungi lewat WhatsApp.' });
    return;
  }

  const {
    customer_name,
    customer_phone,
    note,
    start_date,
    end_date,
    items,
    payment_method,
    terms_version_id, // Syarat & Ketentuan (migration 047) — null kalau toko tidak punya syarat
    website, // honeypot — field tersembunyi di form, manusia tidak akan mengisinya
  } = req.body ?? {};

  // Honeypot: balas sukses palsu (jangan beri tahu bot kenapa gagal),
  // tapi jangan proses apa pun.
  if (typeof website === 'string' && website.trim().length > 0) {
    res.status(201).json({ token: '00000000-0000-0000-0000-000000000000' });
    return;
  }

  const validatedRows = validateSubmitRows(items);

  if (
    typeof customer_name !== 'string' || customer_name.trim().length < 1 || customer_name.length > 100 ||
    typeof customer_phone !== 'string' ||
    typeof start_date !== 'string' || !DATE_RE.test(start_date) ||
    typeof end_date !== 'string' || !DATE_RE.test(end_date) ||
    !validatedRows ||
    typeof payment_method !== 'string'
  ) {
    res.status(400).json({ error: 'Data pesanan tidak lengkap.' });
    return;
  }

  // Paket Alat Tahap 2: array gabungan baris alat satuan + baris paket
  // (pre-explosion) — batas jumlah BARIS keranjang tetap dicek di sini
  // (bukan jumlah unit, yang baru diketahui setelah paket dipecah di
  // bawah).
  if (validatedRows.items.length + validatedRows.bundles.length > MAX_ITEMS_PER_REQUEST) {
    res.status(400).json({ error: 'Terlalu banyak baris di keranjang (maks 20 baris per pesanan).' });
    return;
  }

  const requestedItems = mergeDuplicateItems(validatedRows.items);
  const requestedBundles = mergeDuplicateBundles(validatedRows.bundles);

  const normalizedPhone = normalizePhone(customer_phone);
  if (!PHONE_RE.test(normalizedPhone)) {
    res.status(400).json({ error: 'Nomor WhatsApp tidak valid. Pakai format 08xx atau +62xx.' });
    return;
  }

  if (end_date < start_date) {
    res.status(400).json({ error: 'Tanggal kembali tidak boleh sebelum tanggal ambil.' });
    return;
  }

  if (typeof note === 'string' && note.length > 500) {
    res.status(400).json({ error: 'Catatan terlalu panjang.' });
    return;
  }

  const supabase = createAnonClient();

  // get_public_page (019) tidak membawa business_id/payment info — butuh
  // business_id asli + flag accept_online_orders + konfigurasi bayar
  // untuk validasi di sini. Dibuat function tipis baru (bukan query tabel
  // langsung lewat anon — lihat larangan di komentar createAnonClient())
  // supaya tetap lewat satu titik SECURITY DEFINER yang kolomnya dibatasi
  // eksplisit, pola sama seperti get_public_page.
  const { data: pageData, error: pageError } = await supabase.rpc('get_public_ordering_page', { p_slug: slug });
  if (pageError || !pageData) {
    res.status(404).json({ error: 'Toko tidak ditemukan atau belum menerima pesanan online.' });
    return;
  }
  const page = pageData as {
    business_id: string;
    pay_transfer_enabled: boolean;
    pay_qris_enabled: boolean;
    pay_cash_enabled: boolean;
    confirmation_deadline_hours: number;
    rental_day_mode: 'per_malam' | 'per_hari_kalender';
    timezone?: string | null; // migration 053; undefined sebelum 053 = WIB
    min_rental_days?: number | null; // migration 054
    max_rental_days?: number | null; // migration 054
  };

  // Review -c1: ambil hari ini sendiri tidak masuk akal untuk pesanan
  // online (perlu dikonfirmasi vendor dulu, lalu DP/instruksi bayar, baru
  // benar-benar diambil — proses itu tidak realistis selesai dalam
  // hitungan jam yang sama). Ditolak dengan pesan ramah di sini, BUKAN
  // dibiarkan lolos ke expiresAt yang sudah lewat (lihat di bawah) yang
  // akan membuat create_booking_request menolak dengan pesan server
  // mentah. Form publik (tahap 3) akan menegakkan ini juga di sisi UI
  // (minimal tanggal ambil = besok), tapi validasi di sini tetap wajib
  // berdiri sendiri terlepas dari form.
  // "Hari ini" di zona rental (migration 053), bukan selalu WIB — makanya
  // dicek SETELAH get_public_ordering_page (butuh page.timezone).
  const todayWib = todayInTz(page.timezone);
  if (start_date <= todayWib) {
    res.status(400).json({
      error:
        start_date < todayWib
          ? 'Tanggal ambil sudah lewat.'
          : 'Untuk ambil hari ini, hubungi rental langsung lewat WhatsApp.',
    });
    return;
  }

  // Cara hitung durasi sewa (migration 049) — tolak ambil=kembali hari
  // sama kalau per_malam, SEBELUM dihitung apa pun (estimasi harga,
  // expiresAt, dsb) — pesan ramah di sini, create_booking_request
  // sendiri juga menolak dengan pesan server mentah sebagai jaring
  // pengaman defense-in-depth (lihat migration 049).
  if (page.rental_day_mode === 'per_malam' && start_date === end_date) {
    res.status(400).json({ error: 'Tanggal ambil dan kembali tidak boleh di hari yang sama.' });
    return;
  }

  if (
    (payment_method === 'transfer' && !page.pay_transfer_enabled) ||
    (payment_method === 'qris' && !page.pay_qris_enabled) ||
    (payment_method === 'cash' && !page.pay_cash_enabled) ||
    !['transfer', 'qris', 'cash'].includes(payment_method)
  ) {
    res.status(400).json({ error: 'Cara bayar yang dipilih tidak tersedia di toko ini.' });
    return;
  }

  const secret = process.env.BOOKING_REQUEST_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server belum terkonfigurasi untuk pesanan online.' });
    return;
  }

  // Review -c1 (ronde kedua): JANGAN tambah RPC secret-gated baru untuk
  // validasi item/stok — dua RPC publik yang SUDAH ADA menutupi ini
  // persis: get_public_page (019, items[] harga+hanya item aktif) dan
  // get_public_availability (021/028, remaining per item dihitung PERSIS
  // sama seperti usedUnitsOn() termasuk readiness_hours, titik TERBURUK
  // di sepanjang rentang). Ini SATU sumber kebenaran ketersediaan yang
  // sama dengan yang pelanggan sudah lihat di halaman Etalase sebelum
  // memesan — bukan jalur baca kedua yang bisa berbeda, dan tidak
  // membuka data booking_items lintas status yang tidak perlu diketahui
  // publik (yang sempat terjadi di pendekatan RPC baru sebelumnya).
  const { data: fullPageData, error: fullPageError } = await supabase.rpc('get_public_page', { p_slug: slug });
  if (fullPageError || !fullPageData) {
    res.status(404).json({ error: 'Toko tidak ditemukan.' });
    return;
  }
  const catalogItems = (fullPageData as { items: PublicPageItem[]; bundles?: PublicPageBundle[] }).items;
  const catalogBundles = (fullPageData as { items: PublicPageItem[]; bundles?: PublicPageBundle[] }).bundles ?? [];
  const catalogRatesByItemId = new Map(
    (catalogItems ?? []).map((i) => [
      i.id,
      {
        price_per_day: i.price_per_day,
        day2_rate: i.day2_rate,
        day3_rate: i.day3_rate,
        day4_rate: i.day4_rate,
        day5_rate: i.day5_rate,
        extra_day_rate: i.extra_day_rate,
      },
    ]),
  );

  const { data: availabilityRaw, error: availabilityError } = await supabase.rpc('get_public_availability', {
    p_slug: slug,
    p_start_date: start_date,
    p_end_date: end_date,
  });
  if (availabilityError || !availabilityRaw) {
    res.status(400).json({ error: 'Gagal mengecek ketersediaan.' });
    return;
  }
  const availability = availabilityRaw as unknown as PublicAvailabilityItem[];

  // Cara hitung durasi sewa (migration 049) — pakai setting LIVE toko
  // ini (page.rental_day_mode), karena pesanan ini BARU DIBUAT sekarang
  // (belum ada baris bookings untuk disnapshot — itu baru terjadi saat
  // vendor Konfirmasi lewat Catat Transaksi biasa, lihat routes/bookings.ts).
  const rentalDaysCount = rentalDuration(start_date, end_date, page.rental_day_mode);

  // Paket minimal/maksimal hari (migration 054) -- Pesanan Online DIBLOKIR
  // di luar rentang paket (beda dari walk-in di routes/bookings.ts, yang
  // cuma menolak di bawah min dan membiarkan di atas max). create_booking_
  // request menegakkan ulang ini server-side sebagai jaring pengaman.
  if (page.min_rental_days != null && rentalDaysCount < page.min_rental_days) {
    res.status(400).json({ error: `Minimal sewa ${page.min_rental_days} hari.` });
    return;
  }
  if (page.max_rental_days != null && rentalDaysCount > page.max_rental_days) {
    res.status(400).json({ error: `Maksimal sewa ${page.max_rental_days} hari untuk pesanan online.` });
    return;
  }

  let estimatedPrice = 0;

  // Pecah tiap baris paket jadi baris per komponen SEKARANG (server-side,
  // dari resep get_public_page.bundles) -- client anon tidak pernah
  // dipercaya soal komposisi paket (brief bagian C).
  const explodedBundleRows: ExplodedRow[] = [];
  for (const requestedBundle of requestedBundles) {
    const catalogBundle = catalogBundles.find((b) => b.id === requestedBundle.bundle_id);
    if (!catalogBundle) {
      res.status(400).json({ error: 'Salah satu paket tidak ditemukan, sudah tidak aktif, atau salah satu alatnya sudah tidak aktif.' });
      return;
    }
    const exploded = explodeBundleRow(catalogBundle, catalogRatesByItemId, requestedBundle.quantity, rentalDaysCount);
    if ('error' in exploded) {
      res.status(400).json({ error: exploded.error });
      return;
    }
    explodedBundleRows.push(...exploded.rows);
    estimatedPrice += exploded.subtotal;
  }

  const plainItemRows: ExplodedRow[] = requestedItems.map((i) => ({
    item_id: i.item_id,
    quantity: i.quantity,
    bundle_id: null,
    bundle_instance_id: null,
    bundle_name: null,
    bundle_quantity: null,
  }));

  const allRows = [...plainItemRows, ...explodedBundleRows];

  // Kebutuhan per item_id DIJUMLAHKAN DULU dari SEMUA sumber (komponen
  // semua paket + alat satuan lepas yang item_id-nya sama) SEBELUM
  // dibandingkan ke sisa stok -- brief bagian B/C, poin eksplisit: paket
  // + alat tambahan yang sama tidak boleh divalidasi terpisah-pisah,
  // nanti keduanya bisa lolos padahal gabungannya melebihi stok.
  const combinedQtyByItemId = new Map<string, number>();
  for (const row of allRows) {
    combinedQtyByItemId.set(row.item_id, (combinedQtyByItemId.get(row.item_id) ?? 0) + row.quantity);
  }

  for (const [itemId, totalQtyForItem] of combinedQtyByItemId) {
    const catalogItem = catalogItems?.find((i) => i.id === itemId);
    if (!catalogItem) {
      res.status(400).json({ error: 'Salah satu alat tidak ditemukan atau sudah tidak aktif.' });
      return;
    }
    const avail = availability.find((a) => a.id === itemId);
    if (!avail || totalQtyForItem > avail.remaining) {
      res.status(409).json({
        error: `Alat "${catalogItem.name}" tidak cukup untuk tanggal yang dipilih (sisa ${avail?.remaining ?? 0}).`,
      });
      return;
    }
  }

  // Review -c1: estimated_price TIDAK pernah dipercaya dari klien (klien
  // bisa kirim Rp0/Rp1, lalu halaman status menampilkan "Perkiraan Rp0"
  // ke pelanggan, jadi amunisi dispute). Alat satuan dihitung dari harga
  // katalog SAAT INI (computeItemRentalPrice()) × qty, paket sudah
  // dihitung di atas lewat explodeBundleRow -- keduanya murni tampilan
  // ("Perkiraan: Rp X"), harga final tetap dihitung ulang vendor lewat
  // Catat Transaksi biasa saat konfirmasi.
  for (const requested of requestedItems) {
    const catalogItem = catalogItems!.find((i) => i.id === requested.item_id)!;
    estimatedPrice += computeItemRentalPrice(catalogItem, rentalDaysCount) * requested.quantity;
  }

  // Jumlah unit TOTAL (gabungan alat satuan + hasil pecahan semua paket)
  // tetap dibatasi 1-20, sama seperti sebelum paket ada -- dicek di sini
  // dengan pesan ramah (bukan dibiarkan gagal di create_booking_request
  // dengan pesan server mentah, catatan koordinator 16 Nov 2026 poin a).
  const totalQty = allRows.reduce((sum, r) => sum + r.quantity, 0);
  if (totalQty < 1 || totalQty > MAX_ITEMS_PER_REQUEST) {
    res.status(400).json({ error: 'Jumlah alat/paket di luar batas (maks 20 unit per pesanan).' });
    return;
  }

  // Batas kedaluwarsa (rencana 2.6 revisi, tahap 5): mana yang lebih dulu
  // — N jam dari sekarang (N = confirmation_deadline_hours per-business,
  // migration 046, default 24 kalau vendor belum pernah mengatur) ATAU
  // awal hari start_date (zona rental, 053). Hard cap 7 hari tetap ditegakkan di
  // create_booking_request sendiri (migration 037), independen dari
  // setting ini — kalau vendor set 72 jam tapi pelanggan pesan utk
  // tanggal 6 hari lagi, byHours (72 jam dari sekarang) masih < startOf
  // PickupDayWib, jadi expiresAt tetap byHours yang aman di bawah cap.
  const now = Date.now();
  const byHours = new Date(now + page.confirmation_deadline_hours * 60 * 60 * 1000);
  const startOfPickupDayWib = new Date(`${start_date}T00:00:00${tzOffsetIso(page.timezone)}`);
  const expiresAt = byHours < startOfPickupDayWib ? byHours : startOfPickupDayWib;

  // Rencana 2.7: maks 3 pesanan 'menunggu' bersamaan per nomor WA per
  // business — mencegah satu nomor membanjiri satu vendor dengan pesanan
  // palsu berulang. normalizedPhone sudah dalam bentuk kanonik (lihat
  // normalizePhone()), jadi 08xx dan +62xx yang sama fisiknya dihitung
  // sebagai nomor yang sama di sini maupun saat disimpan.
  const MAX_PENDING_PER_PHONE = 3;
  const { data: pendingCount, error: pendingCountError } = await supabase.rpc(
    'count_pending_booking_requests_by_phone',
    { p_secret: secret, p_business_id: page.business_id, p_customer_phone: normalizedPhone },
  );
  if (pendingCountError) {
    res.status(500).json({ error: 'Gagal memvalidasi pesanan. Coba lagi sebentar.' });
    return;
  }
  if ((pendingCount ?? 0) >= MAX_PENDING_PER_PHONE) {
    res.status(429).json({
      error: 'Nomor ini sudah punya beberapa pesanan menunggu konfirmasi di toko ini. Tunggu vendor merespons, atau hubungi lewat WhatsApp.',
    });
    return;
  }

  // Syarat & Ketentuan (migration 047) — cuma string UUID yang diterima
  // (apa pun selain itu dianggap tidak ada persetujuan), dikirim apa
  // adanya ke create_booking_request yang jadi penjaga SEBENARNYA (server
  // menolak kalau beda dari current_terms_version_id SAAT INSERT, bukan
  // percaya mentah-mentah ke nilai dari klien).
  const termsVersionId = typeof terms_version_id === 'string' && terms_version_id.length > 0 ? terms_version_id : null;

  const { data: newId, error: createError } = await supabase.rpc('create_booking_request', {
    p_secret: secret,
    p_business_id: page.business_id,
    p_customer_name: customer_name.trim(),
    p_customer_phone: normalizedPhone,
    p_note: typeof note === 'string' && note.trim() ? note.trim() : null,
    p_start_date: start_date,
    p_end_date: end_date,
    p_estimated_price: estimatedPrice,
    p_payment_method: payment_method,
    p_dp_amount: null,
    p_expires_at: expiresAt.toISOString(),
    p_items: allRows,
    p_terms_version_id: termsVersionId,
  });

  if (createError?.message?.includes('syarat telah diperbarui')) {
    // Review -c1: vendor sempat ubah teks Syarat & Ketentuan SETELAH
    // pelanggan buka form tapi SEBELUM submit — jangan tampilkan pesan
    // server mentah, dan jangan diam-diam catat persetujuan ke versi
    // yang tidak pernah mereka baca (itu justru yang dicegah fitur ini).
    // Frontend (etalase.ts client script) menangani `stale_terms: true`
    // dengan memuat ulang terms_content/terms_version_id terbaru dari
    // /ordering-config dan meminta pelanggan membaca+centang ulang.
    res.status(409).json({
      error: 'Syarat & Ketentuan toko ini baru diperbarui. Silakan baca ulang dan centang lagi sebelum kirim pesanan.',
      stale_terms: true,
    });
    return;
  }

  if (createError || !newId) {
    // Review -c1 #4: createError.message bisa berisi teks internal (mis.
    // "secret tidak valid", nama fungsi) — jangan pernah diteruskan ke
    // klien publik, cukup di-log server-side.
    console.error('create_booking_request gagal:', createError?.message);
    res.status(400).json({ error: 'Gagal menyimpan pesanan. Coba lagi sebentar atau hubungi lewat WhatsApp.' });
    return;
  }

  // Review -c1 #3: cuma dicatat SETELAH insert benar-benar sukses —
  // request yang gagal validasi/stok/dsb tidak ikut memakan kuota
  // per-slug milik vendor ini.
  recordSlugAttempt(slug);

  // Notifikasi push -- best-effort, SENGAJA tidak di-await (pesanan
  // pelanggan tidak boleh gagal/tertunda karena push, lihat
  // research/brief-notifikasi-push-2026-11.md #5). sendPushToBusiness
  // sendiri sudah menelan semua error di dalamnya.
  void sendPushToBusiness(
    page.business_id,
    secret,
    buildNewOrderPayload({
      customerName: customer_name.trim(),
      itemCount: requestedItems.reduce((sum, i) => sum + i.quantity, 0),
      bundleCount: requestedBundles.reduce((sum, b) => sum + b.quantity, 0),
      startDate: start_date,
      endDate: end_date,
    }),
  );

  // create_booking_request (037) mengembalikan id baris, bukan token —
  // tidak ada policy select publik di booking_requests (disengaja, lihat
  // migration 037 bagian 4), jadi token diambil lewat RPC kecil tambahan
  // (migration 039) yang menerima id+secret yang sama, bukan membuka
  // policy select baru untuk anon.
  const { data: tokenResult, error: tokenLookupError } = await supabase.rpc('get_booking_request_token', {
    p_secret: secret,
    p_booking_request_id: newId,
  });

  if (tokenLookupError || !tokenResult) {
    res.status(500).json({ error: 'Pesanan tersimpan tapi gagal mengambil link status. Hubungi vendor lewat WhatsApp.' });
    return;
  }

  res.status(201).json({ token: tokenResult });
});

router.get('/public/booking-requests/status/:token', async (req, res) => {
  const { token } = req.params;
  const supabase = createAnonClient();

  const { data, error } = await supabase.rpc('get_booking_request_status', { p_token: token });

  if (error || !data) {
    res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    return;
  }

  res.json(data);
});

export default router;
