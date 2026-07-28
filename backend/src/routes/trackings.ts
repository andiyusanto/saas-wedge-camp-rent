import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { computeDueAt, hoursLate, computeLateFee } from '../lib/penalty.js';

const router = Router();

type BookingItemJoin = { quantity: number; price_at_booking: number; items: { name: string } | null };

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
      'id, start_date, end_date, status, total_price, created_at, customers(name, phone), booking_items(quantity, price_at_booking, items(name)), deposits(id, type, amount, status), penalties(id, type, amount, description)',
    )
    .eq('status', 'aktif')
    .order('end_date');

  if (bookingsError) {
    res.status(400).json({ error: bookingsError.message });
    return;
  }

  const now = new Date();

  const result = (bookings ?? []).map((b) => {
    const dueAt = computeDueAt(b.end_date, b.created_at);
    const hLate = Math.max(0, hoursLate(dueAt, now));
    const dailyRate = ((b.booking_items ?? []) as unknown as BookingItemJoin[]).reduce(
      (sum, bi) => sum + bi.quantity * bi.price_at_booking,
      0,
    );
    const suggestedLateFee = computeLateFee(hLate, business.late_tolerance_hours, dailyRate);

    return {
      id: b.id,
      customer: b.customers,
      start_date: b.start_date,
      end_date: b.end_date,
      due_at: dueAt.toISOString(),
      is_overdue: hLate > business.late_tolerance_hours,
      hours_late: Math.round(hLate * 10) / 10,
      daily_rate: dailyRate,
      suggested_late_fee: suggestedLateFee,
      items: ((b.booking_items ?? []) as unknown as BookingItemJoin[]).map((bi) => ({
        name: bi.items?.name ?? '',
        quantity: bi.quantity,
      })),
      deposits: b.deposits ?? [],
      penalties: b.penalties ?? [],
      total_price: b.total_price,
    };
  });

  res.json({ tolerance_hours: business.late_tolerance_hours, bookings: result });
});

type ExtraPenaltyInput = { type: 'kerusakan' | 'kehilangan'; amount: number; description?: string };

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
    .select('id, end_date, created_at, status')
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

  const { data: business } = await supabase
    .from('businesses')
    .select('late_tolerance_hours')
    .maybeSingle();

  const now = new Date();
  const dueAt = computeDueAt(booking.end_date, booking.created_at);
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

  const penaltyRows: { booking_id: string; type: string; amount: number; description: string | null }[] = [];

  if (Number(late_fee_amount) > 0) {
    penaltyRows.push({
      booking_id: id,
      type: 'keterlambatan',
      amount: Number(late_fee_amount),
      description: `Telat ${hLate.toFixed(1)} jam dari batas waktu`,
    });
  }

  for (const p of (extra_penalties as ExtraPenaltyInput[] | undefined) ?? []) {
    if (p.type === 'kerusakan' || p.type === 'kehilangan') {
      penaltyRows.push({
        booking_id: id,
        type: p.type,
        amount: Number(p.amount) || 0,
        description: p.description ?? null,
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

  res.json({ ok: true, status: isLate ? 'telat' : 'selesai', hours_late: hLate });
});

export default router;
