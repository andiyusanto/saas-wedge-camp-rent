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

export function computeLateFee(
  hoursLateValue: number,
  toleranceHours: number,
  dailyRate: number,
): number {
  if (hoursLateValue <= toleranceHours) return 0;
  const blocks = Math.ceil(hoursLateValue / BLOCK_HOURS);
  return blocks * BLOCK_RATE * dailyRate;
}
