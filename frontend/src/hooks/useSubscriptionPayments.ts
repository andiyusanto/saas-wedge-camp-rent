import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type SubscriptionPayment = {
  id: string;
  amount: number;
  period_days: number;
  method: string;
  note: string | null;
  created_at: string;
};

// Baca-saja — satu-satunya jalur TULIS ke tabel ini adalah RPC
// record_subscription_payment (migration 044, admin-only); vendor cuma
// SELECT lewat policy owner_select_own_subscription_payments.
export function useSubscriptionPayments(businessId: string | null) {
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase || !businessId) {
        setPayments([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data } = await supabase
        .from('subscription_payments')
        .select('id, amount, period_days, method, note, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });
      if (!cancelled) {
        setPayments((data ?? []) as SubscriptionPayment[]);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return { payments, loading };
}
