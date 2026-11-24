import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type SubscriptionPayment = {
  id: string;
  amount: number;
  // Tabel subscription_payments (migration 044) TIDAK punya kolom
  // `period_days` -- yang tersimpan adalah `period_start`/`period_end`
  // (tanggal). `period_days` dihitung di sini (inklusif kedua ujung,
  // pola sama `period_start_date + p_period_days - 1 = new_active_until`
  // di record_subscription_payment) supaya UI yang sudah ada (label
  // "N hari" di Riwayat Pembayaran/Nota langganan) tidak perlu berubah.
  period_days: number;
  method: string;
  note: string | null;
  created_at: string;
};

type SubscriptionPaymentRow = {
  id: string;
  amount: number;
  period_start: string;
  period_end: string;
  method: string;
  note: string | null;
  created_at: string;
};

function daysBetweenInclusive(start: string, end: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / msPerDay) + 1;
}

// Baca-saja — satu-satunya jalur TULIS ke tabel ini adalah RPC
// record_subscription_payment (migration 044, admin-only); vendor cuma
// SELECT lewat policy owner_select_own_subscription_payments.
export function useSubscriptionPayments(businessId: string | null) {
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase || !businessId) {
        setPayments([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('subscription_payments')
        .select('id, amount, period_start, period_end, method, note, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });
      if (!cancelled) {
        if (err) {
          setPayments([]);
          setError(err.message);
        } else {
          setPayments(
            ((data ?? []) as SubscriptionPaymentRow[]).map((row) => ({
              id: row.id,
              amount: row.amount,
              period_days: daysBetweenInclusive(row.period_start, row.period_end),
              method: row.method,
              note: row.note,
              created_at: row.created_at,
            })),
          );
        }
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return { payments, loading, error };
}
