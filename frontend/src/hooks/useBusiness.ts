import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export type Business = {
  id: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  regency_id: string | null;
  late_tolerance_hours: number;
  logo_url: string | null;
};

export type BusinessUpdateInput = {
  name: string;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  regency_id: string | null;
  late_tolerance_hours: number;
  logo_url: string | null;
};

export type MemberRole = 'owner' | 'karyawan';

export function useBusiness(session: Session | null) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase || !session) {
      setBusiness(null);
      setRole(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    // RLS (members_select_own_business) sudah membatasi ke baris milik user ini.
    const { data, error: queryError } = await supabase
      .from('businesses')
      .select('id, name, owner_name, phone, address, regency_id, late_tolerance_hours, logo_url')
      .maybeSingle();

    // PENTING: error di sini (mis. PGRST116 "multiple rows" kalau akun ini
    // somehow jadi anggota lebih dari satu business — lihat diskusi soal
    // redeem undangan ganda) dulu diam-diam dibuang, jadi business jatuh
    // ke null tanpa pesan apapun dan App.tsx mengira "user baru belum
    // punya business" lalu merender OnboardingScreen — padahal yang benar
    // terjadi adalah ERROR, bukan "belum ada data". Sekarang errornya
    // disimpan dan ditampilkan (lihat App.tsx), bukan ditimpa jadi
    // OnboardingScreen yang bisa bikin user tanpa sadar membuat business
    // baru lagi. Ini BUKAN fitur pindah-bisnis/multi-bisnis — cuma
    // berhenti menyembunyikan errornya.
    if (queryError) {
      setBusiness(null);
      setRole(null);
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setError(null);
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

  // RLS (owner_update_own_business, migration 018) menolak update kalau
  // pemanggil bukan owner — pesan error dari Supabase yang muncul di UI
  // kalau karyawan somehow memanggil ini (seharusnya tidak bisa, tombolnya
  // sudah disembunyikan dari UI untuk karyawan).
  async function updateBusiness(input: BusinessUpdateInput) {
    if (!supabase || !business) return { error: 'Belum login' };
    const { error } = await supabase
      .from('businesses')
      .update({
        name: input.name,
        owner_name: input.owner_name,
        phone: input.phone,
        address: input.address,
        regency_id: input.regency_id,
        late_tolerance_hours: input.late_tolerance_hours,
        logo_url: input.logo_url,
      })
      .eq('id', business.id);

    if (error) return { error: error.message };
    await refresh();
    return { error: null };
  }

  return { business, role, loading, error, refresh, updateBusiness };
}
