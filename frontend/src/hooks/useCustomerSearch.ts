import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type CustomerMatch = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
};

export type CustomerHistorySummary = {
  count: number;
  lastBookingDate: string | null;
};

// Cari pelanggan lama saat mengisi Catat Transaksi, supaya penyewa yang
// sama tidak selalu bikin baris `customers` baru (setiap transaksi dulu
// selalu insert baru, tidak ada riwayat per orang). Query langsung ke
// Supabase (pola sama seperti useHistory.ts) — di-debounce di pemanggil,
// bukan di sini.
export function useCustomerSearch(businessId: string | undefined) {
  const [results, setResults] = useState<CustomerMatch[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!supabase || !businessId || trimmed.length < 2) {
        setResults([]);
        return;
      }
      // koma/persen bisa merusak sintaks filter .or(), aman dihapus saja
      // dari pencarian (bukan karakter yang wajar ada di nama/nomor HP).
      const safeQuery = trimmed.replace(/[,%]/g, '');
      if (!safeQuery) {
        setResults([]);
        return;
      }

      setSearching(true);
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone, address')
        .eq('business_id', businessId)
        .or(`name.ilike.%${safeQuery}%,phone.ilike.%${safeQuery}%,address.ilike.%${safeQuery}%`)
        .order('name')
        .limit(8);
      setResults((data as CustomerMatch[] | null) ?? []);
      setSearching(false);
    },
    [businessId],
  );

  const clear = useCallback(() => setResults([]), []);

  return { results, searching, search, clear };
}

export async function fetchCustomerHistorySummary(customerId: string): Promise<CustomerHistorySummary> {
  if (!supabase) return { count: 0, lastBookingDate: null };
  const { data, count } = await supabase
    .from('bookings')
    .select('start_date', { count: 'exact' })
    .eq('customer_id', customerId)
    .order('start_date', { ascending: false })
    .limit(1);
  return { count: count ?? 0, lastBookingDate: data?.[0]?.start_date ?? null };
}
