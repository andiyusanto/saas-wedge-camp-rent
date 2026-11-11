import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { todayStr } from '../utils/formatters';
import type { RentalDayMode } from '../utils/formatters';

export type HistoryBookingItem = {
  item_id: string | null;
  name: string;
  category: string | null;
  variant: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  subtotal: number | null;
  price_at_booking: number;
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
  penalties: { type: string; amount: number; item_id: string | null }[];
  // Snapshot (migration 049) — mode saat booking ini DIBUAT, null untuk
  // baris dari sebelum fitur ini (ditafsirkan 'per_hari_kalender').
  rental_day_mode: RentalDayMode | null;
};

// subtotal/price_at_booking (migration 034) dan penalties.item_id (migration
// 029) ditambah buat sheet "Per Alat" & "Transaksi" di export Excel — lihat
// utils/historyExport.ts. Pola fallback subtotal null sama persis
// InvoiceModal.tsx (baris lama sebelum migration 034, tidak di-backfill).
const SELECT_FIELDS =
  'id, booking_number, status, start_date, end_date, total_price, dp_paid, rental_day_mode, customers(name, phone), booking_items(quantity, subtotal, price_at_booking, items(id, name, category, variant, size, color)), penalties(type, amount, item_id)';

type RawBooking = {
  id: string;
  booking_number: string | null;
  status: string;
  start_date: string;
  end_date: string;
  total_price: number;
  dp_paid: number;
  rental_day_mode: RentalDayMode | null;
  customers: { name: string; phone: string | null } | null;
  booking_items:
    | {
        quantity: number;
        subtotal: number | null;
        price_at_booking: number;
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
  penalties: { type: string; amount: number; item_id: string | null }[] | null;
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
    rental_day_mode: row.rental_day_mode,
    customer: row.customers,
    items: (row.booking_items ?? []).map((bi) => ({
      item_id: bi.items?.id ?? null,
      name: bi.items?.name ?? '',
      category: bi.items?.category ?? null,
      variant: bi.items?.variant ?? null,
      size: bi.items?.size ?? null,
      color: bi.items?.color ?? null,
      quantity: bi.quantity,
      subtotal: bi.subtotal,
      price_at_booking: bi.price_at_booking,
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

    // Supabase/PostgREST memotong respons ke max_rows (1.000 di project ini)
    // TANPA error — periode dengan lebih dari 1.000 transaksi akan
    // terpotong diam-diam (total omset/piutang & ekspor Excel ikut salah)
    // kalau cuma satu query. Diambil per halaman lewat .range() sampai
    // habis (brief skala data 2026-11-11). Urutan WAJIB deterministik+unik
    // (start_date lalu id sebagai tiebreaker) — tanpa itu PostgREST tidak
    // menjamin urutan antar-halaman tetap sama, baris bisa dobel/terlompati.
    const PAGE_SIZE = 1000;
    async function fetchAllBookings(): Promise<{ rows: RawBooking[]; error: { message: string } | null }> {
      const rows: RawBooking[] = [];
      let offset = 0;
      for (;;) {
        const { data, error } = await supabase!
          .from('bookings')
          .select(SELECT_FIELDS)
          .eq('business_id', businessId!)
          .gte('start_date', from)
          .lte('start_date', to)
          .order('start_date', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) return { rows, error };
        const page = (data ?? []) as unknown as RawBooking[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      return { rows, error: null };
    }

    const [{ rows: allRows, error: pageError }, dueTodayResult] = await Promise.all([
      fetchAllBookings(),
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'aktif')
        .eq('end_date', todayStr()),
    ]);

    if (pageError) {
      setError(pageError.message);
      setLoading(false);
      return;
    }

    setBookings(allRows.map(mapBooking));
    setDueTodayCount(dueTodayResult.count ?? 0);
    setLoading(false);
  }, [businessId, from, to]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bookings, dueTodayCount, loading, error, refresh };
}
