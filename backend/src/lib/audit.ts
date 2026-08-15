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
