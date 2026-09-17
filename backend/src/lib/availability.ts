import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, toWibDateStr } from './dates.js';

// Dipindah ke sini (dari routes/availability.ts) supaya bisa dipakai ulang
// oleh routes/etalase.ts (pencarian ketersediaan publik di Etalase Online)
// tanpa duplikasi logika tier "tersedia/sisa sedikit/penuh" — dua tempat
// itu WAJIB selalu sepakat soal kapan status berubah warna.
export const LOW_STOCK_RATIO = 0.2;

export type AvailabilityStatus = 'tersedia' | 'sisa_sedikit' | 'penuh';

export function computeAvailabilityStatus(remaining: number, totalUnits: number): AvailabilityStatus {
  if (remaining <= 0) return 'penuh';
  const threshold = Math.max(1, Math.floor(totalUnits * LOW_STOCK_RATIO));
  return remaining <= threshold ? 'sisa_sedikit' : 'tersedia';
}

export type BookingItemRow = {
  item_id: string;
  quantity: number;
  bookings: { start_date: string; end_date: string; status: string; actual_return_at: string | null } | null;
};

// 'dipesan'/'telat'/'selesai' sengaja ikut dihitung (bukan cuma 'aktif') —
// lihat penjelasan per-status di usedUnitsOn() di bawah. 'dibatalkan' sengaja
// tidak pernah dimasukkan.
const ACTIVE_STATUSES = new Set(['dipesan', 'aktif', 'telat', 'selesai']);

export async function fetchActiveBookingItems(supabase: SupabaseClient): Promise<BookingItemRow[]> {
  const { data, error } = await supabase
    .from('booking_items')
    .select('item_id, quantity, bookings(start_date, end_date, status, actual_return_at)');

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BookingItemRow[];
}

// readinessHours = jeda persiapan per-alat (items.readiness_hours, migration
// 028 — sebelumnya readiness_days, diganti ke jam per permintaan eksplisit
// setelah bookings.picked_up_at/actual_return_at jadi instant asli, lihat
// diskusi & migration 028) — waktu yang dibutuhkan sebelum alat yang baru
// kembali siap disewa lagi (mis. tenda perlu diangin-anginkan/dicek dulu).
//
// PENTING — ini BUKAN presisi sub-hari: 'usedUnitsOn' tetap beroperasi per
// TANGGAL KALENDER (dateStr), sama seperti Kalender Ketersediaan yang
// sengaja strip-per-hari (CLAUDE.md bagian 5), bukan grid per-jam. jam
// dikonversi ke HARI PEMBULATAN KE ATAS (Math.ceil(hours/24)) sekali di
// awal, lalu dipakai sebagai jumlah hari kalender yang diblokir — persis
// pola readinessHours->readinessDaysById milik Bilbo-Outdoors (diverifikasi
// langsung dari server.ts-nya, bukan diasumsikan): readiness_hours=0 berarti
// TIDAK diblokir sama sekali (tersedia lagi di HARI YANG SAMA barang
// kembali); readiness_hours 1-24 memblokir PERSIS hari barang kembali itu
// sendiri (tersedia mulai besok); 25-48 memblokir hari kembali + 1 hari
// lagi; dst. Manfaat satuan jam di sini murni sebagai UNIT INPUT yang lebih
// wajar buat vendor (dan pembulatannya lebih tepat — mis. tahu bedanya
// "kurang dari sehari" vs "pas sehari" tanpa harus menghitung sendiri),
// BUKAN klaim ketersediaan-parsial-di-tengah-hari (stack ini, sama seperti
// Bilbo, tidak pernah melacak jam pengambilan di sisi form booking sama
// sekali, jadi tidak ada dasar buat klaim presisi jam yang sungguhan).
export function usedUnitsOn(
  bookingItems: BookingItemRow[],
  itemId: string,
  dateStr: string,
  readinessHours = 0,
): number {
  const readinessDays = readinessHours > 0 ? Math.ceil(readinessHours / 24) : 0;

  return bookingItems
    .filter((bi) => {
      const booking = bi.bookings;
      if (!booking || bi.item_id !== itemId) return false;
      if (!ACTIVE_STATUSES.has(booking.status)) return false;

      // 'aktif' = barang sudah diambil fisik (langsung saat dibuat kalau
      // start_date <= hari ini, atau lewat "Tandai Barang Diambil" untuk
      // booking yang dipesan duluan) tapi BELUM ditandai kembali — blokir
      // TANPA batas end_date sampai benar-benar diproses lewat Proses
      // Pengembalian (insiden serupa dan sudah diperbaiki di Bilbo-Outdoors,
      // 2026-09-02 — lihat memory bug-scenario-comparison-framework). Batas
      // mundur (readinessDays sebelum start_date) tetap diterapkan untuk
      // konsistensi formula, meski jarang berarti banyak karena start_date
      // booking 'aktif' biasanya sudah lewat.
      if (booking.status === 'aktif') {
        const effectiveStart = readinessDays > 0 ? addDays(booking.start_date, -readinessDays) : booking.start_date;
        return effectiveStart <= dateStr;
      }

      // 'dipesan' (belum pernah diambil sama sekali) — SIMETRIS: mundur
      // sebelum start_date DAN maju setelah end_date, dua-duanya dibulatkan
      // dari readinessHours karena belum ada instant pengambilan sungguhan
      // buat dijangkarkan (belum terjadi). Tetap dibatasi end_date+readiness
      // (bukan tanpa batas) — no-show yang tidak pernah diambil tidak boleh
      // mengunci stok selamanya, barangnya fisik belum pernah keluar toko.
      if (booking.status === 'dipesan') {
        const effectiveStart = readinessDays > 0 ? addDays(booking.start_date, -readinessDays) : booking.start_date;
        const effectiveEnd = readinessDays > 0 ? addDays(booking.end_date, readinessDays) : booking.end_date;
        return effectiveStart <= dateStr && dateStr <= effectiveEnd;
      }

      // 'telat'/'selesai' (SUDAH DITUTUP lewat Proses Pengembalian, punya
      // actual_return_at asli) — jendela jeda dijangkarkan ke HARI SUNGGUHAN
      // barang kembali (actual_return_at, dibaca sebagai tanggal WIB lewat
      // toWibDateStr), BUKAN end_date terjadwal. Ini perbaikan dari versi
      // sebelumnya (yang menjangkarkan ke end_date+readinessDays) — untuk
      // booking 'telat' yang kembali jauh setelah end_date, menjangkar ke
      // end_date bisa membebaskan alat SEBELUM jeda persiapan sungguhan
      // selesai dihitung dari kembalinya yang nyata. 'selesai' SEBELUMNYA
      // sama sekali tidak masuk hitungan di sini (readiness_days versi lama
      // diam-diam tidak pernah berlaku buat pengembalian TEPAT WAKTU,
      // cuma buat yang telat) — celah itu ditutup di sini, karena kebutuhan
      // jeda persiapan fisik tidak peduli pengembaliannya telat atau tidak.
      if ((booking.status === 'telat' || booking.status === 'selesai') && booking.actual_return_at) {
        if (readinessDays <= 0) return false; // 0 jam = tersedia lagi hari yang sama, tidak diblokir sama sekali
        const returnDay = toWibDateStr(booking.actual_return_at);
        const effectiveEnd = addDays(returnDay, readinessDays - 1);
        return returnDay <= dateStr && dateStr <= effectiveEnd;
      }

      return false;
    })
    .reduce((sum, bi) => sum + bi.quantity, 0);
}
