import { WIB_OFFSET_MS } from './dates.js';
import { computeItemRentalPrice, type ItemDayRates } from './pricing.js';

const BLOCK_HOURS = 12;
const BLOCK_RATE = 0.5;

// Rumus disepakati: toleransi per-vendor (businesses.late_tolerance_hours),
// lewat itu tiap kelipatan 12 jam kena tambahan 50% harga sewa harian.
// due_at = tanggal end_date, jamnya ikut jam pengambilan barang sungguhan —
// lihat migrations/003_bookings_return_time_and_tolerance.sql &
// migrations/027_booking_picked_up_at.sql.
//
// pickedUpAt (bookings.picked_up_at) dipakai kalau ada — itu jam SUNGGUHAN
// barang diambil fisik, disetel di POST /bookings (kalau langsung 'aktif'
// saat dibuat) atau POST /bookings/:id/pickup (booking yang dipesan duluan,
// diambil belakangan). createdAt (jam booking DICATAT staff) cuma fallback
// untuk baris lama dari sebelum migration 027 ada (picked_up_at null) — buat
// booking yang dipesan duluan lalu diambil berhari-hari kemudian, createdAt
// bisa selisih jauh dari jam ambil sungguhan, itu justru celah yang ditutup
// migration 027 (jangan dijadikan sumber utama lagi kalau picked_up_at ada).
//
// Semua ekstraksi jam sengaja lewat offset WIB tetap (bukan getHours() lokal
// server) — server bisa di-deploy di timezone apa saja, tapi jam ambil barang
// harus dibaca sebagai jam WIB (lihat insiden serupa di lib/dates.ts).
export function computeDueAt(endDate: string, createdAt: string, pickedUpAt: string | null = null): Date {
  const anchor = pickedUpAt ?? createdAt;
  const anchorWibMs = new Date(anchor).getTime() + WIB_OFFSET_MS;
  const anchorWib = new Date(anchorWibMs);
  const hours = anchorWib.getUTCHours();
  const minutes = anchorWib.getUTCMinutes();
  const seconds = anchorWib.getUTCSeconds();

  const [y, m, d] = endDate.split('-').map(Number);
  const dueAtUtcMs = Date.UTC(y, m - 1, d, hours, minutes, seconds) - WIB_OFFSET_MS;
  return new Date(dueAtUtcMs);
}

export function hoursLate(dueAt: Date, returnAt: Date): number {
  const diffMs = returnAt.getTime() - dueAt.getTime();
  return diffMs / (60 * 60 * 1000);
}

// Toleransi SENGAJA digeser jadi bagian dari deadline efektif (dikurangkan
// dari hoursLateValue dulu SEBELUM dibagi jadi blok 12-jam), bukan cuma
// gerbang ya/tidak "sudah lewat toleransi?" yang lalu balik hitung dari
// hoursLateValue mentah begitu terlewati. Cara lama itu bikin manfaat
// toleransi lenyap tepat di detik dia terlampaui — mis. toleransi 11 jam,
// telat 13 jam (cuma 2 jam lewat toleransi): hoursLateValue mentah (13) lewat
// BLOCK_HOURS (12) jadi 2 blok (1 hari penuh), padahal yang adil cuma 1 blok
// (setengah hari) karena baru 2 jam yang benar-benar "telat" di luar masa
// toleransi. Insiden serupa persis ditemukan & diperbaiki di Bilbo-Outdoors
// (referensi produk sejenis, owner sama), commit c4b61e0, 2026-08-19 — "the
// tolerance was only used to decide whether hoursLate counted as zero days
// late... the tolerance's benefit evaporated entirely the moment it was
// exceeded". Sewalog kena bug yang sama persis, diperbaiki di sini dengan
// pola yang sama: toleransi menggeser garis mulai hitung, bukan gerbang biner.
// Jumlah blok 12-jam yang sudah lewat toleransi — dipakai BAIK oleh
// computeLateFee() (tarif flat/legacy) MAUPUN computeTieredLateFee() di
// bawah (tarif bertingkat, migration 034+). Diekstrak supaya dua rumus
// itu selalu sepakat soal "berapa hari/blok yang terlambat", cuma beda
// di TARIF per bloknya — lihat komentar migration 034 soal alasan
// pemisahan ini.
function computeLateBlocks(hoursLateValue: number, toleranceHours: number): number {
  const effectiveLateHours = hoursLateValue - toleranceHours;
  if (effectiveLateHours <= 0) return 0;
  return Math.ceil(effectiveLateHours / BLOCK_HOURS);
}

export function computeLateFee(
  hoursLateValue: number,
  toleranceHours: number,
  dailyRate: number,
): number {
  const blocks = computeLateBlocks(hoursLateValue, toleranceHours);
  return blocks * BLOCK_RATE * dailyRate;
}

// Denda keterlambatan bertingkat (migration 034) — rumus marginal ala
// Bilbo-Outdoors (server.ts calculate-late: harga(durasi+telat) -
// harga(durasi)) DIGABUNG dengan mekanisme blok 12-jam/50% Sewalog yang
// sudah ada (TIDAK diubah: cara menghitung jumlah blok tetap lewat
// computeLateBlocks() di atas, sama persis seperti computeLateFee()).
//
// Setiap blok = 12 jam = SETENGAH hari telat, pada 50% tarif. 2 blok =
// 1 hari telat penuh (100% tarif hari itu). Jadi:
//   fullLateDays = floor(blocks / 2)   -- jumlah hari telat PENUH
//   hasHalfBlock = blocks % 2 === 1    -- sisa setengah hari (kalau ganjil)
//
// Tarif hari ke-(rentDuration+k) = marginal dari computeItemRentalPrice:
// harga(rentDuration+k) - harga(rentDuration+k-1). Fee untuk fullLateDays
// hari penuh = harga(rentDuration+fullLateDays) - harga(rentDuration)
// (teleskopik, jumlah semua marginal di antaranya). Kalau ada sisa
// setengah blok, tambah 50% dari marginal hari BERIKUTNYA (hari ke
// fullLateDays+1) — pola "50% tarif hari itu" yang sama seperti blok
// biasa, cuma tarifnya sekarang tarif-hari-itu (bisa beda per hari),
// bukan dailyRate flat.
//
// Diverifikasi: untuk item FLAT (semua tingkat = price_per_day), rumus
// ini menghasilkan angka IDENTIK dengan computeLateFee() lama (lihat
// catatan verifikasi di riwayat kerja) — backward-compatible by
// construction, bukan cuma diasumsikan.
export function computeTieredLateFee(
  hoursLateValue: number,
  toleranceHours: number,
  rentDuration: number,
  rates: ItemDayRates,
): number {
  const blocks = computeLateBlocks(hoursLateValue, toleranceHours);
  if (blocks <= 0) return 0;
  const fullLateDays = Math.floor(blocks / 2);
  const hasHalfBlock = blocks % 2 === 1;

  let fee = computeItemRentalPrice(rates, rentDuration + fullLateDays) - computeItemRentalPrice(rates, rentDuration);
  if (hasHalfBlock) {
    const nextDayMarginal =
      computeItemRentalPrice(rates, rentDuration + fullLateDays + 1) -
      computeItemRentalPrice(rates, rentDuration + fullLateDays);
    fee += BLOCK_RATE * nextDayMarginal;
  }
  return fee;
}

// Untuk tampilan rincian (dialog pengembalian/nota) — jumlah "hari
// telat" dalam satuan yang sama dengan computeTieredLateFee() di atas
// (0.5 per blok ganjil), supaya tarif efektif per-hari yang ditampilkan
// (fee / lateDaysEquivalent) konsisten dengan fee yang sungguhan dipakai.
export function lateDaysEquivalent(hoursLateValue: number, toleranceHours: number): number {
  const blocks = computeLateBlocks(hoursLateValue, toleranceHours);
  return blocks * BLOCK_RATE;
}
