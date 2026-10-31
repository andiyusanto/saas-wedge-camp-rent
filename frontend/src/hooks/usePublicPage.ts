import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Rencana 2.8/2.8b (tahap 4) — kolom pesanan online + cara bayar/DP,
// migration 037. Semuanya owner-only untuk DIUBAH (RLS sudah membatasi
// update ke is_owner_of, migration 019 — kolom baru tunduk policy yang
// sama, tidak perlu policy terpisah).
export type DpMode = 'none' | 'percent' | 'fixed';

export type PublicPage = {
  business_id: string;
  published: boolean;
  slug: string | null;
  description: string | null;
  address: string | null;
  regency_id: string | null;
  operating_hours: string | null;
  public_phone: string | null;
  accept_online_orders: boolean;
  confirmation_message: string | null;
  pay_transfer_enabled: boolean;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  pay_qris_enabled: boolean;
  qris_image_url: string | null;
  pay_cash_enabled: boolean;
  dp_mode: DpMode;
  dp_value: number | null;
};

export type PublicPageInput = {
  published: boolean;
  slug: string;
  description: string | null;
  address: string | null;
  regency_id: string | null;
  operating_hours: string | null;
  public_phone: string | null;
  accept_online_orders: boolean;
  confirmation_message: string | null;
  pay_transfer_enabled: boolean;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  pay_qris_enabled: boolean;
  qris_image_url: string | null;
  pay_cash_enabled: boolean;
  dp_mode: DpMode;
  dp_value: number | null;
};

export type PaymentChangeLog = {
  created_at: string;
  changed_by: string | null;
  changed_by_email: string | null;
};

// Belum ada baris sama sekali sampai vendor pertama kali menyimpan lewat
// tab Etalase Online (business_id primary key, tidak dibuat otomatis saat
// signup) — beda dari useBusiness() yang baris businesses-nya sudah pasti
// ada sejak awal.
export function usePublicPage(businessId: string | null) {
  const [page, setPage] = useState<PublicPage | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setPage(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from('public_pages')
      .select(
        'business_id, published, slug, description, address, regency_id, operating_hours, public_phone, accept_online_orders, confirmation_message, pay_transfer_enabled, bank_name, bank_account_number, bank_account_holder, pay_qris_enabled, qris_image_url, pay_cash_enabled, dp_mode, dp_value',
      )
      .eq('business_id', businessId)
      .maybeSingle();

    setPage(data ?? null);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Upsert manual (bukan .upsert()) supaya insert pertama kalinya jelas
  // menyertakan business_id (primary key), dan update sesudahnya tidak
  // perlu mengulang business_id di payload.
  async function savePublicPage(input: PublicPageInput) {
    if (!supabase || !businessId) return { error: 'Belum login' };

    const payload = { business_id: businessId, ...input };
    const { error } = page
      ? await supabase.from('public_pages').update(input).eq('business_id', businessId)
      : await supabase.from('public_pages').insert(payload);

    if (error) {
      // 23505 = unique_violation — satu-satunya constraint unik di tabel
      // ini adalah slug, jadi pesan generiknya aman diasumsikan soal itu.
      if (error.code === '23505') {
        return { error: `Slug "${input.slug}" sudah dipakai usaha lain, coba slug lain.` };
      }
      return { error: error.message };
    }

    await refresh();
    return { error: null };
  }

  // Cek live sambil ketik (dipanggil debounced dari EtalaseOnlineScreen) —
  // lewat RPC is_slug_available() (migration 022), SECURITY DEFINER, karena
  // RLS public_pages cuma izinkan owner lihat baris miliknya sendiri: tanpa
  // RPC ini, slug yang dipakai business LAIN akan salah kelihatan
  // "tersedia" di sisi klien (baru ketahuan bentrok saat Simpan, lewat
  // unique constraint di savePublicPage() di atas — itu tetap jadi
  // penjaga utama, ini cuma feedback lebih awal).
  async function checkSlugAvailable(slug: string): Promise<{ available: boolean | null; error: string | null }> {
    if (!supabase || !businessId) return { available: null, error: 'Belum login' };
    const { data, error } = await supabase.rpc('is_slug_available', { p_slug: slug, p_business_id: businessId });
    if (error) return { available: null, error: error.message };
    return { available: data as boolean, error: null };
  }

  // Review -c1 (tahap 4, poin 5): pemberitahuan "info pembayaran terakhir
  // diubah oleh X" — public_page_payment_changes.changed_by cuma auth.uid()
  // (uuid), tidak ada kolom email di tabel itu sendiri (sengaja, lihat
  // migration 037, append-only lewat trigger). Email diambil lewat JOIN
  // CLIENT-SIDE ke business_members.email (snapshot, migration 010) —
  // tidak ada FK langsung changed_by->business_members buat PostgREST
  // embed otomatis, jadi dua query terpisah, bukan satu nested select.
  async function fetchLatestPaymentChange(): Promise<PaymentChangeLog | null> {
    if (!supabase || !businessId) return null;
    const { data: changeRow } = await supabase
      .from('public_page_payment_changes')
      .select('created_at, changed_by')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!changeRow) return null;

    let email: string | null = null;
    if (changeRow.changed_by) {
      const { data: memberRow } = await supabase
        .from('business_members')
        .select('email')
        .eq('business_id', businessId)
        .eq('user_id', changeRow.changed_by)
        .maybeSingle();
      email = memberRow?.email ?? null;
    }

    return { created_at: changeRow.created_at, changed_by: changeRow.changed_by, changed_by_email: email };
  }

  return { page, loading, refresh, savePublicPage, checkSlugAvailable, fetchLatestPaymentChange };
}
