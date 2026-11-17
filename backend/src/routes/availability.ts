import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { fetchActiveBookingItems, usedUnitsOn, computeAvailabilityStatus, marginDaysFromReadinessHours, isBookingOverdue } from '../lib/availability.js';
import { todayInTz, addDays } from '../lib/dates.js';

const router = Router();

// Ketersediaan sengaja dihitung on-the-fly dari booking_items + bookings.status
// (bukan tabel tersimpan) — lihat catatan di migrations/skema-final.sql.
router.get('/availability', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  const supabase = createRequestClient(req);

  // Zona rental (migration 053) — RLS cuma memperlihatkan business milik
  // pemanggil (pola sama seperti routes/trackings.ts). Gagal baca = WIB.
  // id diambil juga supaya bisa dipakai filter EKSPLISIT di bawah (brief
  // skala data 2026-11-11), bukan cuma andalkan RLS.
  const { data: business } = await supabase.from('businesses').select('id, timezone').maybeSingle();
  const timezone: string | null = business?.timezone ?? null;

  if (!business) {
    res.status(400).json({ error: 'Business tidak ditemukan' });
    return;
  }

  const requestedStart = typeof req.query.start_date === 'string' ? req.query.start_date : '';
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) ? requestedStart : todayInTz(timezone);
  const dateList: string[] = Array.from({ length: days }, (_, i) => addDays(startDate, i));
  const endDate = dateList[dateList.length - 1];

  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('id, code, name, category, image_url, total_units, price_per_day, readiness_hours')
    .eq('business_id', business.id)
    .is('deactivated_at', null)
    .order('name');

  if (itemsError) {
    res.status(400).json({ error: itemsError.message });
    return;
  }

  let bookingItems;
  try {
    bookingItems = await fetchActiveBookingItems(supabase, business.id, {
      windowStart: startDate,
      windowEnd: endDate,
      marginDays: marginDaysFromReadinessHours((items ?? []).map((i) => i.readiness_hours)),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  // Opsi B Tahap 2 (brief 17 Nov 2026) — tanda "telat, terkunci" per alat di
  // Kalender. Query TERPISAH yang ringan (bukan memperluas
  // fetchActiveBookingItems() yang juga dipakai validasi stok POST /bookings
  // — join customers di sana cuma akan membengkakkan payload yang tidak
  // perlu untuk pemanggil lain) — biasanya cuma sedikit baris aktif-telat
  // sekaligus, aman tanpa paginasi khusus. TIDAK pernah dipakai di jalur
  // publik (get_public_availability/Etalase TIDAK disentuh sama sekali).
  const today = todayInTz(timezone);
  const { data: overdueBookings } = await supabase
    .from('bookings')
    .select('id, booking_number, end_date, customers(name), booking_items(item_id, quantity)')
    .eq('business_id', business.id)
    .eq('status', 'aktif')
    .lt('end_date', today);

  const overdueByItemId = new Map<string, { booking_number: string | null; customer_name: string | null; end_date: string; quantity: number }[]>();
  for (const b of overdueBookings ?? []) {
    if (!isBookingOverdue(b.end_date, today)) continue; // jaring pengaman defensif, konsisten dgn usedUnitsOn()
    const customerName = (b.customers as unknown as { name: string } | null)?.name ?? null;
    for (const bi of (b.booking_items as unknown as { item_id: string; quantity: number }[]) ?? []) {
      const list = overdueByItemId.get(bi.item_id) ?? [];
      list.push({ booking_number: b.booking_number, customer_name: customerName, end_date: b.end_date, quantity: bi.quantity });
      overdueByItemId.set(bi.item_id, list);
    }
  }

  const result = (items ?? []).map((item) => {
    const remaining = dateList.map(
      (dateStr) => item.total_units - usedUnitsOn(bookingItems, item.id, dateStr, item.readiness_hours, timezone),
    );

    return {
      id: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      image_url: item.image_url,
      total_units: item.total_units,
      price_per_day: item.price_per_day,
      remaining,
      status: remaining.map((r) => computeAvailabilityStatus(r, item.total_units)),
      overdue_bookings: overdueByItemId.get(item.id) ?? [],
    };
  });

  res.json({ days: dateList, items: result });
});

export default router;
