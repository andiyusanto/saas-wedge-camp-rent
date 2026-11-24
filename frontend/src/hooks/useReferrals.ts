import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type ReferralStatus = 'terdaftar' | 'siap_diklaim' | 'diklaim' | 'melewati_batas';

export type ReferralRow = {
  id: string;
  referred_business_name: string;
  status: ReferralStatus;
  created_at: string;
  first_payment_at: string | null;
  claimed_at: string | null;
};

// list_my_referrals (migration 074) -- SATU-SATUNYA jalur baca, kolom
// yang diexpose dibatasi eksplisit di RPC-nya sendiri (nama rental
// yang diajak SAJA, bukan query tabel `referrals` langsung).
export function useReferrals(businessId: string | undefined) {
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('list_my_referrals', { p_business_id: businessId });
    if (err) {
      setError(err.message);
      setReferrals([]);
    } else {
      setReferrals((data ?? []) as ReferralRow[]);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // claim_referral_bonus (migration 074) -- idempoten di server (klaim
  // dua kali = no-op sukses, bukan error), lock FOR UPDATE di dalam RPC.
  async function claimBonus(referralId: string): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'Belum terhubung' };
    const { error: err } = await supabase.rpc('claim_referral_bonus', { p_referral_id: referralId });
    if (err) return { error: err.message };
    await refresh();
    return { error: null };
  }

  return { referrals, loading, error, refresh, claimBonus };
}
