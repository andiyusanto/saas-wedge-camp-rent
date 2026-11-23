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

// Dipakai melanjutkan Draf Transaksi (brief 23 Nov 2026) -- draf cuma
// menyimpan selectedCustomerId, jenis diskon/Waspada pelanggan itu
// dibaca ULANG dari sini (live), bukan disimpan di draf (bisa sudah
// berubah sejak draf dibuat). null kalau pelanggan sudah dihapus (jarang
// -- tidak ada tombol hapus customer di app ini).
export async function findCustomerById(customerId: string): Promise<CustomerMatch | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('customers')
    .select('id, name, phone, address, customer_type_id, is_watchlisted, note')
    .eq('id', customerId)
    .limit(1);
  return (data?.[0] as CustomerMatch | undefined) ?? null;
}

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
// PostgREST max_rows = 1.000 (CLAUDE.md bagian 7) memotong hasil DIAM-DIAM
// -- business dengan >1.000 pelanggan akan gagal cocok tanpa error apa pun
// kalau fetch di atas cuma satu query polos. Paginasi lewat .range() sampai
// benar2 habis, dengan .order('id') deterministik (pola fetchAllPages()
// backend/src/lib/availability.ts). Select cukup id/phone/created_at
// (bukan seluruh kolom CustomerMatch) supaya tiap halaman ringan --
// detail lengkap baru diambil SEKALI untuk baris yang akhirnya cocok.
async function fetchAllCustomerPhonePagesClient(
  businessId: string,
): Promise<{ id: string; phone: string | null; created_at: string }[]> {
  const PAGE_SIZE = 1000;
  const rows: { id: string; phone: string | null; created_at: string }[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase!
      .from('customers')
      .select('id, phone, created_at')
      .eq('business_id', businessId)
      .not('phone', 'is', null)
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function findCustomerByPhone(businessId: string, phone: string): Promise<CustomerMatch | null> {
  if (!supabase || !phone.trim()) return null;
  const target = normalizePhoneClient(phone);
  if (!target) return null;

  const candidates = await fetchAllCustomerPhonePagesClient(businessId);
  const matches = candidates.filter((c) => c.phone && normalizePhoneClient(c.phone) === target);
  if (matches.length === 0) return null;
  // Duplikat lama -- pakai yang paling baru DIBUAT sebagai proxy "paling
  // baru dipakai" (cukup untuk pratinjau sebelum submit; keputusan akhir
  // tetap di backend createBookingAtomic yang memakai booking TERAKHIR
  // sungguhan, bukan cuma customers.created_at).
  matches.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const { data: full } = await supabase
    .from('customers')
    .select('id, name, phone, address, customer_type_id, is_watchlisted, note')
    .eq('id', matches[0].id)
    .limit(1);
  return (full?.[0] as CustomerMatch | undefined) ?? null;
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
