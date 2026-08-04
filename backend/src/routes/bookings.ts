import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { fetchActiveBookingItems, usedUnitsOn } from '../lib/availability.js';
import { dateRange, todayInWIB } from '../lib/dates.js';

const router = Router();

type BookingItemInput = { item_id: string; quantity: number };

async function generateBookingNumber(
  supabase: ReturnType<typeof createRequestClient>,
  businessId: string,
): Promise<string> {
  const todayWib = todayInWIB();
  const dayStart = `${todayWib}T00:00:00+07:00`;
  const dayEnd = `${todayWib}T23:59:59+07:00`;

  const { count } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  const seq = String((count ?? 0) + 1).padStart(2, '0');
  return `SWL-${todayWib.replaceAll('-', '')}-${seq}`;
}

router.post('/bookings', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { businessId, customer, start_date, end_date, items, deposit, total_price, dp_paid } = req.body ?? {};

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
    .insert({
      business_id: businessId,
      name: customer.name,
      phone: customer.phone ?? null,
      address: customer.address ?? null,
    })
    .select('id')
    .single();

  if (customerError || !customerRow) {
    res.status(400).json({ error: customerError?.message ?? 'Gagal menyimpan penyewa' });
    return;
  }

  // Jalan diambil hari ini -> langsung 'aktif' (alur walk-in biasa).
  // Tanggal ambil di masa depan -> 'dipesan' (reservasi, belum diambil fisik).
  const status = start_date <= todayInWIB() ? 'aktif' : 'dipesan';
  const bookingNumber = await generateBookingNumber(supabase, businessId);

  const { data: bookingRow, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      business_id: businessId,
      customer_id: customerRow.id,
      booking_number: bookingNumber,
      start_date,
      end_date,
      status,
      total_price: Number(total_price) || 0,
      dp_paid: Number(dp_paid) || 0,
    })
    .select('id, booking_number, status')
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
      note: deposit.note ?? null,
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

  res.status(201).json({ id: bookingRow.id, booking_number: bookingRow.booking_number, status: bookingRow.status });
});

router.post('/bookings/:id/pickup', async (req, res) => {
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

  if (booking.status !== 'dipesan') {
    res.status(400).json({ error: 'Transaksi ini bukan status "dipesan"' });
    return;
  }

  const { error: updateError } = await supabase.from('bookings').update({ status: 'aktif' }).eq('id', id);

  if (updateError) {
    res.status(400).json({ error: updateError.message });
    return;
  }

  res.json({ ok: true });
});

export default router;
