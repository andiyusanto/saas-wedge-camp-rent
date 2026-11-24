import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { apiFetch } from '../lib/api';

type AdminConfigResponse = { showTxnValue: boolean };

// GET /api/admin/config (brief admin-metrik-rental 24 Nov 2026) --
// flag ADMIN_SHOW_TXN_VALUE, env backend, default mati. Gerbang
// TAMPILAN (kolom "Nilai transaksi" + CSV), bukan kontrol akses --
// angkanya sendiri sudah dihitung penuh di admin_list_businesses
// (migration 076) terlepas dari flag ini.
export function useAdminConfig(session: Session) {
  const [showTxnValue, setShowTxnValue] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const body = await apiFetch<AdminConfigResponse>(session, '/api/admin/config');
        if (cancelled) return;
        setShowTxnValue(body.showTxnValue);
      } catch {
        if (cancelled) return;
        setShowTxnValue(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  return { showTxnValue, loading };
}
