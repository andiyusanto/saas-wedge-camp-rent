import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type AdminBusinessRow = {
  business_id: string;
  name: string;
  owner_email: string;
  active_until: string | null;
  plan: string | null;
  status: 'aktif' | 'tenggang' | 'hanya-baca';
  signed_up_at: string;
};

// RPC admin_list_businesses (migration 045) — satu-satunya jalur lintas-
// business untuk admin, is_app_admin() wajib di sisi server, lihat
// migrations/045_admin_list_businesses.sql.
export function useAdminBusinesses() {
  const [rows, setRows] = useState<AdminBusinessRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('admin_list_businesses', { p_query: query || null });
    if (err) {
      setError(err.message);
      setRows([]);
    } else {
      setRows((data ?? []) as AdminBusinessRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    search('');
  }, [search]);

  return { rows, loading, error, search };
}
