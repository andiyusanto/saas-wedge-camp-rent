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

// Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
// snapshot nama+harga, dipakai sheet "Penjualan Barang" (historyExport.ts)
// dan Laporan (reportAggregation.ts).
export type HistorySaleItem = {
  sale_item_id: string;
  name: string;
  quantity: number;
  price_at_booking: number;
  subtotal: number;
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
  saleItems: HistorySaleItem[];
  penalties: { type: string; amount: number; item_id: string | null }[];
  // Snapshot (migration 049) — mode saat booking ini DIBUAT, null untuk
  // baris dari sebelum fitur ini (ditafsirkan 'per_hari_kalender').
  rental_day_mode: RentalDayMode | null;
  // Pelunasan (brief 17 Nov 2026, migration 067) -- dipakai Laporan
  // "Uang Diterima" per bulan paid_at (reportAggregation.ts). CATATAN:
  // kelengkapannya ikut rentang start_date fetch (lihat caller), jadi
  // pembayaran yang dicatat jauh SEBELUM start_date booking tapi di
  // LUAR rentang itu (kasus langka, lintas tahun) tidak ikut terhitung —
  // didokumentasikan sebagai keterbatasan v1, bukan bug.
  payments: { amount: number; paid_at: string; kind: string }[];
};

// subtotal/price_at_booking (migration 034), penalties.item_id (migration
// 029), bundle_id/bundle_instance_id/bundle_name (migration 064), dan
// items.total_units ditambah buat Laporan (utils/reportAggregation.ts) &
// export Excel (utils/historyExport.ts). Pola fallback subtotal null sama
// persis InvoiceModal.tsx (baris lama sebelum migration 034, tidak
// di-backfill).
const SELECT_FIELDS =
  'id, booking_number, status, start_date, end_date, total_price, dp_paid, rental_day_mode, customers(name, phone), booking_items(quantity, subtotal, price_at_booking, bundle_id, bundle_instance_id, bundle_name, items(id, name, category, variant, size, color, total_units)), booking_sale_items(sale_item_id, name, quantity, price_at_booking, subtotal), penalties(type, amount, item_id), booking_payments(amount, paid_at, kind)';

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
  booking_sale_items: { sale_item_id: string; name: string; quantity: number; price_at_booking: number; subtotal: number }[] | null;
  penalties: { type: string; amount: number; item_id: string | null }[] | null;
  booking_payments: { amount: number; paid_at: string; kind: string }[] | null;
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
    saleItems: row.booking_sale_items ?? [],
    penalties: row.penalties ?? [],
    payments: row.booking_payments ?? [],
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

// "Uang Diterima" per bulan paid_at (brief Pelunasan 17 Nov 2026, revisi
// koordinator 17 Nov 2026) -- SEBELUMNYA dihitung dari payments yang
// menumpang di `bookings` yang sudah difilter per TAHUN lewat `start_date`
// (fetchHistoryBookings), jadi DP yang dibayar di tahun N untuk booking
// yang start_date-nya tahun N+1 (kasus UMUM di akhir tahun, bukan langka)
// ikut HILANG. Diperbaiki dengan fetch TERPISAH langsung ke
// `booking_payments`, difilter `business_id` + `paid_at` dalam TAHUN yang
// dipilih sendiri (bukan ikut rentang start_date booking manapun) --
// paginasi `.range()` paralel + `order()` deterministik (aturan CLAUDE.md
// bagian 7: PostgREST max_rows=1000, query tanpa urutan deterministik
// bisa dobel/terlompati antar halaman). Baris refund/koreksi (amount
// negatif) ikut terhitung APA ADANYA tanpa filter status booking apa pun
// -- itu sudah benar secara aritmatika (refund pada booking yang
// dibatalkan menetralkan payment aslinya di bulan yang sama), tidak perlu
// join ke `bookings.status` untuk itu.
export async function fetchPaymentsInYear(
  businessId: string,
  year: number,
): Promise<{ rows: { amount: number; paid_at: string }[]; error: string | null }> {
  if (!supabase) return { rows: [], error: null };

  const PAGE_SIZE = 1000;
  const from = `${year}-01-01T00:00:00`;
  const to = `${year}-12-31T23:59:59.999`;

  const { count, error: countError } = await supabase
    .from('booking_payments')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('paid_at', from)
    .lte('paid_at', to);
  if (countError) return { rows: [], error: countError.message };

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const pageResults = await Promise.all(
    Array.from({ length: totalPages }, (_, pageIndex) => {
      const offset = pageIndex * PAGE_SIZE;
      return supabase!
        .from('booking_payments')
        .select('amount, paid_at, id')
        .eq('business_id', businessId)
        .gte('paid_at', from)
        .lte('paid_at', to)
        .order('paid_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
    }),
  );

  const firstError = pageResults.find((r) => r.error)?.error;
  if (firstError) return { rows: [], error: firstError.message };

  const rows = pageResults.flatMap((r) => (r.data ?? []) as { amount: number; paid_at: string }[]);
  return { rows, error: null };
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
