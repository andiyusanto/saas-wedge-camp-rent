import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { fetchActiveBookingItems, usedUnitsOn } from '../lib/availability.js';
import { todayInWIB, addDays } from '../lib/dates.js';

const router = Router();

const LOW_STOCK_RATIO = 0.2;

type Status = 'tersedia' | 'sisa_sedikit' | 'penuh';

function computeStatus(remaining: number, totalUnits: number): Status {
  if (remaining <= 0) return 'penuh';
  const threshold = Math.max(1, Math.floor(totalUnits * LOW_STOCK_RATIO));
  return remaining <= threshold ? 'sisa_sedikit' : 'tersedia';
}

// Ketersediaan sengaja dihitung on-the-fly dari booking_items + bookings.status
// (bukan tabel tersimpan) — lihat catatan di migrations/skema-final.sql.
router.get('/availability', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  const supabase = createRequestClient(req);

  const startDate = todayInWIB();
  const dateList: string[] = Array.from({ length: days }, (_, i) => addDays(startDate, i));

  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('id, name, total_units, price_per_day')
    .order('name');

  if (itemsError) {
    res.status(400).json({ error: itemsError.message });
    return;
  }

  let bookingItems;
  try {
    bookingItems = await fetchActiveBookingItems(supabase);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const result = (items ?? []).map((item) => {
    const remaining = dateList.map(
      (dateStr) => item.total_units - usedUnitsOn(bookingItems, item.id, dateStr),
    );

    return {
      id: item.id,
      name: item.name,
      total_units: item.total_units,
      price_per_day: item.price_per_day,
      remaining,
      status: remaining.map((r) => computeStatus(r, item.total_units)),
    };
  });

  res.json({ days: dateList, items: result });
});

export default router;
