import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type Province = { id: string; name: string };
export type Regency = { id: string; province_id: string; name: string; type: string };

// Publik (RLS "public_read_provinces"/"public_read_regencies",
// skema-final.sql) — seluruh Indonesia sejak migration 033 (38 provinsi,
// 514 kota/kabupaten; belum sampai kecamatan, belum ada fitur yang
// memakainya — lihat CLAUDE.md bagian 3 & 7), bukan cuma Malang Raya lagi.
// Satu hook dipakai bareng oleh Info Usaha (Kelola Usaha) dan Etalase
// Online lewat <RegencySelect>, supaya cuma satu tempat yang fetch data
// wilayah ini.
export function useRegencies() {
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [regencies, setRegencies] = useState<Regency[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    Promise.all([
      supabase.from('provinces').select('id, name').order('name'),
      supabase.from('regencies').select('id, province_id, name, type').order('name'),
    ]).then(([provincesResult, regenciesResult]) => {
      setProvinces(provincesResult.data ?? []);
      setRegencies(regenciesResult.data ?? []);
      setLoading(false);
    });
  }, []);

  return { provinces, regencies, loading };
}
