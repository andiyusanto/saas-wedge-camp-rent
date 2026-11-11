import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, toDateStrInTz } from './dates.js';

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
  // booking_id (Tahap 2, migration 055) -- supaya caller bisa mengecualikan
  // booking yang SEDANG diubah (Ubah Jadwal/Perpanjang) dari hitungan stok
  // tanggal baru (booking itu sendiri tidak boleh bersaing dengan dirinya
  // sendiri untuk stok yang sama).
  booking_id: string;
  bookings: { start_date: string; end_date: string; status: string; actual_return_at: string | null } | null;
};

// 'dipesan'/'telat'/'selesai' sengaja ikut dihitung (bukan cuma 'aktif') —
// lihat penjelasan per-status di usedUnitsOn() di bawah. 'dibatalkan' sengaja
// tidak pernah dimasukkan.
const ACTIVE_STATUSES = new Set(['dipesan', 'aktif', 'telat', 'selesai']);

const PAGE_SIZE = 1000;
// Supabase/PostgREST membatasi respons ke max_rows (1.000 di project ini,
// dikonfirmasi lewat Settings -> API) TANPA error -- query yang melebihi
// batas ini diam-diam terpotong, bukan gagal. Brief skala data 2026-11-11.
const ID_CHUNK_SIZE = 200;

type RawBookingRow = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  actual_return_at: string | null;
};

// Jalankan query sampai benar2 habis lewat .range() berulang -- jaring
// pengaman TERAKHIR terhadap max_rows, independen dari seberapa tepat
// filter tanggal/margin di bawah. WAJIB .order() dengan kolom unik+
// deterministik (di sini selalu 'id') -- tanpa itu, PostgREST tidak
// menjamin urutan antar-halaman tetap sama, dan baris bisa dobel atau
// terlompati (koreksi review koordinator 2026-11-11).
async function fetchAllPages<T>(
  supabase: SupabaseClient,
  build: () => any,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Margin hari dari readiness_hours TERBESAR di antara alat yang relevan
// untuk panggilan ini -- dipakai melebarkan jendela tanggal fetchActiveBookingItems
// supaya booking yang "nyenggol" lewat jeda persiapan tidak kelewatan.
export function marginDaysFromReadinessHours(readinessHoursList: number[]): number {
  const maxHours = Math.max(0, ...readinessHoursList);
  return maxHours > 0 ? Math.ceil(maxHours / 24) + 1 : 0;
}

// businessId: filter EKSPLISIT (bukan cuma andalkan RLS) -- menutup celah
// yang sama dengan pola "query businesses tanpa .eq(id)" yang sudah
// diketahui, dan membuat Postgres bisa pakai indeks business_id (migration
// 058) alih-alih full table scan + filter RLS.
//
// window: jendela tanggal yang SUNGGUHAN relevan untuk pemanggil (mis.
// rentang Kalender yang ditampilkan, atau rentang booking yang sedang
// divalidasi) + marginDays (dari readiness_hours terbesar milik business
// ini, sudah dibulatkan ke hari) supaya booking yang baru "nyenggol" jendela
// lewat jeda persiapan tidak ketinggalan. Ini MURNI optimasi ukuran hasil
// (booking_items bisa jutaan baris lintas tahun) -- kebenaran akhir tetap
// dijamin fetchAllPages() di atas, bukan oleh ketepatan margin ini.
//
// Dipecah per KELOMPOK STATUS (bukan satu .or() bersarang) supaya gampang
// dibaca & diverifikasi:
// - 'aktif' tidak dibatasi end_date (blokir tanpa batas atas sampai Proses
//   Pengembalian, lihat usedUnitsOn()) -- TAPI tetap dibatasi business_id
//   dan tetap lewat fetchAllPages(), jadi tidak ada risiko silent-drop
//   meski suatu saat ada >1.000 booking 'aktif' bersamaan (skenario sangat
//   tidak realistis untuk skala pilot saat ini).
// - 'dipesan': start_date <= windowEnd+margin DAN end_date >= windowStart-margin.
// - 'telat'/'selesai': dua kemungkinan jangkar (end_date TERJADWAL atau
//   actual_return_at SUNGGUHAN, mana saja yang lebih besar) harus beririsan
//   dengan jendela -- bukan cuma actual_return_at (koreksi review
//   koordinator: baris lama bisa null, dan pengembalian bisa dicatat mundur
//   lewat tanggal yang sudah lewat). usedUnitsOn() sendiri tidak berubah,
//   ini cuma filter PENGAMBILAN DATA yang lebih longgar dari logika aslinya.
export async function fetchActiveBookingItems(
  supabase: SupabaseClient,
  businessId: string,
  window: { windowStart: string; windowEnd: string; marginDays: number },
): Promise<BookingItemRow[]> {
  const marginDays = Math.max(0, window.marginDays);
  const expandedStart = addDays(window.windowStart, -marginDays);
  const expandedEnd = addDays(window.windowEnd, marginDays);

  const bookingCols = 'id, start_date, end_date, status, actual_return_at';

  // Tiga kelompok status tidak saling bergantung -- jalankan paralel
  // (Promise.all), bukan berurutan, supaya latency total bukan jumlah
  // ketiga round-trip tapi cuma yang paling lambat (koreksi review
  // koordinator 2026-11-11: latency ~2 detik didominasi round-trip
  // berurutan, bukan waktu eksekusi query di sisi Postgres).
  const [aktifRows, dipesanRows, telatSelesaiRows] = await Promise.all([
    fetchAllPages<RawBookingRow>(supabase, () =>
      supabase.from('bookings').select(bookingCols).eq('business_id', businessId).eq('status', 'aktif').order('id'),
    ),
    fetchAllPages<RawBookingRow>(supabase, () =>
      supabase
        .from('bookings')
        .select(bookingCols)
        .eq('business_id', businessId)
        .eq('status', 'dipesan')
        .lte('start_date', expandedEnd)
        .gte('end_date', expandedStart)
        .order('id'),
    ),
    fetchAllPages<RawBookingRow>(supabase, () =>
      supabase
        .from('bookings')
        .select(bookingCols)
        .eq('business_id', businessId)
        .in('status', ['telat', 'selesai'])
        .lte('start_date', expandedEnd)
        .or(`end_date.gte.${expandedStart},actual_return_at.gte.${expandedStart}`)
        .order('id'),
    ),
  ]);

  const bookingRows = [...aktifRows, ...dipesanRows, ...telatSelesaiRows];
  if (bookingRows.length === 0) return [];

  const bookingsById = new Map(bookingRows.map((b) => [b.id, b]));
  const bookingIds = [...bookingsById.keys()];

  // Chunk booking_items juga paralel, dibatasi CHUNK_CONCURRENCY sekaligus
  // supaya tidak membanjiri koneksi PostgREST kalau bookingIds sangat
  // banyak (puluhan ribu id -> ratusan chunk).
  const idChunks = chunk(bookingIds, ID_CHUNK_SIZE);
  const bookingItemRows: { item_id: string; quantity: number; booking_id: string }[] = [];
  const CHUNK_CONCURRENCY = 4;
  for (let i = 0; i < idChunks.length; i += CHUNK_CONCURRENCY) {
    const batch = idChunks.slice(i, i + CHUNK_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((idChunk) =>
        fetchAllPages<{ item_id: string; quantity: number; booking_id: string }>(supabase, () =>
          supabase.from('booking_items').select('item_id, quantity, booking_id').in('booking_id', idChunk).order('id'),
        ),
      ),
    );
    for (const rows of batchResults) bookingItemRows.push(...rows);
  }

  return bookingItemRows.map((bi) => ({
    item_id: bi.item_id,
    quantity: bi.quantity,
    booking_id: bi.booking_id,
    bookings: bookingsById.get(bi.booking_id) ?? null,
  }));
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
  // Zona rental (migration 053) — dipakai membaca hari sungguhan barang
  // kembali. Harus sama dengan get_public_availability (053).
  timezone: string | null = null,
  // Tahap 2 (migration 055) — booking yang SEDANG diubah (Ubah Jadwal/
  // Perpanjang) dikecualikan dari hitungan, supaya tidak bersaing dengan
  // stok dirinya sendiri di tanggal baru. undefined (default) = perilaku
  // lama, tidak mengecualikan apa pun (POST /bookings & Etalase publik).
  excludeBookingId?: string,
): number {
  const readinessDays = readinessHours > 0 ? Math.ceil(readinessHours / 24) : 0;

  return bookingItems
    .filter((bi) => {
      const booking = bi.bookings;
      if (!booking || bi.item_id !== itemId) return false;
      if (excludeBookingId && bi.booking_id === excludeBookingId) return false;
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
      // toDateStrInTz, zona rental sejak 053), BUKAN end_date terjadwal. Ini perbaikan dari versi
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
        const returnDay = toDateStrInTz(booking.actual_return_at, timezone);
        const effectiveEnd = addDays(returnDay, readinessDays - 1);
        return returnDay <= dateStr && dateStr <= effectiveEnd;
      }

      return false;
    })
    .reduce((sum, bi) => sum + bi.quantity, 0);
}
