import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

// Satu-satunya tempat frontend mengecek status admin — RPC is_app_admin()
// (migration 044) sendiri yang jadi sumber kebenaran (baca app_admins,
// RLS-zero-policy sama pola private_config), bukan daftar email di JS.
export function useIsAppAdmin(session: Session | null) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase || !session) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data } = await supabase.rpc('is_app_admin');
      if (!cancelled) {
        setIsAdmin(data === true);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  return { isAdmin, loading };
}
