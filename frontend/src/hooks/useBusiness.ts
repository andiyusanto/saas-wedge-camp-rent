import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export type Business = {
  id: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
};

export function useBusiness(session: Session | null) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !session) {
      setBusiness(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    // RLS (owner_select_own_business) sudah membatasi ke baris milik user ini.
    const { data } = await supabase
      .from('businesses')
      .select('id, name, owner_name, phone')
      .maybeSingle();

    setBusiness(data);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { business, loading, refresh };
}
