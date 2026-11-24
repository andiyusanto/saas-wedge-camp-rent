import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import type { DurationLabelStyle, RentalDayMode } from '../utils/formatters';
import type { BusinessTimezone } from './useRegencies';

export type Business = {
  id: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  regency_id: string | null;
  district_id: string | null; // kecamatan, opsional (migration 052)
  late_tolerance_hours: number;
  logo_url: string | null;
  timezone: BusinessTimezone; // migration 053, default WIB
  // Cara hitung durasi sewa (migration 049) — setting LIVE, dipakai
  // untuk transaksi BARU (NewBookingModal). Transaksi yang sudah dibuat
  // punya snapshot sendiri di bookings.rental_day_mode, tidak ikut
  // berubah kalau ini diganti (lihat utils/formatters.ts).
  rental_day_mode: RentalDayMode;
  // Label lama sewa "2H1M" (migration 072) -- setting LIVE, owner-only,
  // cuma tampil kalau rental_day_mode='per_malam' (BusinessInfoSection.tsx).
  // Transaksi yang sudah dibuat punya snapshot sendiri di
  // bookings.duration_label_style.
  duration_label_style: Exclude<DurationLabelStyle, null>;
  // Paket minimal/maksimal hari sewa (migration 054) — setting LIVE,
  // nullable = tanpa batas. Transaksi yang sudah dibuat punya snapshot
  // sendiri di bookings.min_rental_days/max_rental_days.
  min_rental_days: number | null;
  max_rental_days: number | null;
  // "Ubah jadwal paling lambat H-N hari sebelum tanggal ambil" (Tahap 2,
  // migration 055) — nullable, null = kapan saja sebelum diambil. Cuma
  // PERINGATAN (RescheduleModal.tsx), tidak pernah menolak permintaan.
  reschedule_deadline_days: number | null;
  // Batas jam kembali tetap (migration 062) — setting LIVE, nullable =
  // ikuti jam ambil (default, perilaku sebelum fitur ini ada). Transaksi
  // yang sudah dibuat punya snapshot sendiri di bookings.return_deadline_time.
  return_deadline_time: string | null;
  return_deadline_next_day: boolean;
  // Cara hitung denda telat (migration 063) — setting LIVE, selalu ada
  // nilai (NOT NULL di DB, beda dari Batas jam kembali yang opsional).
  // Transaksi yang sudah dibuat punya snapshot sendiri di
  // bookings.late_fee_mode (null di sana = 'bertahap_12jam').
  late_fee_mode: 'bertahap_12jam' | 'per_hari_24jam' | 'per_jam' | 'tanpa_denda';
  late_fee_per_hour: number | null;
  late_fee_per_hour_cap_enabled: boolean;
  // Ajak Rental Lain / referral (migration 074) — dibuat otomatis saat
  // business dibuat (trigger), tidak pernah null untuk business baru.
  referral_code: string;
  created_at: string;
};

export type BusinessUpdateInput = {
  name: string;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  regency_id: string | null;
  district_id: string | null; // kecamatan, opsional (migration 052)
  late_tolerance_hours: number;
  logo_url: string | null;
  rental_day_mode: RentalDayMode;
  duration_label_style: Exclude<DurationLabelStyle, null>;
  timezone: BusinessTimezone;
  min_rental_days: number | null;
  max_rental_days: number | null;
  reschedule_deadline_days: number | null;
  return_deadline_time: string | null;
  return_deadline_next_day: boolean;
  late_fee_mode: 'bertahap_12jam' | 'per_hari_24jam' | 'per_jam' | 'tanpa_denda';
  late_fee_per_hour: number | null;
  late_fee_per_hour_cap_enabled: boolean;
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
      .select('id, name, owner_name, phone, address, regency_id, district_id, late_tolerance_hours, logo_url, rental_day_mode, duration_label_style, timezone, min_rental_days, max_rental_days, reschedule_deadline_days, return_deadline_time, return_deadline_next_day, late_fee_mode, late_fee_per_hour, late_fee_per_hour_cap_enabled, referral_code, created_at')
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
        district_id: input.district_id,
        late_tolerance_hours: input.late_tolerance_hours,
        logo_url: input.logo_url,
        rental_day_mode: input.rental_day_mode,
        duration_label_style: input.duration_label_style,
        timezone: input.timezone,
        min_rental_days: input.min_rental_days,
        max_rental_days: input.max_rental_days,
        reschedule_deadline_days: input.reschedule_deadline_days,
        return_deadline_time: input.return_deadline_time,
        return_deadline_next_day: input.return_deadline_next_day,
        late_fee_mode: input.late_fee_mode,
        late_fee_per_hour: input.late_fee_per_hour,
        late_fee_per_hour_cap_enabled: input.late_fee_per_hour_cap_enabled,
      })
      .eq('id', business.id);

    if (error) return { error: error.message };
    await refresh();
    return { error: null };
  }

  return { business, role, loading, error, refresh, updateBusiness };
}
