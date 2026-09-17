import { WIB_OFFSET_MS } from './dates.js';

const BLOCK_HOURS = 12;
const BLOCK_RATE = 0.5;

// Rumus disepakati: toleransi per-vendor (businesses.late_tolerance_hours),
// lewat itu tiap kelipatan 12 jam kena tambahan 50% harga sewa harian.
// due_at = tanggal end_date, jamnya ikut jam booking dibuat (jam ambil barang) —
// lihat migrations/003_bookings_return_time_and_tolerance.sql.
//
// Semua ekstraksi jam sengaja lewat offset WIB tetap (bukan getHours() lokal
// server) — server bisa di-deploy di timezone apa saja, tapi jam ambil barang
// harus dibaca sebagai jam WIB (lihat insiden serupa di lib/dates.ts).
export function computeDueAt(endDate: string, createdAt: string): Date {
  const createdWibMs = new Date(createdAt).getTime() + WIB_OFFSET_MS;
  const createdWib = new Date(createdWibMs);
  const hours = createdWib.getUTCHours();
  const minutes = createdWib.getUTCMinutes();
  const seconds = createdWib.getUTCSeconds();

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
export function computeLateFee(
  hoursLateValue: number,
  toleranceHours: number,
  dailyRate: number,
): number {
  const effectiveLateHours = hoursLateValue - toleranceHours;
  if (effectiveLateHours <= 0) return 0;
  const blocks = Math.ceil(effectiveLateHours / BLOCK_HOURS);
  return blocks * BLOCK_RATE * dailyRate;
}
