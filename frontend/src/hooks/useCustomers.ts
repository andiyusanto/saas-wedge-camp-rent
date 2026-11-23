import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Menu "Pelanggan" (brief 23 Nov 2026, migration 073) -- daftar dari
// tabel customers yang SUDAH ADA sejak awal, plus agregat (jumlah sewa
// tahun ini, total belanja, terakhir sewa) dihitung FRONTEND dari
// bookings/booking_items (bukan RPC baru -- volume per rental jauh di
// bawah skala yang butuh agregasi SQL, keputusan koordinator 23 Nov
// 2026). Paginasi `.range()` + `.order()` deterministik + filter
// business_id EKSPLISIT (CLAUDE.md bagian 7) untuk daftar utama; agregat
// per halaman diambil lewat `.in('customer_id', ids)` di-CHUNK dan
// dijalankan PARALEL (syarat koordinator), bukan N+1 query per baris.

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  note: string | null;
  is_watchlisted: boolean;
  customer_type_id: string | null;
  created_at: string;
};

export type CustomerAggregate = {
  jumlahSewaTahunIni: number;
  totalBelanja: number;
  terakhirSewa: string | null; // start_date, null = belum pernah sewa
};

const PAGE_SIZE = 30;
const CHUNK_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function useCustomers(businessId: string | undefined) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [aggregates, setAggregates] = useState<Record<string, CustomerAggregate>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | 'all' | 'watchlisted'>('all');

  const fetchAggregates = useCallback(
    async (customerIds: string[]) => {
      if (!supabase || !businessId || customerIds.length === 0) return;
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const idChunks = chunk(customerIds, CHUNK_SIZE);
      const results = await Promise.all(
        idChunks.map((ids) =>
          supabase!
            .from('bookings')
            .select('customer_id, start_date, total_price, status')
            .eq('business_id', businessId)
            .neq('status', 'dibatalkan')
            .in('customer_id', ids)
            .order('customer_id')
            .order('start_date'),
        ),
      );
      const byCustomer: Record<string, { rows: { start_date: string; total_price: number }[] }> = {};
      for (const r of results) {
        for (const row of (r.data ?? []) as { customer_id: string; start_date: string; total_price: number }[]) {
          if (!byCustomer[row.customer_id]) byCustomer[row.customer_id] = { rows: [] };
          byCustomer[row.customer_id].rows.push({ start_date: row.start_date, total_price: row.total_price });
        }
      }
      const next: Record<string, CustomerAggregate> = {};
      for (const id of customerIds) {
        const rows = byCustomer[id]?.rows ?? [];
        next[id] = {
          jumlahSewaTahunIni: rows.filter((r) => r.start_date >= yearStart).length,
          totalBelanja: rows.reduce((sum, r) => sum + r.total_price, 0),
          terakhirSewa: rows.length > 0 ? rows.reduce((max, r) => (r.start_date > max ? r.start_date : max), rows[0].start_date) : null,
        };
      }
      setAggregates((prev) => ({ ...prev, ...next }));
    },
    [businessId],
  );

  const loadPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (!supabase || !businessId) {
        setCustomers([]);
        setLoading(false);
        return;
      }
      let query = supabase
        .from('customers')
        .select('id, name, phone, address, note, is_watchlisted, customer_type_id, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .order('id');

      if (searchQuery.trim()) {
        const q = searchQuery.trim();
        query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
      }
      if (typeFilter === 'watchlisted') {
        query = query.eq('is_watchlisted', true);
      } else if (typeFilter !== 'all') {
        query = query.eq('customer_type_id', typeFilter);
      }

      const { data, error } = await query.range(pageNum * PAGE_SIZE, pageNum * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) {
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      const rows = (data as unknown as Customer[]) ?? [];
      setCustomers((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(rows.length === PAGE_SIZE);
      setLoading(false);
      setLoadingMore(false);
      fetchAggregates(rows.map((c) => c.id));
    },
    [businessId, searchQuery, typeFilter, fetchAggregates],
  );

  useEffect(() => {
    setLoading(true);
    setPage(0);
    loadPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, searchQuery, typeFilter]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = page + 1;
    setPage(next);
    await loadPage(next, true);
  }

  async function updateCustomer(
    id: string,
    input: Partial<Pick<Customer, 'name' | 'phone' | 'address' | 'note' | 'is_watchlisted' | 'customer_type_id'>>,
  ) {
    if (!supabase) return { error: 'Belum ada usaha' };
    const { error } = await supabase.from('customers').update(input).eq('id', id);
    if (error) return { error: error.message };
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...input } : c)));
    return { error: null };
  }

  return {
    customers,
    aggregates,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
    updateCustomer,
    refresh: () => loadPage(0, false),
  };
}
