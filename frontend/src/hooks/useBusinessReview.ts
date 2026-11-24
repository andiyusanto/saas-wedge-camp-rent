import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type ConsentType = 'named' | 'anonymized' | 'internal_only';

// Naik versinya kalau TEKS penjelasan izin di LanggananScreen.tsx
// berubah secara substansial -- disimpan apa adanya di setiap baris
// consent (append-only, pola marketplace_consents) supaya riwayat
// mencatat persetujuan itu diberikan atas penjelasan versi berapa.
export const REVIEW_CONSENT_TEXT_VERSION = 'v1-2026-11';

export type BusinessReview = {
  reviewText: string;
  rating: number | null;
  updatedAt: string | null;
  consentType: ConsentType | null;
};

// business_reviews/business_review_consents (migration 074) -- ulasan
// bisa diubah kapan saja (upsert), izin APPEND-ONLY (baris baru tiap
// disimpan, "izin saat ini" = baris created_at terbesar). Owner-only
// lewat RLS, tidak ada RPC -- langsung ke tabel.
export function useBusinessReview(businessId: string | undefined) {
  const [review, setReview] = useState<BusinessReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [reviewRes, consentRes] = await Promise.all([
      supabase.from('business_reviews').select('review_text, rating, updated_at').eq('business_id', businessId).maybeSingle(),
      supabase
        .from('business_review_consents')
        .select('consent_type')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (reviewRes.error) {
      setError(reviewRes.error.message);
    } else {
      setReview({
        reviewText: reviewRes.data?.review_text ?? '',
        rating: reviewRes.data?.rating ?? null,
        updatedAt: reviewRes.data?.updated_at ?? null,
        consentType: (consentRes.data?.consent_type as ConsentType | undefined) ?? null,
      });
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Simpan ulasan + izin SEKALIGUS -- izin wajib dipilih tiap kali
  // menyimpan (brief: "wajib pilih salah satu saat menyimpan"), jadi
  // baris consent baru selalu ditulis bersamaan, bukan cuma saat izin
  // benar-benar berubah (lebih sederhana, dan tetap sesuai "append-only").
  async function save(reviewText: string, rating: number | null, consentType: ConsentType): Promise<{ error: string | null }> {
    if (!supabase || !businessId) return { error: 'Belum terhubung' };
    setSaving(true);
    setError(null);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const { error: reviewError } = await supabase
      .from('business_reviews')
      .upsert({ business_id: businessId, review_text: reviewText, rating, updated_by: userId });

    if (reviewError) {
      setSaving(false);
      setError(reviewError.message);
      return { error: reviewError.message };
    }

    const { error: consentError } = await supabase.from('business_review_consents').insert({
      business_id: businessId,
      consent_type: consentType,
      consent_text_version: REVIEW_CONSENT_TEXT_VERSION,
      created_by: userId,
    });

    if (consentError) {
      setSaving(false);
      setError(consentError.message);
      return { error: consentError.message };
    }

    await refresh();
    setSaving(false);
    return { error: null };
  }

  return { review, loading, saving, error, save };
}
