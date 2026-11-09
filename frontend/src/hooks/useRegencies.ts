import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type Province = { id: string; name: string };
export type Regency = { id: string; province_id: string; name: string; type: string };

// Publik (RLS "public_read_provinces"/"public_read_regencies",
// skema-final.sql) — seluruh Indonesia sejak migration 033 (38 provinsi,
// 514 kota/kabupaten; kecamatan sejak migration 052, diambil terpisah
// per kota lewat useDistricts — lihat CLAUDE.md bagian 7), bukan cuma Malang Raya lagi.
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

export type District = { id: string; regency_id: string; name: string };

// Kecamatan per kota/kabupaten (7.285 baris se-Indonesia, migration 052) --
// sengaja tidak di-fetch sekaligus, cuma kecamatan kota yang dipilih.
export function useDistricts(regencyId: string) {
  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!regencyId || !supabase) {
      setDistricts([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from('districts')
      .select('id, regency_id, name')
      .eq('regency_id', regencyId)
      .order('name')
      .then(({ data }) => {
        if (cancelled) return;
        setDistricts(data ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [regencyId]);

  return { districts, loading };
}

// Zona waktu per rental (migration 053, businesses.timezone). Dipakai server
// untuk "hari ini", batas denda telat, dan kedaluwarsa Pesanan Online.
export type BusinessTimezone = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura';

export const TIMEZONE_OPTIONS: { value: BusinessTimezone; label: string }[] = [
  { value: 'Asia/Jakarta', label: 'WIB (UTC+7) — Sumatera, Jawa, Kalbar, Kalteng' },
  { value: 'Asia/Makassar', label: 'WITA (UTC+8) — Bali, NTB, NTT, Kalsel, Kaltim, Kaltara, Sulawesi' },
  { value: 'Asia/Jayapura', label: 'WIT (UTC+9) — Maluku, Papua' },
];

const WITA_PROVINCES = new Set([
  'Bali', 'Nusa Tenggara Barat', 'Nusa Tenggara Timur', 'Kalimantan Selatan', 'Kalimantan Timur',
  'Kalimantan Utara', 'Sulawesi Utara', 'Sulawesi Tengah', 'Sulawesi Selatan', 'Sulawesi Tenggara',
  'Gorontalo', 'Sulawesi Barat',
]);
const WIT_PROVINCES = new Set([
  'Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Selatan', 'Papua Tengah', 'Papua Pegunungan',
  'Papua Barat Daya',
]);

// Cuma SARAN di UI — tidak pernah mengganti pengaturan otomatis.
export function suggestedTimezoneForProvince(provinceName: string | undefined): BusinessTimezone | null {
  if (!provinceName) return null;
  if (WITA_PROVINCES.has(provinceName)) return 'Asia/Makassar';
  if (WIT_PROVINCES.has(provinceName)) return 'Asia/Jayapura';
  return 'Asia/Jakarta';
}
