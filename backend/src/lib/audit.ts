import type { SupabaseClient } from '@supabase/supabase-js';

// Dipindah dari team.ts (private helper getCallerRole) supaya dipakai
// ulang oleh endpoint lain yang perlu membedakan owner vs karyawan,
// mis. Batalkan/Void (brief 17 Nov 2026) -- null kalau bukan anggota
// business ini sama sekali (dicek pemanggil, bukan di sini).
export async function getCallerRole(supabase: SupabaseClient, businessId: string): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;

  const { data } = await supabase
    .from('business_members')
    .select('role')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .maybeSingle();

  return data?.role ?? null;
}

// Nama tampilan untuk riwayat (Ubah Jadwal/Perpanjang, migration 055) —
// skema ini TIDAK punya kolom nama untuk karyawan sama sekali (business_
// members cuma user_id+role), jadi satu-satunya nama asli yang bisa
// ditampilkan adalah businesses.owner_name, dan HANYA kalau pelakunya
// memang owner business itu sendiri (actorUserId === businesses.owner_id).
// Review -c1 10 Nov 2026: supaya riwayat tampil "oleh Rudi" bukan email
// mentah, kalau datanya ada — karyawan tetap jatuh balik ke email karena
// memang tidak ada nama lain untuk ditampilkan.
export async function resolveActorName(
  supabase: SupabaseClient,
  businessId: string,
  actorUserId: string,
  actorEmail: string,
): Promise<string> {
  const { data } = await supabase.from('businesses').select('owner_id, owner_name').eq('id', businessId).maybeSingle();
  if (data && data.owner_id === actorUserId && data.owner_name) {
    return data.owner_name;
  }
  return actorEmail;
}

// Best-effort: gagal mencatat riwayat status tidak boleh menggagalkan
// operasi utamanya (booking sudah berhasil diproses saat fungsi ini
// dipanggil) — cukup dicatat ke log server untuk investigasi kalau perlu.
export async function logBookingStatus(
  supabase: SupabaseClient,
  bookingId: string,
  status: string,
  changedBy: string,
  changedByName: string,
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.from('booking_status_history').insert({
    booking_id: bookingId,
    status,
    changed_by: changedBy,
    changed_by_name: changedByName,
    reason: reason ?? null,
  });

  if (error) {
    console.error('Gagal mencatat booking_status_history:', error.message);
  }
}

// Riwayat Ubah Jadwal/Perpanjang (Tahap 2, migration 055) — append-only,
// pola sama seperti logBookingStatus() di atas (best-effort, tidak
// menggagalkan operasi utama yang sudah berhasil lebih dulu).
export async function logBookingReschedule(
  supabase: SupabaseClient,
  params: {
    bookingId: string;
    businessId: string;
    action: 'ubah_jadwal' | 'perpanjang';
    oldStartDate: string;
    oldEndDate: string;
    newStartDate: string;
    newEndDate: string;
    oldTotalPrice: number;
    newTotalPrice: number;
    reason: string | null;
    pastDeadline: boolean;
    changedBy: string;
    changedByName: string;
  },
): Promise<void> {
  const { error } = await supabase.from('booking_reschedules').insert({
    booking_id: params.bookingId,
    business_id: params.businessId,
    action: params.action,
    old_start_date: params.oldStartDate,
    old_end_date: params.oldEndDate,
    new_start_date: params.newStartDate,
    new_end_date: params.newEndDate,
    old_total_price: params.oldTotalPrice,
    new_total_price: params.newTotalPrice,
    reason: params.reason,
    past_deadline: params.pastDeadline,
    changed_by: params.changedBy,
    changed_by_name: params.changedByName,
  });

  if (error) {
    console.error('Gagal mencatat booking_reschedules:', error.message);
  }
}
