import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { todayStr } from '../utils/formatters';

export type HistoryBookingItem = {
  item_id: string | null;
  name: string;
  category: string | null;
  variant: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
};

export type HistoryBooking = {
  id: string;
  booking_number: string | null;
  status: string;
  start_date: string;
  end_date: string;
  total_price: number;
  dp_paid: number;
  customer: { name: string; phone: string | null } | null;
  items: HistoryBookingItem[];
  penalties: { type: string; amount: number }[];
};

const SELECT_FIELDS =
  'id, booking_number, status, start_date, end_date, total_price, dp_paid, customers(name, phone), booking_items(quantity, items(id, name, category, variant, size, color)), penalties(type, amount)';

type RawBooking = {
  id: string;
  booking_number: string | null;
  status: string;
  start_date: string;
  end_date: string;
  total_price: number;
  dp_paid: number;
  customers: { name: string; phone: string | null } | null;
  booking_items:
    | {
        quantity: number;
        items: {
          id: string;
          name: string;
          category: string | null;
          variant: string | null;
          size: string | null;
          color: string | null;
        } | null;
      }[]
    | null;
  penalties: { type: string; amount: number }[] | null;
};

function mapBooking(row: RawBooking): HistoryBooking {
  return {
    id: row.id,
    booking_number: row.booking_number,
    status: row.status,
    start_date: row.start_date,
    end_date: row.end_date,
    total_price: row.total_price,
    dp_paid: row.dp_paid,
    customer: row.customers,
    items: (row.booking_items ?? []).map((bi) => ({
      item_id: bi.items?.id ?? null,
      name: bi.items?.name ?? '',
      category: bi.items?.category ?? null,
      variant: bi.items?.variant ?? null,
      size: bi.items?.size ?? null,
      color: bi.items?.color ?? null,
      quantity: bi.quantity,
    })),
    penalties: row.penalties ?? [],
  };
}

// Riwayat cuma butuh data tersimpan (transaksi yang range tanggalnya sudah
// lewat/ditutup) — tidak perlu perhitungan live is_overdue/suggested_late_fee
// seperti useTrackings, jadi query langsung ke Supabase (pola sama seperti
// useItems.ts), bukan lewat backend.
export function useHistory(businessId: string | undefined, from: string, to: string) {
  const [bookings, setBookings] = useState<HistoryBooking[]>([]);
  const [dueTodayCount, setDueTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setBookings([]);
      setDueTodayCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const [bookingsResult, dueTodayResult] = await Promise.all([
      supabase
        .from('bookings')
        .select(SELECT_FIELDS)
        .eq('business_id', businessId)
        .gte('start_date', from)
        .lte('start_date', to)
        .order('start_date', { ascending: false }),
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'aktif')
        .eq('end_date', todayStr()),
    ]);

    if (bookingsResult.error) {
      setError(bookingsResult.error.message);
      setLoading(false);
      return;
    }

    setBookings((bookingsResult.data as unknown as RawBooking[]).map(mapBooking));
    setDueTodayCount(dueTodayResult.count ?? 0);
    setLoading(false);
  }, [businessId, from, to]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bookings, dueTodayCount, loading, error, refresh };
}
