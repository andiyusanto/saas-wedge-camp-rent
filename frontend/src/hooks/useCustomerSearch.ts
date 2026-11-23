import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type CustomerMatch = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  // Pelanggan + Member/Diskon (brief 23 Nov 2026) -- dipakai NewBookingModal.tsx
  // menampilkan tanda "Member -10%" / banner Waspada saat pelanggan lama
  // dipilih dari daftar saran.
  customer_type_id: string | null;
  is_watchlisted: boolean;
  note: string | null;
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
        .select('id, name, phone, address, customer_type_id, is_watchlisted, note')
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

// Konfirmasi Pesanan Online (brief 23 Nov 2026, poin D koordinator) --
// kalau nomor WA pemesan cocok persis dengan pelanggan yang SUDAH ADA,
// pelanggan itu otomatis terpilih (bukan selalu dianggap pelanggan baru)
// supaya jenis/diskonnya ikut terpakai saat Konfirmasi. Pencarian EXACT
// match (bukan ilike seperti search() di atas) -- nomor WA sendiri sudah
// unik secara praktik, pencocokan fuzzy di sini berisiko salah pasang ke
// orang lain.
export async function findCustomerByPhone(businessId: string, phone: string): Promise<CustomerMatch | null> {
  if (!supabase || !phone.trim()) return null;
  const { data } = await supabase
    .from('customers')
    .select('id, name, phone, address, customer_type_id, is_watchlisted, note')
    .eq('business_id', businessId)
    .eq('phone', phone.trim())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CustomerMatch | null) ?? null;
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
