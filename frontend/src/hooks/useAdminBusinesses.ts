import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type AdminBusinessRow = {
  business_id: string;
  name: string;
  owner_email: string;
  active_until: string | null;
  plan: string | null;
  status: 'aktif' | 'tenggang' | 'hanya-baca';
  signed_up_at: string;
  // Harga Pendiri (migration 060) — lihat lib/subscriptionConfig.ts.
  founder_override: boolean | null;
  founder_price_until: string | null;
  // 3 tingkat harga, Opsi B (migration 074) — lib/subscriptionConfig.ts resolvePriceTier().
  perkenalan_price_until: string | null;
  perkenalan_locked_forever: boolean;
  // Metrik per rental (migration 076, brief admin-metrik-rental) —
  // "Alat aktif" = items NON-deactivated (SENGAJA beda dari Blok 3
  // weekly-metrics.sql yang menghitung semua items, lihat CLAUDE.md).
  active_items_count: number;
  txn_count_month: number;
  txn_value_month: number;
  last_active_date: string | null;
  referred_by_name: string | null;
};

const PAGE_SIZE = 50;

function monthToDateString(month: string | null): string | null {
  // <input type="month"> mengembalikan "YYYY-MM" -- RPC butuh tanggal
  // (date_trunc di dalamnya menormalkan ke tanggal 1 juga, jadi hari
  // apa pun di bulan itu valid, tapi "-01" paling eksplisit).
  if (!month) return null;
  return `${month}-01`;
}

// RPC admin_list_businesses (migration 045, diperluas migration 076) --
// satu-satunya jalur lintas-business untuk admin, is_app_admin() wajib
// di sisi server. Business DEMO sengaja dikecualikan oleh RPC-nya
// sendiri (is_demo_business()) -- bukan sesuatu yang perlu difilter di
// sini.
export function useAdminBusinesses() {
  const [rows, setRows] = useState<AdminBusinessRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  // Params terakhir dipakai -- disimpan supaya ganti halaman tidak perlu
  // caller mengulang query/signupMonth/metricsMonth secara manual, dan
  // supaya refresh SETELAH mutasi (catat pembayaran, dst) tetap di
  // halaman yang sama alih-alih diam-diam melompat ke halaman pertama.
  const lastParamsRef = useRef<{ query: string; signupMonth: string | null; metricsMonth: string | null; page: number }>({
    query: '',
    signupMonth: null,
    metricsMonth: null,
    page: 0,
  });

  const search = useCallback(
    async (query: string, opts?: { signupMonth?: string | null; metricsMonth?: string | null; page?: number }) => {
      if (!supabase) return;
      const signupMonth = opts?.signupMonth ?? lastParamsRef.current.signupMonth;
      const metricsMonth = opts?.metricsMonth ?? lastParamsRef.current.metricsMonth;
      const targetPage = opts?.page ?? lastParamsRef.current.page;
      lastParamsRef.current = { query, signupMonth, metricsMonth, page: targetPage };

      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase.rpc('admin_list_businesses', {
        p_query: query || null,
        p_signup_month: monthToDateString(signupMonth),
        p_metrics_month: monthToDateString(metricsMonth),
        p_limit: PAGE_SIZE,
        p_offset: targetPage * PAGE_SIZE,
      });
      if (err) {
        setError(err.message);
        setRows([]);
        setTotalCount(0);
      } else {
        const list = (data ?? []) as (AdminBusinessRow & { total_count: number })[];
        setRows(list);
        setTotalCount(list.length > 0 ? Number(list[0].total_count) : 0);
        setPage(targetPage);
      }
      setLoading(false);
    },
    [],
  );

  const goToPage = useCallback(
    (targetPage: number) => {
      search(lastParamsRef.current.query, {
        signupMonth: lastParamsRef.current.signupMonth,
        metricsMonth: lastParamsRef.current.metricsMonth,
        page: targetPage,
      });
    },
    [search],
  );

  useEffect(() => {
    search('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { rows, loading, error, search, totalCount, page, pageSize: PAGE_SIZE, goToPage };
}
