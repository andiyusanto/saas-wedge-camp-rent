import type { SupabaseClient } from '@supabase/supabase-js';

// Best-effort: gagal mencatat riwayat status tidak boleh menggagalkan
// operasi utamanya (booking sudah berhasil diproses saat fungsi ini
// dipanggil) — cukup dicatat ke log server untuk investigasi kalau perlu.
export async function logBookingStatus(
  supabase: SupabaseClient,
  bookingId: string,
  status: string,
  changedBy: string,
  changedByName: string,
): Promise<void> {
  const { error } = await supabase.from('booking_status_history').insert({
    booking_id: bookingId,
    status,
    changed_by: changedBy,
    changed_by_name: changedByName,
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
