import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { computeDueAt, hoursLate, computeLateFee, computeTieredLateFee, lateDaysEquivalent } from '../lib/penalty.js';
import { dateRange } from '../lib/dates.js';
import { logBookingStatus } from '../lib/audit.js';

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
  items: { name: string } | null;
};

// Denda keterlambatan per item booking_items ini — rumus bertingkat
// (computeTieredLateFee, migration 034+) kalau snapshot tarifnya ada,
// atau rumus flat lama (computeLateFee, pakai price_at_booking) untuk
// baris booking_items dari SEBELUM migration 034 (snapshot null, belum
// ada cara tahu tarif bertingkat waktu transaksi itu dibuat). rentDuration
// = jumlah hari sewa ASLI booking ini (bukan jumlah hari telat) — basis
// "harga(durasi+telat) - harga(durasi)" di rumus marginal.
function itemLateFee(
  bi: BookingItemJoin,
  hLate: number,
  toleranceHours: number,
  rentDuration: number,
): number {
  if (bi.day2_rate_at_booking == null) {
    return bi.quantity * computeLateFee(hLate, toleranceHours, bi.price_at_booking);
  }
  const rates = {
    price_per_day: bi.price_at_booking,
    day2_rate: bi.day2_rate_at_booking,
    day3_rate: bi.day3_rate_at_booking!,
    day4_rate: bi.day4_rate_at_booking!,
    day5_rate: bi.day5_rate_at_booking!,
    extra_day_rate: bi.extra_day_rate_at_booking!,
  };
  return bi.quantity * computeTieredLateFee(hLate, toleranceHours, rentDuration, rates);
}
type PenaltyJoin = {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  item_id: string | null;
  items: { name: string } | null;
};
type StatusHistoryJoin = { status: string; changed_by_name: string; created_at: string };

router.get('/trackings', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const supabase = createRequestClient(req);

  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .select('late_tolerance_hours')
    .maybeSingle();

  if (bizError || !business) {
    res.status(400).json({ error: bizError?.message ?? 'Business tidak ditemukan' });
    return;
  }

  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select(
      'id, booking_number, start_date, end_date, status, total_price, dp_paid, created_at, picked_up_at, customer_photo_url, customers(name, phone, address), booking_items(item_id, quantity, price_at_booking, subtotal, day2_rate_at_booking, day3_rate_at_booking, day4_rate_at_booking, day5_rate_at_booking, extra_day_rate_at_booking, items(name)), deposits(id, type, amount, note, status), penalties(id, type, amount, description, item_id, items(name)), booking_status_history(status, changed_by_name, created_at)',
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
    const rentDuration = dateRange(b.start_date, b.end_date).length;

    // 'dipesan' belum diambil fisik — belum relevan hitung telat.
    const isPendingPickup = b.status === 'dipesan';
    const dueAt = computeDueAt(b.end_date, b.created_at, b.picked_up_at);
    const hLate = isPendingPickup ? 0 : Math.max(0, hoursLate(dueAt, now));

    // Per item: tiered (snapshot ada) atau flat lama (snapshot null),
    // lihat itemLateFee() di atas. Dijumlah jadi satu saran denda, tapi
    // rinciannya (late_fee_breakdown) dikirim juga ke frontend supaya
    // dialog pengembalian bisa tampilkan tarif efektif per alat, bukan
    // cuma satu angka gabungan.
    const lateDaysDisplay = isPendingPickup ? 0 : lateDaysEquivalent(hLate, business.late_tolerance_hours);
    const lateFeeBreakdown = isPendingPickup
      ? []
      : bookingItems
          .map((bi) => ({
            item_id: bi.item_id,
            name: bi.items?.name ?? '',
            fee: itemLateFee(bi, hLate, business.late_tolerance_hours, rentDuration),
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
    const suggestedLateFee = isPendingPickup ? 0 : lateFeeBreakdown.reduce((sum, x) => sum + x.fee, 0);

    return {
      id: b.id,
      booking_number: b.booking_number,
      customer: b.customers,
      customer_photo_url: b.customer_photo_url,
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
      items: ((b.booking_items ?? []) as unknown as BookingItemJoin[]).map((bi) => ({
        item_id: bi.item_id,
        name: bi.items?.name ?? '',
        quantity: bi.quantity,
        price_per_day: bi.price_at_booking,
        subtotal: bi.subtotal,
      })),
      deposits: b.deposits ?? [],
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
      total_price: b.total_price,
      dp_paid: b.dp_paid,
    };
  });

  res.json({ tolerance_hours: business.late_tolerance_hours, bookings: result });
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
  const { late_fee_amount, extra_penalties, return_deposits } = req.body ?? {};

  const supabase = createRequestClient(req);

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, end_date, created_at, picked_up_at, status, booking_items(item_id)')
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
    .select('late_tolerance_hours')
    .maybeSingle();

  const now = new Date();
  const dueAt = computeDueAt(booking.end_date, booking.created_at, booking.picked_up_at);
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

  res.json({ ok: true, status: isLate ? 'telat' : 'selesai', hours_late: hLate });
});

router.post('/bookings/:id/cancel', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { id } = req.params;
  const supabase = createRequestClient(req);

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, status')
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
  if (booking.status !== 'aktif' && booking.status !== 'dipesan') {
    res.status(400).json({ error: 'Transaksi sudah diproses sebelumnya' });
    return;
  }

  // UPDATE sendiri dibuat conditional (bukan percaya begitu saja hasil
  // SELECT di atas) + cek baris yang BENAR-BENAR ter-update — mencegah
  // dua klik "Batalkan" bersamaan (mis. dua tab/dua staff) dari keduanya
  // "berhasil" dan menjalankan efek samping (release deposit, log status)
  // dua kali. Pola conditional update yang sama dengan confirm_booking_
  // request (migration 037).
  const { data: updatedRows, error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'dibatalkan', cancelled_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['aktif', 'dipesan'])
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

  const { data: actorData } = await supabase.auth.getUser();
  if (actorData.user) {
    await logBookingStatus(supabase, id, 'dibatalkan', actorData.user.id, actorData.user.email ?? actorData.user.id);
  }

  res.json({ ok: true });
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

export default router;
