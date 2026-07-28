import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { fetchActiveBookingItems, usedUnitsOn } from '../lib/availability.js';
import { dateRange } from '../lib/dates.js';

const router = Router();

type BookingItemInput = { item_id: string; quantity: number };

router.post('/bookings', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { businessId, customer, start_date, end_date, items, deposit, total_price } = req.body ?? {};

  const requestedItems = items as BookingItemInput[] | undefined;

  if (
    !businessId ||
    !customer?.name ||
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

  const supabase = createRequestClient(req);

  const { data: itemRows, error: itemsError } = await supabase
    .from('items')
    .select('id, name, total_units, price_per_day')
    .in('id', requestedItems.map((i) => i.item_id));

  if (itemsError) {
    res.status(400).json({ error: itemsError.message });
    return;
  }

  let existingBookingItems;
  try {
    existingBookingItems = await fetchActiveBookingItems(supabase);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const days = dateRange(start_date, end_date);

  for (const requested of requestedItems) {
    const itemRow = itemRows?.find((i) => i.id === requested.item_id);
    if (!itemRow) {
      res.status(400).json({ error: 'Alat tidak ditemukan' });
      return;
    }

    for (const day of days) {
      const used = usedUnitsOn(existingBookingItems, requested.item_id, day);
      if (used + requested.quantity > itemRow.total_units) {
        res.status(409).json({
          error: `Alat "${itemRow.name}" tidak cukup pada ${day} (sisa ${itemRow.total_units - used}, diminta ${requested.quantity})`,
        });
        return;
      }
    }
  }

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .insert({ business_id: businessId, name: customer.name, phone: customer.phone ?? null })
    .select('id')
    .single();

  if (customerError || !customerRow) {
    res.status(400).json({ error: customerError?.message ?? 'Gagal menyimpan penyewa' });
    return;
  }

  const { data: bookingRow, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      business_id: businessId,
      customer_id: customerRow.id,
      start_date,
      end_date,
      status: 'aktif',
      total_price: Number(total_price) || 0,
    })
    .select('id')
    .single();

  if (bookingError || !bookingRow) {
    await supabase.from('customers').delete().eq('id', customerRow.id);
    res.status(400).json({ error: bookingError?.message ?? 'Gagal menyimpan transaksi' });
    return;
  }

  const bookingItemsPayload = requestedItems.map((i) => {
    const itemRow = itemRows!.find((r) => r.id === i.item_id)!;
    return {
      booking_id: bookingRow.id,
      item_id: i.item_id,
      quantity: i.quantity,
      price_at_booking: itemRow.price_per_day,
    };
  });

  const { error: biError } = await supabase.from('booking_items').insert(bookingItemsPayload);

  if (biError) {
    await supabase.from('bookings').delete().eq('id', bookingRow.id);
    await supabase.from('customers').delete().eq('id', customerRow.id);
    res.status(400).json({ error: biError.message });
    return;
  }

  if (deposit?.type) {
    const { error: depositError } = await supabase.from('deposits').insert({
      booking_id: bookingRow.id,
      type: deposit.type,
      amount: deposit.type === 'uang' ? Number(deposit.amount) || 0 : null,
      status: 'ditahan',
    });

    if (depositError) {
      await supabase.from('booking_items').delete().eq('booking_id', bookingRow.id);
      await supabase.from('bookings').delete().eq('id', bookingRow.id);
      await supabase.from('customers').delete().eq('id', customerRow.id);
      res.status(400).json({ error: depositError.message });
      return;
    }
  }

  res.status(201).json({ id: bookingRow.id });
});

export default router;
