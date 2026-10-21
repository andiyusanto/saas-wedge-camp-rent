import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type PublicPage = {
  business_id: string;
  published: boolean;
  slug: string | null;
  description: string | null;
  address: string | null;
  regency_id: string | null;
  operating_hours: string | null;
  public_phone: string | null;
};

export type PublicPageInput = {
  published: boolean;
  slug: string;
  description: string | null;
  address: string | null;
  regency_id: string | null;
  operating_hours: string | null;
  public_phone: string | null;
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
      .select('business_id, published, slug, description, address, regency_id, operating_hours, public_phone')
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

  return { page, loading, refresh, savePublicPage, checkSlugAvailable };
}
