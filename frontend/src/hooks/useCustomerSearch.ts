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

// normalizePhoneClient(): salinan frontend dari backend/src/lib/phone.ts
// normalizePhone() -- runtime terpisah (pola sama endDateForDaysClient di
// routes/etalase.ts), rumus SENGAJA identik: buang spasi/strip, buang '+'
// depan, 08xx -> 628xx. customers.phone TIDAK dinormalisasi saat
// disimpan, jadi dua nomor yang sama secara makna tapi beda format harus
// dicocokkan di APLIKASI, bukan `.eq()` langsung ke kolom mentah.
export function normalizePhoneClient(raw: string): string {
  const stripped = raw.replace(/[\s-]/g, '').replace(/^\+/, '');
  if (stripped.startsWith('0')) return `62${stripped.slice(1)}`;
  return stripped;
}

// Cocokkan pelanggan existing via nomor WA -- dipakai (a) Konfirmasi
// Pesanan Online (brief 23 Nov 2026, poin D koordinator) dan (b) saran
// "Pelanggan terdaftar" real-time saat staf mengetik WA di Catat
// Transaksi (brief tugas kecil 23 Nov 2026). Fetch SEMUA nomor business
// ini lalu normalize+compare di JS (pola sama backend findCustomerIdByPhone,
// routes/bookings.ts) -- bukan `.eq()` mentah, supaya 08xx/628xx/+628xx/
// spasi-strip yang merujuk nomor fisik sama tetap cocok.
export async function findCustomerByPhone(businessId: string, phone: string): Promise<CustomerMatch | null> {
  if (!supabase || !phone.trim()) return null;
  const target = normalizePhoneClient(phone);
  if (!target) return null;

  const { data } = await supabase
    .from('customers')
    .select('id, name, phone, address, customer_type_id, is_watchlisted, note, created_at')
    .eq('business_id', businessId)
    .not('phone', 'is', null);
  const matches = ((data as (CustomerMatch & { created_at: string })[] | null) ?? []).filter(
    (c) => c.phone && normalizePhoneClient(c.phone) === target,
  );
  if (matches.length === 0) return null;
  // Duplikat lama -- pakai yang paling baru DIBUAT sebagai proxy "paling
  // baru dipakai" (cukup untuk pratinjau sebelum submit; keputusan akhir
  // tetap di backend createBookingAtomic yang memakai booking TERAKHIR
  // sungguhan, bukan cuma customers.created_at).
  matches.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return matches[0];
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
