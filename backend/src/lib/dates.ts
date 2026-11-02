// Semua vendor pilot ada di Malang Raya (WIB, UTC+7, tanpa DST) — lihat
// CLAUDE.md bagian 3. "Hari ini" dan aritmetika tanggal sengaja dihitung
// relatif ke WIB, bukan timezone lokal server atau UTC polos, supaya tidak
// bergeser satu hari tergantung di mana server di-deploy (lihat insiden:
// new Date(`${str}T00:00:00`) + toISOString() menggeser tanggal mundur
// satu hari karena local-time parsing dicampur serialisasi UTC).
export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export function todayInWIB(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

// Tanggal kalender WIB dari sebuah instant asli (mis. bookings.actual_return_at)
// — dipakai buat menjangkarkan jeda persiapan (readiness_hours, migration 028)
// ke hari SUNGGUHAN barang kembali, bukan hari terjadwal (end_date). Sama pola
// dengan todayInWIB() di atas, cuma instant-nya dari parameter bukan Date.now().
export function toWibDateStr(isoInstant: string): string {
  return new Date(new Date(isoInstant).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(dateStr: string, amount: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + amount * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function dateRange(startStr: string, endStr: string): string[] {
  const days: string[] = [];
  let current = startStr;

  while (current <= endStr) {
    days.push(current);
    current = addDays(current, 1);
  }

  return days;
}

export type RentalDayMode = 'per_malam' | 'per_hari_kalender';

// Cara hitung durasi sewa jadi pengaturan per rental (migration 049,
// keputusan Andi 2 Nov 2026, lihat knowladge/marketing-plan-2026-q4.md
// bagian 9) — menggantikan rumus tunggal `dateRange(...).length` yang
// dulu dipakai di mana-mana (selalu inklusif hari kalender). Dipakai
// HANYA untuk harga/durasi-tampilan & denda telat bertingkat — TIDAK
// dipakai untuk usedUnitsOn()/dateRange() sendiri (hari kembali TETAP
// dihitung hari terpakai di kalender/ketersediaan terlepas dari mode
// ini, lihat CLAUDE.md bagian 6/7, sengaja tidak diubah).
//
// `mode` di sini harus SNAPSHOT yang tersimpan di baris (bookings.
// rental_day_mode, bisa null untuk baris lama = diperlakukan sebagai
// 'per_hari_kalender', PERSIS perilaku sebelum fitur ini ada), BUKAN
// businesses.rental_day_mode yang sedang berlaku SEKARANG — supaya
// transaksi lama tidak pernah berubah hasilnya kalau vendor ganti
// pengaturan ini belakangan.
export function rentalDuration(startStr: string, endStr: string, mode: RentalDayMode | null): number {
  const nights = Math.round((new Date(`${endStr}T00:00:00Z`).getTime() - new Date(`${startStr}T00:00:00Z`).getTime()) / 86_400_000);
  return mode === 'per_malam' ? nights : nights + 1;
}
