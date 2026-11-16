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
  // Penanda paket (migration 064, Tahap 1) — ditambah untuk "Ringkasan per
  // Paket" di Laporan (utils/reportAggregation.ts). null = alat biasa.
  bundle_id: string | null;
  bundle_instance_id: string | null;
  bundle_name: string | null;
  // total_units SAAT INI (bukan snapshot) — dipakai keterpakaian % di
  // Laporan. null kalau alat sudah dihapus dari katalog (tidak mungkin
  // sebenarnya, items tidak pernah di-hard-delete, cuma jaga-jaga join null).
  total_units: number | null;
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

// subtotal/price_at_booking (migration 034), penalties.item_id (migration
// 029), bundle_id/bundle_instance_id/bundle_name (migration 064), dan
// items.total_units ditambah buat Laporan (utils/reportAggregation.ts) &
// export Excel (utils/historyExport.ts). Pola fallback subtotal null sama
// persis InvoiceModal.tsx (baris lama sebelum migration 034, tidak
// di-backfill).
const SELECT_FIELDS =
  'id, booking_number, status, start_date, end_date, total_price, dp_paid, rental_day_mode, customers(name, phone), booking_items(quantity, subtotal, price_at_booking, bundle_id, bundle_instance_id, bundle_name, items(id, name, category, variant, size, color, total_units)), penalties(type, amount, item_id)';

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
        bundle_id: string | null;
        bundle_instance_id: string | null;
        bundle_name: string | null;
        items: {
          id: string;
          name: string;
          category: string | null;
          variant: string | null;
          size: string | null;
          color: string | null;
          total_units: number;
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
      bundle_id: bi.bundle_id,
      bundle_instance_id: bi.bundle_instance_id,
      bundle_name: bi.bundle_name,
      total_units: bi.items?.total_units ?? null,
    })),
    penalties: row.penalties ?? [],
  };
}

// 'start_date' -- booking yang MULAI di [from,to] (pola Riwayat/sheet
// "Per Alat" yang sudah ada, dan Laporan Bulanan). 'overlap' -- booking
// yang RENTANG tanggalnya bersinggungan dengan [from,to] sama sekali
// (start <= to DAN end >= from) -- dipakai Laporan per Alat supaya
// keterpakaian bisa dipotong ke periode (koordinator 16 Nov 2026, lihat
// utils/reportAggregation.ts clipOccupiedDaysToPeriod()) tanpa
// kehilangan booking yang melintasi batas periode.
export type HistoryDateFilterMode = 'start_date' | 'overlap';

// Diekstrak dari useHistory() di bawah (TIDAK diubah perilakunya) supaya
// bisa dipakai juga oleh useLaporanData.ts dengan filter tanggal yang
// independen dari filter Riwayat. Paginasi (CLAUDE.md bagian 7): halaman
// DIJALANKAN PARALEL (koordinator 16 Nov 2026) -- jumlah total diketahui
// lebih dulu lewat count query (head:true, filter SAMA), baru semua
// request .range() ditembak sekaligus lewat Promise.all, bukan menunggu
// satu-satu. Latensi didominasi round-trip jaringan, bukan waktu
// eksekusi Postgres -- untuk ~5.000 booking/tahun (5 halaman), ini
// mengubah "5x round-trip berurutan" jadi "1x round-trip" (semua
// berjalan bersamaan), jauh lebih cepat dari sebelumnya tanpa menambah
// query N+1 apa pun.
export async function fetchHistoryBookings(
  businessId: string,
  from: string,
  to: string,
  mode: HistoryDateFilterMode = 'start_date',
): Promise<{ rows: HistoryBooking[]; error: string | null }> {
  if (!supabase) return { rows: [], error: null };

  const PAGE_SIZE = 1000;

  // mode 'overlap': booking yang rentangnya bersinggungan dengan [from,to]
  // -- start_date <= to DAN end_date >= from (termasuk booking yang mulai
  // sebelum `from` tapi masih berlangsung, atau berakhir sesudah `to`).
  const countBase = supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('business_id', businessId);
  const countQuery = mode === 'start_date' ? countBase.gte('start_date', from).lte('start_date', to) : countBase.lte('start_date', to).gte('end_date', from);
  const { count, error: countError } = await countQuery;
  if (countError) return { rows: [], error: countError.message };

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const pageIndexes = Array.from({ length: totalPages }, (_, i) => i);

  const pageResults = await Promise.all(
    pageIndexes.map((pageIndex) => {
      const offset = pageIndex * PAGE_SIZE;
      const base = supabase!
        .from('bookings')
        .select(SELECT_FIELDS)
        .eq('business_id', businessId)
        .order('start_date', { ascending: false })
        .order('id', { ascending: false });
      const filtered = mode === 'start_date' ? base.gte('start_date', from).lte('start_date', to) : base.lte('start_date', to).gte('end_date', from);
      return filtered.range(offset, offset + PAGE_SIZE - 1);
    }),
  );

  const firstError = pageResults.find((r) => r.error)?.error;
  if (firstError) return { rows: [], error: firstError.message };

  const rows = pageResults.flatMap((r) => (r.data ?? []) as unknown as RawBooking[]);
  return { rows: rows.map(mapBooking), error: null };
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

    const [{ rows: allRows, error: pageError }, dueTodayResult] = await Promise.all([
      fetchHistoryBookings(businessId, from, to, 'start_date'),
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'aktif')
        .eq('end_date', todayStr()),
    ]);

    if (pageError) {
      setError(pageError);
      setLoading(false);
      return;
    }

    setBookings(allRows);
    setDueTodayCount(dueTodayResult.count ?? 0);
    setLoading(false);
  }, [businessId, from, to]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bookings, dueTodayCount, loading, error, refresh };
}
