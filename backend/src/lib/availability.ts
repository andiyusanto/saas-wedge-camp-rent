import type { SupabaseClient } from '@supabase/supabase-js';

export type BookingItemRow = {
  item_id: string;
  quantity: number;
  bookings: { start_date: string; end_date: string; status: string } | null;
};

// 'dipesan' (sudah dicatat, belum diambil fisik) sengaja ikut dihitung
// supaya alat yang sudah direservasi tidak bisa di-booking dobel oleh
// orang lain. 'dibatalkan' dan 'selesai' sengaja tidak dimasukkan.
const ACTIVE_STATUSES = new Set(['dipesan', 'aktif', 'telat']);

export async function fetchActiveBookingItems(supabase: SupabaseClient): Promise<BookingItemRow[]> {
  const { data, error } = await supabase
    .from('booking_items')
    .select('item_id, quantity, bookings(start_date, end_date, status)');

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BookingItemRow[];
}

export function usedUnitsOn(bookingItems: BookingItemRow[], itemId: string, dateStr: string): number {
  return bookingItems
    .filter((bi) => {
      const booking = bi.bookings;
      if (!booking || bi.item_id !== itemId) return false;
      if (!ACTIVE_STATUSES.has(booking.status)) return false;
      if (booking.start_date > dateStr) return false;

      // 'aktif' = barang sudah diambil fisik (langsung saat dibuat kalau
      // start_date <= hari ini, atau lewat "Tandai Barang Diambil" untuk
      // booking yang dipesan duluan) tapi BELUM ditandai kembali — blokir
      // TANPA batas end_date sampai benar-benar diproses lewat Proses
      // Pengembalian. Sebelumnya end_date jadi batas keras buat semua
      // status, jadi begitu tanggal kalender lewat end_date, alat yang
      // masih di tangan pelanggan telat (belum diproses) muncul balik
      // "tersedia penuh" — bisa didobel-bookingkan padahal fisiknya belum
      // kembali (insiden serupa dan sudah diperbaiki di Bilbo-Outdoors,
      // 2026-09-02 — lihat memory bug-scenario-comparison-framework).
      if (booking.status === 'aktif') return true;

      // 'dipesan' (belum pernah diambil sama sekali) SENGAJA tetap dibatasi
      // end_date — no-show yang tidak pernah diambil tidak boleh mengunci
      // stok selamanya, karena barangnya fisik belum pernah keluar toko.
      return booking.end_date >= dateStr;
    })
    .reduce((sum, bi) => sum + bi.quantity, 0);
}
