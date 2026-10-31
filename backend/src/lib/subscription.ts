import type { SupabaseClient } from '@supabase/supabase-js';

// Pesan ramah untuk Express saat endpoint yang dikunci (Catat Transaksi,
// tambah/ubah/impor alat, undang karyawan) ditolak — PENEGAK SEBENARNYA
// tetap RLS/business_is_writable() di DB (migration 044, review -c1
// poin 1), lapis ini CUMA supaya vendor dapat pesan jelas lebih dulu
// daripada error RLS mentah kalau somehow lolos ke titik insert/update.
// Review -c1: teks ke vendor TIDAK BOLEH menyebut nama "Andi" — selalu
// "hubungi Sewalog".
export const SUBSCRIPTION_LOCKED_MESSAGE =
  'Masa aktif langganan sudah habis. Hubungi Sewalog untuk memperpanjang — transaksi yang sedang berjalan tetap bisa diselesaikan.';

export async function isBusinessWritable(supabase: SupabaseClient, businessId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('business_is_writable', { p_business_id: businessId });
  if (error) {
    // Gagal CEK statusnya sendiri (mis. koneksi DB) BUKAN alasan menolak
    // transaksi — biarkan lolos ke RLS yang jadi penjaga sebenarnya,
    // daripada salah-tolak vendor yang sah cuma karena RPC pesan ramah
    // ini gagal dipanggil.
    return true;
  }
  return data === true;
}
