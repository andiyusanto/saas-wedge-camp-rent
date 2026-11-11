import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { fetchActiveBookingItems, usedUnitsOn, computeAvailabilityStatus, marginDaysFromReadinessHours } from '../lib/availability.js';
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
    };
  });

  res.json({ days: dateList, items: result });
});

export default router;
