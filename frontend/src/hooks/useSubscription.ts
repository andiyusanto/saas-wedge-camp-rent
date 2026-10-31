import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type SubscriptionStatus = 'aktif' | 'tenggang' | 'hanya-baca';

export type Subscription = {
  plan: string | null;
  activeUntil: string; // YYYY-MM-DD
  writable: boolean;
  status: SubscriptionStatus;
  // Hari tersisa sampai active_until (negatif kalau sudah lewat) — CUMA
  // dipakai untuk teks banner ("H-7", "sisa N hari tenggang"), BUKAN
  // untuk menentukan writable (itu SELALU dari RPC business_is_writable,
  // satu sumber kebenaran — review -c1: jangan duplikasi aturan
  // tenggang 7 hari di JS).
  daysUntilActiveUntil: number;
};

// todayStr() ala frontend/src/utils/formatters.ts — waktu LOKAL BROWSER
// (CLAUDE.md bagian 4: device vendor fisik di WIB, browser local sudah
// benar tanpa offset manual), dipakai CUMA untuk hitung selisih hari
// buat teks banner, bukan buat putuskan writable.
function todayLocalDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function useSubscription(businessId: string | null) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase || !businessId) {
        setSubscription(null);
        setLoading(false);
        return;
      }
      setLoading(true);

      const [{ data: subRow }, { data: writable }] = await Promise.all([
        supabase.from('subscriptions').select('plan, active_until').eq('business_id', businessId).maybeSingle(),
        supabase.rpc('business_is_writable', { p_business_id: businessId }),
      ]);

      if (cancelled) return;

      // Tidak ada baris (seharusnya tidak pernah terjadi setelah backfill
      // migration 044 + trigger businesses baru, tapi RPC sendiri sudah
      // fail-safe return true kalau ini terjadi) — tetap tampilkan
      // 'aktif', jangan pernah diam-diam kunci.
      const activeUntil = subRow?.active_until ?? '9999-12-31';
      const isWritable = writable !== false;

      const activeUntilDate = new Date(`${activeUntil}T00:00:00`);
      const diffDays = Math.round((activeUntilDate.getTime() - todayLocalDate().getTime()) / 86_400_000);

      let status: SubscriptionStatus;
      if (!isWritable) status = 'hanya-baca';
      else if (diffDays < 0) status = 'tenggang';
      else status = 'aktif';

      setSubscription({ plan: subRow?.plan ?? null, activeUntil, writable: isWritable, status, daysUntilActiveUntil: diffDays });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return { subscription, loading };
}
