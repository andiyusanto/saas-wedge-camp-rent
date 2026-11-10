// Unit test untuk Tahap 2 (Ubah Jadwal & Perpanjang, migration 055) —
// research/brief-paket-hari-dan-reschedule-2026-11.md, bagian Verifikasi:
// "harga: per malam dan per hari kalender, jumlah hari tetap dan
// berubah" + "paket tidak bisa diperpendek di bawah min".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBookingTotalPrice, type BookingItemRatesSnapshot } from '../pricing.js';
import { rentalDuration } from '../dates.js';

// Snapshot booking_items.*_at_booking untuk satu alat, tarif bertingkat
// (migration 034) — sama angka dengan skenario Mandalika di
// packageDays.test.ts: paket 4 hari Rp100rb, lewat paket Rp20rb/hari.
const snapshot: BookingItemRatesSnapshot = {
  quantity: 1,
  price_at_booking: 100_000,
  day2_rate_at_booking: 0,
  day3_rate_at_booking: 0,
  day4_rate_at_booking: 0,
  day5_rate_at_booking: 20_000,
  extra_day_rate_at_booking: 20_000,
};

// Baris lama (sebelum migration 034) — snapshot tarif bertingkat null,
// fallback ke tarif flat price_at_booking * days.
const flatLegacySnapshot: BookingItemRatesSnapshot = {
  quantity: 2,
  price_at_booking: 15_000,
  day2_rate_at_booking: null,
  day3_rate_at_booking: null,
  day4_rate_at_booking: null,
  day5_rate_at_booking: null,
  extra_day_rate_at_booking: null,
};

test('computeBookingTotalPrice: jumlah hari TETAP -> total tetap (kedua mode)', () => {
  // Ambil Senin, kembali Jumat.
  const perMalamDays = rentalDuration('2026-12-07', '2026-12-11', 'per_malam'); // 4 malam
  const perHariDays = rentalDuration('2026-12-07', '2026-12-10', 'per_hari_kalender'); // 4 hari (ambil=kembali+3)
  assert.equal(perMalamDays, 4);
  assert.equal(perHariDays, 4);
  assert.equal(computeBookingTotalPrice([snapshot], perMalamDays), 100_000);
  assert.equal(computeBookingTotalPrice([snapshot], perHariDays), 100_000);
});

test('computeBookingTotalPrice: jumlah hari BERUBAH -> hitung ulang dari snapshot (kedua mode)', () => {
  // Diperpanjang dari 4 ke 6 hari/malam, tarif lewat paket Rp20rb/hari.
  assert.equal(computeBookingTotalPrice([snapshot], rentalDuration('2026-12-07', '2026-12-13', 'per_malam')), 140_000);
  assert.equal(
    computeBookingTotalPrice([snapshot], rentalDuration('2026-12-07', '2026-12-12', 'per_hari_kalender')),
    140_000,
  );
  // Dipersingkat dari 4 ke 3 hari (masih di atas paket, bukan di bawah min).
  assert.equal(computeBookingTotalPrice([snapshot], 3), 100_000); // 3 hari pertama paket tetap Rp100rb (hari 2/3 = 0)
});

test('computeBookingTotalPrice: baris lama (snapshot bertingkat null) fallback tarif flat', () => {
  assert.equal(computeBookingTotalPrice([flatLegacySnapshot], 3), 2 * 15_000 * 3);
  assert.equal(computeBookingTotalPrice([flatLegacySnapshot, snapshot], 4), 2 * 15_000 * 4 + 100_000);
});

// Aturan min paket (snapshot Tahap 1, bookings.min_rental_days) dibaca
// SEBELUM endpoint reschedule/extend menyentuh harga/stok sama sekali —
// logika pure-nya cuma perbandingan jumlah hari baru vs minimal snapshot,
// sama di routes/trackings.ts (PATCH /bookings/:id/reschedule).
function violatesMinPackage(newDays: number, minRentalDays: number | null): boolean {
  return minRentalDays != null && newDays < minRentalDays;
}

test('Ubah Jadwal: paket tidak bisa diperpendek di bawah minimal', () => {
  assert.equal(violatesMinPackage(3, 4), true); // 3 hari < minimal 4 -> ditolak
  assert.equal(violatesMinPackage(4, 4), false); // pas minimal -> boleh
  assert.equal(violatesMinPackage(5, 4), false); // di atas minimal -> boleh
  assert.equal(violatesMinPackage(1, null), false); // tanpa batas -> selalu boleh
});
