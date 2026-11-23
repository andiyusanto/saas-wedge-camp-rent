import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import {
  computeDueAt,
  hoursLate,
  computeLateFee,
  computeTieredLateFee,
  lateDaysEquivalent,
  computeFullDayLateFee,
  computeFullDayLateFeeFlat,
  computeHourlyLateFee,
  fullDayLateDays,
} from '../lib/penalty.js';
import type { LateFeeMode } from '../lib/penalty.js';
import { rentalDuration, todayInTz, addDays } from '../lib/dates.js';
import { logBookingStatus, logBookingReschedule, resolveActorName, getCallerRole } from '../lib/audit.js';
import { checkStockForNewDates } from '../lib/availability.js';
import { computeBookingTotalPrice, computeBookingItemSubtotal, applyDiscountPercentToBruto, computeDiscountAmountFromPercent } from '../lib/pricing.js';
import { mergeBookingItemsForUpdate } from '../lib/bookingItems.js';
import type { ExistingBookingItemRow, CatalogItemRow } from '../lib/bookingItems.js';
import { mergeSaleItemsForUpdate } from '../lib/saleItems.js';
import type { ExistingBookingSaleItemRow, CatalogSaleItemRow } from '../lib/saleItems.js';
import { isBusinessWritable, SUBSCRIPTION_LOCKED_MESSAGE } from '../lib/subscription.js';
import { isValidDateStr, validateOptionalTotalPriceAndReason } from '../lib/validation.js';

const router = Router();

type BookingItemJoin = {
  item_id: string;
  quantity: number;
  price_at_booking: number;
  subtotal: number | null;
  day2_rate_at_booking: number | null;
  day3_rate_at_booking: number | null;
  day4_rate_at_booking: number | null;
  day5_rate_at_booking: number | null;
  extra_day_rate_at_booking: number | null;
  bundle_id: string | null;
  bundle_instance_id: string | null;
  bundle_name: string | null;
  bundle_quantity: number | null;
  items: { name: string } | null;
};

type BookingSaleItemJoin = {
  sale_item_id: string;
  name: string;
  price_at_booking: number;
  quantity: number;
  subtotal: number;
};

// Denda keterlambatan per item booking_items ini — rumus bertingkat
// (computeTieredLateFee, migration 034+) kalau snapshot tarifnya ada,
// atau rumus flat lama (computeLateFee, pakai price_at_booking) untuk
// baris booking_items dari SEBELUM migration 034 (snapshot null, belum
// ada cara tahu tarif bertingkat waktu transaksi itu dibuat). rentDuration
// = jumlah hari sewa ASLI booking ini (bukan jumlah hari telat) — basis
// "harga(durasi+telat) - harga(durasi)" di rumus marginal.
//
// Cara hitung denda telat (migration 063, brief 15 Nov 2026) — mode
// dipakai HANYA untuk dua mode per-alat ('bertahap_12jam' default DAN
// 'per_hari_24jam'); mode 'per_jam' dihitung PER TRANSAKSI terpisah
// (computeHourlyLateFee, lihat GET /trackings di bawah), 'tanpa_denda'
// tidak pernah memanggil fungsi ini sama sekali.
function itemLateFee(
  bi: BookingItemJoin,
  hLate: number,
  toleranceHours: number,
  rentDuration: number,
  mode: 'bertahap_12jam' | 'per_hari_24jam',
): number {
  if (bi.day2_rate_at_booking == null) {
    return (
      bi.quantity *
      (mode === 'per_hari_24jam'
        ? computeFullDayLateFeeFlat(hLate, toleranceHours, bi.price_at_booking)
        : computeLateFee(hLate, toleranceHours, bi.price_at_booking))
    );
  }
  const rates = {
    price_per_day: bi.price_at_booking,
    day2_rate: bi.day2_rate_at_booking,
    day3_rate: bi.day3_rate_at_booking!,
    day4_rate: bi.day4_rate_at_booking!,
    day5_rate: bi.day5_rate_at_booking!,
    extra_day_rate: bi.extra_day_rate_at_booking!,
  };
  return (
    bi.quantity *
    (mode === 'per_hari_24jam'
      ? computeFullDayLateFee(hLate, toleranceHours, rentDuration, rates)
      : computeTieredLateFee(hLate, toleranceHours, rentDuration, rates))
  );
}
type PenaltyJoin = {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  item_id: string | null;
  items: { name: string } | null;
};
type StatusHistoryJoin = { status: string; changed_by_name: string; created_at: string; reason: string | null };

type BookingPaymentJoin = {
  id: string;
  amount: number;
  method: string | null;
  kind: string;
  note: string | null;
  paid_at: string;
  created_by_name: string;
};
type RescheduleHistoryJoin = {
  action: 'ubah_jadwal' | 'perpanjang';
  old_start_date: string;
  old_end_date: string;
  new_start_date: string;
  new_end_date: string;
  reason: string | null;
  past_deadline: boolean;
  changed_by_name: string;
  created_at: string;
};
// Riwayat Ubah Alat (migration 061, brief 14 Nov 2026) — old_items/
// new_items sudah snapshot {item_id,name,quantity,subtotal} dari RPC
// apply_booking_item_changes, dikirim apa adanya ke frontend.
type ItemChangeHistoryJoin = {
  old_items: { item_id: string; name: string; quantity: number; subtotal: number }[];
  new_items: { item_id: string; name: string; quantity: number; subtotal: number }[];
  old_total_price: number;
  new_total_price: number;
  reason: string | null;
  changed_by_name: string;
  created_at: string;
};

router.get('/trackings', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const supabase = createRequestClient(req);

  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .select('id, late_tolerance_hours, timezone, reschedule_deadline_days, late_fee_mode')
    .maybeSingle();

  if (bizError || !business) {
    res.status(400).json({ error: bizError?.message ?? 'Business tidak ditemukan' });
    return;
  }

  // Slug Etalase milik business ini -- dipakai TrackingScreen.tsx membangun
  // link status pesanan bentuk baru (toko.sewalog.com/{slug}/pesanan/
  // {token}, brief 12 Nov 2026). public_pages SELECT RLS (migration 019)
  // SENGAJA cuma is_owner_of() (kolom info bayar owner-only), bukan
  // is_member_of() -- jadi dipanggil lewat RPC get_public_page_slug()
  // (migration 059) yang CUMA mengembalikan kolom slug, dibatasi
  // is_member_of() (owner MAUPUN karyawan dapat), bukan query tabel
  // langsung. null kalau Etalase belum pernah disetel -- frontend jatuh
  // balik ke format lama /pesanan/{token}, yang tetap benar lewat
  // redirect 301 (lihat routes/etalase.ts).
  const { data: publicPageSlug } = await supabase.rpc('get_public_page_slug', { p_business_id: business.id });

  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select(
      'id, booking_number, start_date, end_date, status, total_price, dp_paid, created_at, picked_up_at, customer_photo_key, rental_day_mode, duration_label_style, min_rental_days, max_rental_days, return_deadline_time, return_deadline_next_day, late_fee_mode, late_fee_per_hour, late_fee_per_hour_cap_enabled, discount_type_name, discount_percent, discount_amount, customer_id, customers(name, phone, address), booking_items(item_id, quantity, price_at_booking, subtotal, day2_rate_at_booking, day3_rate_at_booking, day4_rate_at_booking, day5_rate_at_booking, extra_day_rate_at_booking, bundle_id, bundle_instance_id, bundle_name, bundle_quantity, items(name)), booking_sale_items(sale_item_id, name, price_at_booking, quantity, subtotal), deposits(id, type, amount, note, status), penalties(id, type, amount, description, item_id, items(name)), booking_payments(id, amount, method, kind, note, paid_at, created_by_name), booking_status_history(status, changed_by_name, created_at, reason), booking_reschedules(action, old_start_date, old_end_date, new_start_date, new_end_date, reason, past_deadline, changed_by_name, created_at), booking_item_changes(old_items, new_items, old_total_price, new_total_price, reason, changed_by_name, created_at)',
    )
    .in('status', ['dipesan', 'aktif'])
    .order('end_date');

  if (bookingsError) {
    res.status(400).json({ error: bookingsError.message });
    return;
  }

  const now = new Date();

  const result = (bookings ?? []).map((b) => {
    const bookingItems = (b.booking_items ?? []) as unknown as BookingItemJoin[];
    const dailyRate = bookingItems.reduce((sum, bi) => sum + bi.quantity * bi.price_at_booking, 0);
    // Snapshot (migration 049) — b.rental_day_mode TETAP seperti saat
    // booking ini DIBUAT, bukan setting businesses.rental_day_mode yang
    // mungkin sudah vendor ubah sesudahnya. null (baris sebelum fitur
    // ini) ditafsirkan 'per_hari_kalender' oleh rentalDuration() sendiri.
    const rentDuration = rentalDuration(b.start_date, b.end_date, b.rental_day_mode);

    // 'dipesan' belum diambil fisik — belum relevan hitung telat.
    const isPendingPickup = b.status === 'dipesan';
    const dueAt = computeDueAt(
      b.end_date,
      b.created_at,
      b.picked_up_at,
      business.timezone,
      b.return_deadline_time,
      b.return_deadline_next_day ?? false,
    );
    const hLate = isPendingPickup ? 0 : Math.max(0, hoursLate(dueAt, now));

    // Cara hitung denda telat (migration 063, brief 15 Nov 2026) — snapshot
    // PER TRANSAKSI (b.late_fee_mode), null = 'bertahap_12jam' (baris lama,
    // perilaku TIDAK berubah). Empat mode:
    const lateFeeMode: LateFeeMode = (b.late_fee_mode as LateFeeMode | null) ?? 'bertahap_12jam';

    let lateDaysDisplay = 0;
    let lateFeeBreakdown: { item_id: string; name: string; fee: number; per_day_rate: number }[] = [];
    let suggestedLateFee = 0;
    let lateFeeHourly: { hours: number; per_hour: number; cap: number | null; capped: boolean; needs_manual_input: boolean } | null =
      null;

    if (!isPendingPickup && lateFeeMode === 'per_jam') {
      // SATU angka PER TRANSAKSI (bukan per alat, v1) — batas atas =
      // jumlah fee "per hari penuh" tiap alat (computeFullDayLateFee/Flat),
      // PERSIS yang akan dihasilkan mode per_hari_24jam untuk jam telat
      // yang sama (lihat lib/penalty.ts computeHourlyLateFee).
      const fullDayFeeTotal = bookingItems.reduce(
        (sum, bi) =>
          sum +
          itemLateFee(bi, hLate, business.late_tolerance_hours, rentDuration, 'per_hari_24jam'),
        0,
      );
      const hourly = computeHourlyLateFee(
        hLate,
        business.late_tolerance_hours,
        b.late_fee_per_hour,
        b.late_fee_per_hour_cap_enabled ?? true,
        fullDayFeeTotal,
      );
      suggestedLateFee = hourly.fee;
      lateFeeHourly = {
        hours: hourly.hours,
        per_hour: b.late_fee_per_hour ?? 0,
        cap: hourly.cap,
        capped: hourly.capped,
        needs_manual_input: hourly.needsManualInput,
      };
    } else if (!isPendingPickup && lateFeeMode !== 'tanpa_denda') {
      // 'bertahap_12jam' (default) atau 'per_hari_24jam' — per item,
      // lihat itemLateFee() di atas. Dijumlah jadi satu saran denda, tapi
      // rinciannya (late_fee_breakdown) dikirim juga ke frontend supaya
      // dialog pengembalian bisa tampilkan tarif efektif per alat, bukan
      // cuma satu angka gabungan.
      lateDaysDisplay =
        lateFeeMode === 'per_hari_24jam'
          ? fullDayLateDays(hLate, business.late_tolerance_hours)
          : lateDaysEquivalent(hLate, business.late_tolerance_hours);
      lateFeeBreakdown = bookingItems
        .map((bi) => ({
          item_id: bi.item_id,
          name: bi.items?.name ?? '',
          fee: itemLateFee(bi, hLate, business.late_tolerance_hours, rentDuration, lateFeeMode as 'bertahap_12jam' | 'per_hari_24jam'),
        }))
        .filter((x) => x.fee > 0)
        .map((x) => ({
          ...x,
          // Tarif efektif per hari telat, cuma buat tampilan (seperti
          // dailyRateBreakdown Bilbo) — fee sungguhan sudah final di
          // atas, ini cuma fee/lateDaysDisplay dibalik supaya vendor
          // paham angkanya dari mana, bukan sumber hitungan baru.
          per_day_rate: lateDaysDisplay > 0 ? Math.round(x.fee / lateDaysDisplay) : 0,
        }));
      suggestedLateFee = lateFeeBreakdown.reduce((sum, x) => sum + x.fee, 0);
    }
    // 'tanpa_denda' (atau is_pending_pickup): suggestedLateFee=0,
    // lateFeeBreakdown=[], lateFeeHourly=null -- nilai awal di atas sudah
    // tepat, tidak perlu cabang eksplisit.

    return {
      id: b.id,
      booking_number: b.booking_number,
      customer: b.customers,
      // Audit privasi 2 Nov 2026 — key/url sendiri TIDAK PERNAH dikirim
      // ke klien di sini (minim eksposur, meski endpoint ini sudah
      // autentikasi+RLS-scoped) — cuma boolean "ada fotonya atau tidak",
      // klien minta link signed-nya sendiri lewat GET /bookings/:id/
      // customer-photo (routes/bookings.ts) cuma SAAT benar-benar mau
      // menampilkan foto itu, bukan setiap kali daftar transaksi dimuat.
      has_customer_photo: Boolean(b.customer_photo_key),
      start_date: b.start_date,
      end_date: b.end_date,
      picked_up_at: b.picked_up_at,
      due_at: dueAt.toISOString(),
      is_pending_pickup: isPendingPickup,
      is_overdue: !isPendingPickup && hLate > business.late_tolerance_hours,
      hours_late: Math.round(hLate * 10) / 10,
      daily_rate: dailyRate,
      suggested_late_fee: suggestedLateFee,
      late_days_equivalent: lateDaysDisplay,
      late_fee_breakdown: lateFeeBreakdown,
      // Snapshot (migration 063) — dipakai ReturnModal.tsx/TrackingScreen.tsx
      // untuk tampilan mode-aware (badge "tanpa_denda" diperhalus, dsb).
      late_fee_mode: lateFeeMode,
      late_fee_hourly: lateFeeHourly,
      items: ((b.booking_items ?? []) as unknown as BookingItemJoin[]).map((bi) => ({
        item_id: bi.item_id,
        name: bi.items?.name ?? '',
        quantity: bi.quantity,
        price_per_day: bi.price_at_booking,
        subtotal: bi.subtotal,
        bundle_instance_id: bi.bundle_instance_id,
        bundle_name: bi.bundle_name,
        bundle_quantity: bi.bundle_quantity,
      })),
      sale_items: ((b.booking_sale_items ?? []) as unknown as BookingSaleItemJoin[]).map((bsi) => ({
        sale_item_id: bsi.sale_item_id,
        name: bsi.name,
        quantity: bsi.quantity,
        price_at_booking: bsi.price_at_booking,
        subtotal: bsi.subtotal,
      })),
      deposits: b.deposits ?? [],
      payments: ((b.booking_payments ?? []) as unknown as BookingPaymentJoin[])
        .slice()
        .sort((x, y) => x.paid_at.localeCompare(y.paid_at)),
      penalties: ((b.penalties ?? []) as unknown as PenaltyJoin[]).map((p) => ({
        id: p.id,
        type: p.type,
        amount: p.amount,
        description: p.description,
        item_id: p.item_id,
        item_name: p.items?.name ?? null,
      })),
      history: ((b.booking_status_history ?? []) as unknown as StatusHistoryJoin[])
        .slice()
        .sort((x, y) => x.created_at.localeCompare(y.created_at)),
      // Tahap 2 (migration 055) — riwayat Ubah Jadwal/Perpanjang,
      // ditampilkan terpisah dari riwayat status (TrackingScreen.tsx).
      reschedule_history: ((b.booking_reschedules ?? []) as unknown as RescheduleHistoryJoin[])
        .slice()
        .sort((x, y) => x.created_at.localeCompare(y.created_at)),
      // Ubah Alat (migration 061) — riwayat terpisah dari Ubah Jadwal,
      // ditampilkan di TrackingScreen.tsx sendiri-sendiri.
      item_change_history: ((b.booking_item_changes ?? []) as unknown as ItemChangeHistoryJoin[])
        .slice()
        .sort((x, y) => x.created_at.localeCompare(y.created_at)),
      total_price: b.total_price,
      dp_paid: b.dp_paid,
      rental_day_mode: b.rental_day_mode,
      // Label lama sewa "2H1M" (migration 072) -- snapshot per booking,
      // null = 'hari' (formatRentalDuration juga memaksa 'hari' kalau
      // rental_day_mode booking ini bukan 'per_malam', lihat formatters.ts).
      duration_label_style: b.duration_label_style,
      min_rental_days: b.min_rental_days,
      max_rental_days: b.max_rental_days,
      // Snapshot (migration 062) — null = ikuti jam ambil (tidak ada
      // baris batas jam kembali untuk ditampilkan di struk/nota).
      return_deadline_time: b.return_deadline_time,
      return_deadline_next_day: b.return_deadline_next_day,
      // Pelanggan + Member/Diskon (migration 073) -- snapshot per
      // transaksi, null/0 = tanpa diskon (regresi aman).
      discount_type_name: b.discount_type_name,
      discount_percent: b.discount_percent,
      discount_amount: b.discount_amount,
      customer_id: b.customer_id,
    };
  });

  res.json({
    tolerance_hours: business.late_tolerance_hours,
    reschedule_deadline_days: business.reschedule_deadline_days,
    public_page_slug: publicPageSlug ?? null,
    // Setting LIVE business (migration 063) — BUKAN snapshot per booking
    // (itu ada di tiap baris bookings[].late_fee_mode) — dipakai
    // TrackingScreen.tsx cuma untuk label stat "Sewa Terlambat"/tombol
    // filter "Terlambat", keputusan koordinator 15 Nov 2026: satu angka
    // agregat tidak masuk akal berubah-ubah per baris, jadi ikut
    // kebijakan business SEKARANG, bukan campuran snapshot historis.
    late_fee_mode: business.late_fee_mode,
    // Zona rental (migration 053) -- dipakai frontend menampilkan baris
    // "Diambil" (brief 23 Nov 2026) dengan TANGGAL yang benar di struk/
    // nota, konsisten dengan computeDueAt di atas yang sudah memakainya.
    timezone: business.timezone,
    bookings: result,
  });
});

type ExtraPenaltyInput = {
  type: 'kerusakan' | 'kehilangan';
  amount: number;
  description?: string;
  item_id?: string | null;
};

router.post('/bookings/:id/return', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const { late_fee_amount, extra_penalties, return_deposits, payment } = req.body ?? {};

  const supabase = createRequestClient(req);

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select(
      'id, business_id, end_date, created_at, picked_up_at, status, return_deadline_time, return_deadline_next_day, booking_items(item_id)',
    )
    .eq('id', id)
    .maybeSingle();

  if (bookingError || !booking) {
    res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    return;
  }

  if (booking.status !== 'aktif') {
    res.status(400).json({ error: 'Transaksi sudah diproses sebelumnya' });
    return;
  }

  const bookingItemIds = new Set(
    ((booking.booking_items ?? []) as unknown as { item_id: string }[]).map((bi) => bi.item_id),
  );

  for (const p of (extra_penalties as ExtraPenaltyInput[] | undefined) ?? []) {
    if (p.item_id && !bookingItemIds.has(p.item_id)) {
      res.status(400).json({ error: 'Alat yang dipilih tidak ada di transaksi ini' });
      return;
    }
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('late_tolerance_hours, timezone')
    .maybeSingle();

  const now = new Date();
  const dueAt = computeDueAt(
    booking.end_date,
    booking.created_at,
    booking.picked_up_at,
    business?.timezone ?? null,
    booking.return_deadline_time,
    booking.return_deadline_next_day ?? false,
  );
  const hLate = Math.max(0, hoursLate(dueAt, now));
  const isLate = hLate > (business?.late_tolerance_hours ?? 6);

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ actual_return_at: now.toISOString(), status: isLate ? 'telat' : 'selesai' })
    .eq('id', id);

  if (updateError) {
    res.status(400).json({ error: updateError.message });
    return;
  }

  const penaltyRows: {
    booking_id: string;
    type: string;
    amount: number;
    description: string | null;
    item_id: string | null;
  }[] = [];

  if (Number(late_fee_amount) > 0) {
    penaltyRows.push({
      booking_id: id,
      type: 'keterlambatan',
      amount: Number(late_fee_amount),
      description: `Telat ${hLate.toFixed(1)} jam dari batas waktu`,
      item_id: null,
    });
  }

  for (const p of (extra_penalties as ExtraPenaltyInput[] | undefined) ?? []) {
    if (p.type === 'kerusakan' || p.type === 'kehilangan') {
      penaltyRows.push({
        booking_id: id,
        type: p.type,
        amount: Number(p.amount) || 0,
        description: p.description ?? null,
        item_id: p.item_id || null,
      });
    }
  }

  if (penaltyRows.length > 0) {
    const { error: penaltyError } = await supabase.from('penalties').insert(penaltyRows);
    if (penaltyError) {
      res.status(400).json({ error: penaltyError.message });
      return;
    }
  }

  if (return_deposits) {
    const { error: depositError } = await supabase
      .from('deposits')
      .update({ status: 'dikembalikan', returned_at: now.toISOString() })
      .eq('booking_id', id)
      .eq('status', 'ditahan');

    if (depositError) {
      res.status(400).json({ error: depositError.message });
      return;
    }
  }

  const { data: actorData } = await supabase.auth.getUser();
  if (actorData.user) {
    await logBookingStatus(
      supabase,
      id,
      isLate ? 'telat' : 'selesai',
      actorData.user.id,
      actorData.user.email ?? actorData.user.id,
    );
  }

  // "Lunasi sekarang" di ReturnModal (brief 17 Nov 2026) -- LANGKAH
  // TERAKHIR, SETELAH denda (penaltyRows) sudah tersimpan di atas --
  // sisa tagihan yang divalidasi add_booking_payment() baru akurat kalau
  // denda keterlambatan/kerusakan/kehilangan booking ini SUDAH masuk DB.
  // Non-blocking sama seperti pickup: gagal = pengembalian tetap sukses,
  // staf pakai "Catat Pembayaran" manual belakangan.
  let paymentWarning: string | null = null;
  if (payment && Number(payment.amount) > 0) {
    const actorName = actorData.user
      ? await resolveActorName(supabase, booking.business_id, actorData.user.id, actorData.user.email ?? actorData.user.id)
      : 'Konfirmasi Pengembalian';
    const { error: paymentError } = await supabase.rpc('add_booking_payment', {
      p_booking_id: id,
      p_amount: Number(payment.amount),
      p_method: payment.method ?? null,
      p_note: payment.note ?? null,
      p_kind: 'pelunasan',
      p_created_by_name: actorName,
    });
    if (paymentError) {
      console.error(`add_booking_payment gagal saat return booking ${id}:`, paymentError.message);
      paymentWarning = 'Pengembalian tersimpan, tapi pelunasan gagal dicatat — coba lagi lewat Catat Pembayaran.';
    }
  }

  res.json({ ok: true, status: isLate ? 'telat' : 'selesai', hours_late: hLate, paymentWarning });
});

router.post('/bookings/:id/cancel', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const reasonInput = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const reason = reasonInput.length > 0 ? reasonInput : null;
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

  // Perbaikan bug nyata (ditemukan lewat tes skenario "booking yatim"
  // tahap Pesanan Online, tapi bug ini sendiri sudah ada sejak awal,
  // terpisah dari fitur itu): sebelumnya cuma 'aktif' yang boleh
  // dibatalkan, padahal BookingCard.tsx sudah lama menampilkan tombol
  // "Batalkan" untuk booking 'dipesan' (belum diambil fisik, label UI
  // "Siap Diambil") juga — klik Batalkan pada booking macam itu SELALU
  // gagal dengan pesan keliru "Transaksi sudah diproses sebelumnya".
  // Tidak ada logic di bawah yang spesifik ke 'aktif' (release deposit +
  // update status sama saja berlaku untuk 'dipesan'), jadi perbaikannya
  // cuma memperluas status yang diterima.
  const EMPLOYEE_CANCELLABLE = new Set(['aktif', 'dipesan']);

  // Batalkan/Void (brief 17 Nov 2026) — karyawan TETAP dengan aturan lama
  // (cuma dipesan/aktif, alasan opsional). Owner boleh membatalkan status
  // APA PUN selain 'dibatalkan' sendiri (termasuk selesai/telat — salah
  // input yang sudah "ditutup"), TAPI alasan jadi WAJIB untuk perluasan
  // ini — bukan buat karyawan di jalur lama, supaya tombol Batalkan yang
  // sudah ada sekarang tidak tiba-tiba minta alasan.
  if (booking.status === 'dibatalkan') {
    res.status(400).json({ error: 'Transaksi sudah dibatalkan sebelumnya' });
    return;
  }

  const isEmployeeCancellable = EMPLOYEE_CANCELLABLE.has(booking.status);
  if (!isEmployeeCancellable) {
    const role = await getCallerRole(supabase, booking.business_id);
    if (role !== 'owner') {
      res.status(403).json({ error: 'Cuma pemilik usaha yang bisa membatalkan transaksi berstatus ini' });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: 'Alasan wajib diisi untuk membatalkan transaksi yang sudah selesai/terlambat' });
      return;
    }
  }

  // UPDATE sendiri dibuat conditional (bukan percaya begitu saja hasil
  // SELECT di atas) + cek baris yang BENAR-BENAR ter-update — mencegah
  // dua klik "Batalkan" bersamaan (mis. dua tab/dua staff) dari keduanya
  // "berhasil" dan menjalankan efek samping (release deposit, log status)
  // dua kali. Pola conditional update yang sama dengan confirm_booking_
  // request (migration 037). `.neq('status', 'dibatalkan')` (bukan daftar
  // status statis) supaya cakupan owner yang lebih luas di atas tetap
  // konsisten dengan baris yang BENAR-BENAR di-update di sini.
  const { data: updatedRows, error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'dibatalkan', cancelled_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'dibatalkan')
    .select('id');

  if (updateError) {
    res.status(400).json({ error: updateError.message });
    return;
  }
  if (!updatedRows || updatedRows.length === 0) {
    res.status(400).json({ error: 'Transaksi sudah diproses sebelumnya' });
    return;
  }

  const { error: depositError } = await supabase
    .from('deposits')
    .update({ status: 'dikembalikan', returned_at: new Date().toISOString() })
    .eq('booking_id', id)
    .eq('status', 'ditahan');

  if (depositError) {
    res.status(400).json({ error: depositError.message });
    return;
  }

  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
  // dipanggil TEPAT SETELAH conditional UPDATE status di atas berhasil
  // (guard "klik Batalkan dua kali" yang sudah ada otomatis juga
  // mencegah ini terpanggil dua kali DARI SISI CALLER). RPC-nya sendiri
  // idempoten (stock_restored_at) -- retry singkat di sini (bukan infra
  // job baru) kalau sempat gagal jaringan sesaat, supaya stok tidak
  // "nyangkut" belum kembali hanya karena satu hiccup transien. Gagal
  // setelah retry: di-log jelas, TAPI TIDAK membatalkan respons sukses
  // ke klien -- status booking SUDAH tersimpan 'dibatalkan' (bagian
  // paling penting), dan retry berikutnya (mis. refresh halaman lalu
  // koreksi manual) tetap aman dipanggil ulang kapan saja karena
  // idempoten.
  let saleRestoreError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error: restoreError } = await supabase.rpc('restore_sale_item_stock_for_booking', { p_booking_id: id });
    if (!restoreError) {
      saleRestoreError = null;
      break;
    }
    saleRestoreError = restoreError.message;
  }
  if (saleRestoreError) {
    console.error(`restore_sale_item_stock_for_booking gagal untuk booking ${id} setelah 2 percobaan:`, saleRestoreError);
  }

  const { data: actorData } = await supabase.auth.getUser();
  if (actorData.user) {
    await logBookingStatus(
      supabase,
      id,
      'dibatalkan',
      actorData.user.id,
      actorData.user.email ?? actorData.user.id,
      reason,
    );
  }

  res.json({ ok: true });
});

// Pelunasan/pembayaran susulan/koreksi (brief 17 Nov 2026, migration 067)
// -- DP AWAL tidak lewat sini (dicatat atomik oleh trigger
// log_initial_dp_payment() saat booking dibuat, lihat POST /bookings) --
// endpoint ini CUMA untuk pembayaran SETELAH booking ada: "Catat
// Pembayaran"/"Lunasi sekarang" di Transaksi Aktif/Riwayat/Pickup/Return.
// Karyawan boleh memanggil (is_member_of saja, dicek di RPC) -- TIDAK
// digerbang business_is_writable (pola migration 044, sama seperti
// pickup/return/cancel -- pelunasan dianggap "menyelesaikan transaksi
// berjalan"). Validasi sisa tagihan/lebih-bayar/status dibatalkan/role
// owner untuk kind='koreksi' SEMUA ditegakkan di dalam RPC
// add_booking_payment(), bukan diulang di sini -- RPC bisa dipanggil
// langsung lewat supabase-js juga, jadi Express tidak boleh jadi
// satu-satunya penjaga.
router.post('/bookings/:id/payments', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const { amount, method, note, kind } = req.body ?? {};
  const supabase = createRequestClient(req);

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    res.status(400).json({ error: 'Nominal pembayaran tidak valid' });
    return;
  }

  const ALLOWED_KINDS = new Set(['pelunasan', 'pembayaran', 'koreksi']);
  const paymentKind = typeof kind === 'string' && ALLOWED_KINDS.has(kind) ? kind : 'pembayaran';
  const ALLOWED_METHODS = new Set(['tunai', 'transfer', 'qris']);
  const paymentMethod = typeof method === 'string' && ALLOWED_METHODS.has(method) ? method : null;
  const paymentNote = typeof note === 'string' && note.trim().length > 0 ? note.trim() : null;

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, business_id')
    .eq('id', id)
    .maybeSingle();

  if (bookingError || !booking) {
    res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    return;
  }

  const { data: actorData } = await supabase.auth.getUser();
  if (!actorData.user) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }
  const actorName = await resolveActorName(supabase, booking.business_id, actorData.user.id, actorData.user.email ?? actorData.user.id);

  const { data, error } = await supabase.rpc('add_booking_payment', {
    p_booking_id: id,
    p_amount: amount,
    p_method: paymentMethod,
    p_note: paymentNote,
    p_kind: paymentKind,
    p_created_by_name: actorName,
  });

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  res.json({ ok: true, paymentId: row?.payment_id ?? null, dpPaid: row?.new_dp_paid ?? null });
});

// Catat denda di tengah masa sewa (mis. penyewa lapor rusak sebelum
// dikembalikan) — terpisah dari alur POST /return yang menutup transaksi.
router.post('/bookings/:id/penalties', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const { type, amount, description, item_id } = req.body ?? {};

  if (!['kerusakan', 'kehilangan', 'keterlambatan'].includes(type) || !(Number(amount) > 0)) {
    res.status(400).json({ error: 'Jenis atau nominal denda tidak valid' });
    return;
  }

  const supabase = createRequestClient(req);

  if (item_id) {
    const { data: bookingItem } = await supabase
      .from('booking_items')
      .select('item_id')
      .eq('booking_id', id)
      .eq('item_id', item_id)
      .maybeSingle();

    if (!bookingItem) {
      res.status(400).json({ error: 'Alat yang dipilih tidak ada di transaksi ini' });
      return;
    }
  }

  const { error } = await supabase.from('penalties').insert({
    booking_id: id,
    type,
    amount: Number(amount),
    description: description || null,
    item_id: item_id || null,
  });

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(201).json({ ok: true });
});

// ------------------------------------------------------------
// Ubah Jadwal & Perpanjang (Tahap 2, migration 055)
// ------------------------------------------------------------
type RescheduleBookingItem = {
  item_id: string;
  quantity: number;
  price_at_booking: number;
  day2_rate_at_booking: number | null;
  day3_rate_at_booking: number | null;
  day4_rate_at_booking: number | null;
  day5_rate_at_booking: number | null;
  extra_day_rate_at_booking: number | null;
};

// Tulis ulang booking_items.subtotal per baris untuk durasi BARU (Tahap
// 2) — dipanggil setelah jumlah hari berubah lewat Ubah Jadwal/Perpanjang,
// pola sama seperti computeBookingTotalPrice (lib/pricing.ts) tapi per
// baris (subtotal ditampilkan terpisah di struk/Nota, lihat migration 034).
async function updateBookingItemSubtotals(
  supabase: ReturnType<typeof createRequestClient>,
  bookingId: string,
  bookingItems: RescheduleBookingItem[],
  newDays: number,
): Promise<void> {
  for (const bi of bookingItems) {
    const newSubtotal = computeBookingItemSubtotal(bi, newDays);
    await supabase.from('booking_items').update({ subtotal: newSubtotal }).eq('booking_id', bookingId).eq('item_id', bi.item_id);
  }
}

// Ubah Jadwal — booking berstatus 'dipesan' (belum diambil fisik).
// Tanggal ambil & kembali keduanya bisa berubah, jumlah hari boleh
// berubah. Batas "H-N hari sebelum tanggal ambil" (businesses.
// reschedule_deadline_days) HANYA peringatan (keputusan Andi 10 Nov
// 2026) — ditegakkan di sini cuma sebagai "reason wajib diisi kalau
// lewat batas", BUKAN penolakan permintaan itu sendiri.
router.patch('/bookings/:id/reschedule', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const { start_date, end_date, total_price, reason } = req.body ?? {};

  if (!isValidDateStr(start_date) || !isValidDateStr(end_date)) {
    res.status(400).json({ error: 'Tanggal ambil dan kembali wajib diisi, format YYYY-MM-DD.' });
    return;
  }
  if (end_date < start_date) {
    res.status(400).json({ error: 'Tanggal kembali harus setelah tanggal ambil' });
    return;
  }
  const inputError = validateOptionalTotalPriceAndReason(total_price, reason);
  if (inputError) {
    res.status(400).json({ error: inputError });
    return;
  }

  const supabase = createRequestClient(req);

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select(
      'id, business_id, booking_number, start_date, end_date, status, total_price, rental_day_mode, min_rental_days, max_rental_days, discount_percent, booking_items(item_id, quantity, price_at_booking, day2_rate_at_booking, day3_rate_at_booking, day4_rate_at_booking, day5_rate_at_booking, extra_day_rate_at_booking)',
    )
    .eq('id', id)
    .maybeSingle();

  if (bookingError || !booking) {
    res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    return;
  }
  if (booking.status !== 'dipesan') {
    res.status(400).json({ error: 'Ubah Jadwal cuma berlaku untuk transaksi berstatus "Siap Diambil" (belum diambil).' });
    return;
  }

  if (booking.rental_day_mode === 'per_malam' && end_date === start_date) {
    res.status(400).json({ error: 'Tanggal ambil dan kembali tidak boleh di hari yang sama.' });
    return;
  }

  const newDays = rentalDuration(start_date, end_date, booking.rental_day_mode);

  // Minimal paket (snapshot Tahap 1) — batas KERAS, sama seperti saat
  // transaksi dibuat. Maksimal SENGAJA tidak ditolak (staf boleh melebihi,
  // konsisten dengan kebijakan POST /bookings).
  if (booking.min_rental_days != null && newDays < booking.min_rental_days) {
    res.status(400).json({ error: `Minimal sewa ${booking.min_rental_days} hari.` });
    return;
  }

  const { data: bizRow } = await supabase
    .from('businesses')
    .select('timezone, reschedule_deadline_days')
    .maybeSingle();

  // "H-N hari sebelum tanggal ambil" dihitung dari tanggal ambil LAMA
  // (sebelum diubah) — soal "seberapa mepet" permintaan perubahan ini
  // datang relatif ke jadwal yang sudah dijanjikan, bukan jadwal baru.
  const pastDeadline =
    bizRow?.reschedule_deadline_days != null &&
    todayInTz(bizRow.timezone) > addDays(booking.start_date, -bizRow.reschedule_deadline_days);

  if (pastDeadline && !String(reason ?? '').trim()) {
    res.status(400).json({
      error: `Melewati batas ubah jadwal H-${bizRow!.reschedule_deadline_days}. Isi "Alasan perubahan" untuk tetap melanjutkan.`,
      past_deadline: true,
    });
    return;
  }

  const bookingItems = (booking.booking_items ?? []) as unknown as RescheduleBookingItem[];
  const stockError = await checkStockForNewDates(supabase, booking.business_id, id, start_date, end_date, bookingItems);
  if (stockError) {
    res.status(409).json({ error: stockError });
    return;
  }

  const oldDays = rentalDuration(booking.start_date, booking.end_date, booking.rental_day_mode);
  const newBruto = computeBookingTotalPrice(bookingItems, newDays);
  const recomputed = newDays !== oldDays;
  const newTotalPrice = total_price != null ? Number(total_price) : recomputed ? applyDiscountPercentToBruto(newBruto, booking.discount_percent) : booking.total_price;
  // Pelanggan + Member/Diskon (brief 23 Nov 2026) -- discount_amount
  // ditulis ULANG SAAT recompute otomatis (supaya baris "Diskon...%: -Rp
  // Y" di struk tetap akurat terhadap total baru), TIDAK disentuh kalau
  // vendor mengisi total_price manual (baris diskon snapshot tetap
  // tampil apa adanya, pola override yang sudah ada -- keputusan
  // koordinator).
  const newDiscountAmount = total_price != null ? undefined : recomputed ? computeDiscountAmountFromPercent(newBruto, booking.discount_percent) : undefined;

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ start_date, end_date, total_price: newTotalPrice, ...(newDiscountAmount != null ? { discount_amount: newDiscountAmount } : {}) })
    .eq('id', id);

  if (updateError) {
    res.status(400).json({ error: updateError.message });
    return;
  }

  if (newDays !== oldDays) {
    await updateBookingItemSubtotals(supabase, id, bookingItems, newDays);
  }

  const { data: actorData } = await supabase.auth.getUser();
  if (actorData.user) {
    const actorEmail = actorData.user.email ?? actorData.user.id;
    const actorName = await resolveActorName(supabase, booking.business_id, actorData.user.id, actorEmail);
    await logBookingReschedule(supabase, {
      bookingId: id,
      businessId: booking.business_id,
      action: 'ubah_jadwal',
      oldStartDate: booking.start_date,
      oldEndDate: booking.end_date,
      newStartDate: start_date,
      newEndDate: end_date,
      oldTotalPrice: booking.total_price,
      newTotalPrice,
      reason: String(reason ?? '').trim() || null,
      pastDeadline: !!pastDeadline,
      changedBy: actorData.user.id,
      changedByName: actorName,
    });
  }

  res.json({ ok: true, start_date, end_date, total_price: newTotalPrice, past_deadline: !!pastDeadline });
});

// Perpanjang — booking berstatus 'aktif' (sudah diambil fisik). Hanya
// tanggal kembali yang maju; batas telat (computeDueAt, dipanggil dari
// GET /trackings & POST /bookings/:id/return) otomatis ikut geser karena
// cuma membaca bookings.end_date — tidak ada kolom tambahan yang perlu
// disentuh untuk itu. Aturan H-N (reschedule_deadline_days) TIDAK
// berlaku di sini (brief Tahap 2 poin 5 — alat sudah diambil).
router.patch('/bookings/:id/extend', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const { end_date, total_price, reason } = req.body ?? {};

  if (!isValidDateStr(end_date)) {
    res.status(400).json({ error: 'Tanggal kembali baru wajib diisi, format YYYY-MM-DD.' });
    return;
  }
  const inputError = validateOptionalTotalPriceAndReason(total_price, reason);
  if (inputError) {
    res.status(400).json({ error: inputError });
    return;
  }

  const supabase = createRequestClient(req);

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select(
      'id, business_id, start_date, end_date, status, total_price, rental_day_mode, discount_percent, booking_items(item_id, quantity, price_at_booking, day2_rate_at_booking, day3_rate_at_booking, day4_rate_at_booking, day5_rate_at_booking, extra_day_rate_at_booking)',
    )
    .eq('id', id)
    .maybeSingle();

  if (bookingError || !booking) {
    res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    return;
  }
  if (booking.status !== 'aktif') {
    res.status(400).json({ error: 'Perpanjang cuma berlaku untuk transaksi berstatus "Aktif" (sudah diambil).' });
    return;
  }
  if (end_date <= booking.end_date) {
    res.status(400).json({ error: 'Tanggal kembali baru harus setelah tanggal kembali semula.' });
    return;
  }

  const bookingItems = (booking.booking_items ?? []) as unknown as RescheduleBookingItem[];
  const stockError = await checkStockForNewDates(supabase, booking.business_id, id, booking.start_date, end_date, bookingItems);
  if (stockError) {
    res.status(409).json({ error: stockError });
    return;
  }

  const oldDays = rentalDuration(booking.start_date, booking.end_date, booking.rental_day_mode);
  const newDays = rentalDuration(booking.start_date, end_date, booking.rental_day_mode);
  const newBruto = computeBookingTotalPrice(bookingItems, newDays);
  const newTotalPrice = total_price != null ? Number(total_price) : applyDiscountPercentToBruto(newBruto, booking.discount_percent);
  const newDiscountAmount = total_price != null ? undefined : computeDiscountAmountFromPercent(newBruto, booking.discount_percent);

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ end_date, total_price: newTotalPrice, ...(newDiscountAmount != null ? { discount_amount: newDiscountAmount } : {}) })
    .eq('id', id);

  if (updateError) {
    res.status(400).json({ error: updateError.message });
    return;
  }

  if (newDays !== oldDays) {
    await updateBookingItemSubtotals(supabase, id, bookingItems, newDays);
  }

  const { data: actorData } = await supabase.auth.getUser();
  if (actorData.user) {
    const actorEmail = actorData.user.email ?? actorData.user.id;
    const actorName = await resolveActorName(supabase, booking.business_id, actorData.user.id, actorEmail);
    await logBookingReschedule(supabase, {
      bookingId: id,
      businessId: booking.business_id,
      action: 'perpanjang',
      oldStartDate: booking.start_date,
      oldEndDate: booking.end_date,
      newStartDate: booking.start_date,
      newEndDate: end_date,
      oldTotalPrice: booking.total_price,
      newTotalPrice,
      reason: String(reason ?? '').trim() || null,
      pastDeadline: false,
      changedBy: actorData.user.id,
      changedByName: actorName,
    });
  }

  res.json({ ok: true, end_date, total_price: newTotalPrice });
});

// ------------------------------------------------------------
// Ubah Alat (migration 061, brief 14 Nov 2026) — booking berstatus
// 'dipesan' saja. Tanggal TIDAK berubah (beda dari Ubah Jadwal) —
// tambah/ubah jumlah/hapus alat. Beda dari reschedule/extend di atas:
// mutasi tabelnya (hapus+insert booking_items, update total, catat
// riwayat) dilakukan ATOMIK lewat satu RPC (apply_booking_item_changes),
// bukan beberapa request Supabase terpisah — brief eksplisit minta ini
// karena mengganti ISI booking_items lebih berisiko gagal di tengah
// jalan (bisa menyisakan booking tanpa alat) dibanding update satu
// kolom scalar. Keputusan Andi 14 Nov 2026: SELURUH aksi ini dikunci
// kalau business hanya-baca (business_is_writable) — beda dari
// reschedule/extend yang TIDAK dikunci — karena mengubah isi pesanan
// dianggap "kerja baru", bukan menyelesaikan transaksi berjalan.
router.patch('/bookings/:id/items', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const { items, sale_items, total_price, reason } = req.body ?? {};

  const requestedItems = items as { item_id: string; quantity: number; bundle_instance_id?: string | null }[] | undefined;
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    res.status(400).json({ error: 'Minimal satu alat harus tersisa.' });
    return;
  }
  const requestedSaleItems = (sale_items as { sale_item_id: string; quantity: number }[] | undefined) ?? [];
  if (!Array.isArray(requestedSaleItems)) {
    res.status(400).json({ error: 'Data barang jual tidak valid.' });
    return;
  }
  const inputError = validateOptionalTotalPriceAndReason(total_price, reason);
  if (inputError) {
    res.status(400).json({ error: inputError });
    return;
  }

  const supabase = createRequestClient(req);

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select(
      'id, business_id, status, start_date, end_date, rental_day_mode, total_price, discount_percent, booking_items(item_id, quantity, price_at_booking, day2_rate_at_booking, day3_rate_at_booking, day4_rate_at_booking, day5_rate_at_booking, extra_day_rate_at_booking, bundle_id, bundle_instance_id, bundle_name, bundle_quantity, items(name))',
    )
    .eq('id', id)
    .maybeSingle();

  if (bookingError || !booking) {
    res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    return;
  }
  if (booking.status !== 'dipesan') {
    res.status(400).json({ error: 'Ubah Alat cuma berlaku untuk transaksi berstatus "Siap Diambil" (belum diambil).' });
    return;
  }

  // Pesan ramah di sini (sebelum panggil RPC) — RPC sendiri MENGULANG
  // pengecekan ini sebagai jaring pengaman (SECURITY DEFINER bypass RLS,
  // lihat migration 061), bukan cuma andalan cek di Express ini.
  if (!(await isBusinessWritable(supabase, booking.business_id))) {
    res.status(403).json({ error: SUBSCRIPTION_LOCKED_MESSAGE });
    return;
  }

  const existingItemsJoin = (booking.booking_items ?? []) as unknown as (ExistingBookingItemRow & { items: { name: string } | null })[];
  const existingItems: ExistingBookingItemRow[] = existingItemsJoin;
  const existingNameById = new Map(existingItemsJoin.map((e) => [e.item_id, e.items?.name ?? '']));

  // Alat yang BENAR-BENAR BARU (belum pernah ada di booking ini) perlu
  // tarif katalog SAAT INI — fetch cuma untuk item_id yang belum ada di
  // existingItems (pola sama POST /bookings, trust katalog server-side,
  // bukan dari klien). `name` ikut diambil di sini — dipakai bareng
  // existingNameById di bawah untuk membangun respons `items` (nama
  // alat), supaya frontend bisa langsung susun struk WA tanpa refetch
  // terpisah (pola sama RescheduleModal.tsx, yang membangun struk dari
  // field hasil PATCH langsung).
  const existingIds = new Set(existingItems.map((e) => e.item_id));
  const newItemIds = requestedItems.map((r) => r.item_id).filter((itemId) => !existingIds.has(itemId));
  const { data: catalogRows } =
    newItemIds.length > 0
      ? await supabase
          .from('items')
          .select('id, name, price_per_day, day2_rate, day3_rate, day4_rate, day5_rate, extra_day_rate')
          .in('id', newItemIds)
          .is('deactivated_at', null)
      : { data: [] as (CatalogItemRow & { name: string })[] };
  const newNameById = new Map((catalogRows ?? []).map((c) => [c.id, c.name]));

  const days = rentalDuration(booking.start_date, booking.end_date, booking.rental_day_mode);
  const merged = mergeBookingItemsForUpdate(requestedItems, existingItems, (catalogRows ?? []) as CatalogItemRow[], days);
  if (!merged.ok) {
    res.status(400).json({ error: merged.error });
    return;
  }

  // Stok di tanggal booking INI (tidak berubah) — excludeBookingId
  // mengecualikan booking ini sendiri dari hitungan stoknya sendiri,
  // reuse checkStockForNewDates yang sudah ada untuk Ubah Jadwal/Perpanjang.
  const stockError = await checkStockForNewDates(
    supabase,
    booking.business_id,
    id,
    booking.start_date,
    booking.end_date,
    requestedItems,
  );
  if (stockError) {
    res.status(409).json({ error: stockError });
    return;
  }

  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
  // pola PERSIS alat sewa di atas: barang yang SUDAH ADA di booking ini
  // mempertahankan harga snapshot lama, barang BENAR-BENAR BARU pakai
  // harga katalog SAAT INI (fetch cuma untuk sale_item_id yang belum ada
  // di booking ini).
  const { data: existingSaleItemsJoin } = await supabase
    .from('booking_sale_items')
    .select('sale_item_id, quantity, price_at_booking, name')
    .eq('booking_id', id);
  const existingSaleItems: ExistingBookingSaleItemRow[] = (existingSaleItemsJoin ?? []) as ExistingBookingSaleItemRow[];
  const existingSaleItemIds = new Set(existingSaleItems.map((e) => e.sale_item_id));
  const newSaleItemIds = requestedSaleItems.map((r) => r.sale_item_id).filter((saleItemId) => !existingSaleItemIds.has(saleItemId));
  const { data: catalogSaleRows } =
    newSaleItemIds.length > 0
      ? await supabase.from('sale_items').select('id, name, price').in('id', newSaleItemIds).eq('business_id', booking.business_id).is('deactivated_at', null)
      : { data: [] as CatalogSaleItemRow[] };

  const saleMerged = mergeSaleItemsForUpdate(requestedSaleItems, existingSaleItems, (catalogSaleRows ?? []) as CatalogSaleItemRow[]);
  if (!saleMerged.ok) {
    res.status(400).json({ error: saleMerged.error });
    return;
  }

  const rentalTotal = merged.items.reduce((sum, it) => sum + it.subtotal, 0);
  const saleTotal = saleMerged.items.reduce((sum, it) => sum + it.subtotal, 0);
  // Pelanggan + Member/Diskon (brief 23 Nov 2026) -- diskon snapshot
  // CUMA diterapkan ke rentalTotal (sewa alat+paket), TIDAK ke barang
  // jual (toggle "berlaku untuk barang jual" tidak di-snapshot ke
  // bookings, default OFF -- konsisten rumus awal transaksi).
  const newTotalPrice =
    total_price != null ? Number(total_price) : applyDiscountPercentToBruto(rentalTotal, booking.discount_percent) + saleTotal;
  const newDiscountAmount = total_price != null ? null : computeDiscountAmountFromPercent(rentalTotal, booking.discount_percent);

  const { data: actorData } = await supabase.auth.getUser();
  if (!actorData.user) {
    res.status(401).json({ error: 'Sesi tidak valid' });
    return;
  }
  const actorEmail = actorData.user.email ?? actorData.user.id;
  const actorName = await resolveActorName(supabase, booking.business_id, actorData.user.id, actorEmail);

  // Satu RPC pembungkus (migration 066, catatan koordinator 16 Nov 2026
  // poin 2) -- dua RPC terpisah berurutan TIDAK atomik, kalau satu
  // sukses dan satu gagal stok/isi/total bisa tidak sinkron.
  // apply_booking_item_and_sale_changes memanggil apply_booking_item_changes
  // yang SUDAH ADA (tidak diubah) di dalam satu transaksi yang sama.
  const { error: rpcError } = await supabase.rpc('apply_booking_item_and_sale_changes', {
    p_booking_id: id,
    p_new_items: merged.items,
    p_new_sale_items: saleMerged.items,
    p_new_total_price: newTotalPrice,
    p_reason: String(reason ?? '').trim() || null,
    p_changed_by_name: actorName,
  });

  if (rpcError) {
    res.status(400).json({ error: rpcError.message });
    return;
  }

  // Pelanggan + Member/Diskon (brief 23 Nov 2026) -- discount_amount
  // ditulis ULANG SAAT total dihitung ulang otomatis, supaya baris
  // "Diskon...%: -Rp Y" di struk tetap akurat setelah Ubah Alat. Update
  // TERPISAH (bukan lewat RPC migration 066 yang tidak menerima parameter
  // ini) -- non-blocking best-effort, pola sama pelunasan otomatis saat
  // Ambil/Kembalikan: isi utama (item/total) SUDAH tersimpan duluan lewat
  // RPC, kalau update kecil ini gagal TIDAK membatalkan respons sukses.
  if (newDiscountAmount != null) {
    await supabase.from('bookings').update({ discount_amount: newDiscountAmount }).eq('id', id);
  }

  // items ikut dikembalikan (bukan cuma total_price) -- bentuknya SAMA
  // PERSIS TrackingBooking.items (useTrackings.ts), supaya frontend bisa
  // langsung susun struk WA dari respons ini tanpa refetch GET /trackings
  // terpisah (pola sama RescheduleModal.tsx membangun struk langsung
  // dari field hasil PATCH /bookings/:id/reschedule).
  res.json({
    ok: true,
    total_price: newTotalPrice,
    items: merged.items.map((it) => ({
      item_id: it.item_id,
      name: existingNameById.get(it.item_id) ?? newNameById.get(it.item_id) ?? '',
      quantity: it.quantity,
      price_per_day: it.price_at_booking,
      subtotal: it.subtotal,
      bundle_instance_id: it.bundle_instance_id,
      bundle_name: it.bundle_name,
      bundle_quantity: it.bundle_quantity,
    })),
    sale_items: saleMerged.items.map((it) => ({
      sale_item_id: it.sale_item_id,
      name: it.name,
      quantity: it.quantity,
      price_at_booking: it.price_at_booking,
      subtotal: it.subtotal,
    })),
  });
});

export default router;
