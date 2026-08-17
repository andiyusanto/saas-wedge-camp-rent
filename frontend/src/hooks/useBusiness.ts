import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export type Business = {
  id: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
};

export type MemberRole = 'owner' | 'karyawan';

export function useBusiness(session: Session | null) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !session) {
      setBusiness(null);
      setRole(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    // RLS (members_select_own_business) sudah membatasi ke baris milik user ini.
    const { data } = await supabase
      .from('businesses')
      .select('id, name, owner_name, phone')
      .maybeSingle();

    setBusiness(data);

    if (data) {
      // Dipakai buat menyembunyikan menu Kelola Karyawan dari karyawan
      // (lihat migration 014 — pengecualian pertama dari prinsip "karyawan
      // akses penuh", khusus manajemen tim).
      const { data: memberRow } = await supabase
        .from('business_members')
        .select('role')
        .eq('business_id', data.id)
        .eq('user_id', session.user.id)
        .maybeSingle();
      setRole((memberRow?.role as MemberRole) ?? null);
    } else {
      setRole(null);
    }

    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { business, role, loading, refresh };
}
