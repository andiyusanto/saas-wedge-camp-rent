// Unit test untuk Tahap 1 (Paket minimal/maksimal hari sewa, migration
// 054) — skenario Mandalika dari brief
// (research/brief-paket-hari-dan-reschedule-2026-11.md): paket Rp100rb,
// maks 4 hari, tarif hari ke-5 dst Rp20rb, toleransi 2 jam, mode per
// malam. Ditambahkan setelah review -c1 (10 Nov 2026) menemukan tombol
// "Paket N hari" di ItemsScreen.tsx membuat hari setelah paket jadi
// Rp0 (bukan tarif lewat paket) untuk paket < 5 hari — kasus persis ini
// seharusnya tertangkap oleh tes harga/denda, bukan ketahuan lewat
// review manual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeItemRentalPrice, type ItemDayRates } from '../pricing.js';
import { computeTieredLateFee } from '../penalty.js';

// Hasil tombol "Paket 4 hari" di ItemsScreen.tsx dengan "Tarif lewat
// paket" = 20000: day2/day3/day4 = 0 (termasuk paket), day5 = extra =
// 20000 (BUKAN 0 — ini bug yang diperbaiki).
const mandalikaRates: ItemDayRates = {
  price_per_day: 100_000,
  day2_rate: 0,
  day3_rate: 0,
  day4_rate: 0,
  day5_rate: 20_000,
  extra_day_rate: 20_000,
};

test('harga paket 4/5/6 hari sesuai brief (100rb/120rb/140rb)', () => {
  assert.equal(computeItemRentalPrice(mandalikaRates, 4), 100_000);
  assert.equal(computeItemRentalPrice(mandalikaRates, 5), 120_000);
  assert.equal(computeItemRentalPrice(mandalikaRates, 6), 140_000);
});

// Ambil Senin 10:00, batas kembali Jumat 10:00 (rentDuration = 4 malam).
// Tabel denda dari brief, toleransi 2 jam:
//   Jum 11:30 -> telat 1.5 jam, dalam toleransi -> 0
//   Jum 15:00 -> telat 5 jam, 3 jam efektif -> 1 blok (setengah hari) -> 10.000
//   Sab 09:00 -> telat 23 jam, 21 jam efektif -> 2 blok (1 hari penuh) -> 20.000
//   Sab 20:00 -> telat 34 jam, 32 jam efektif -> 3 blok -> 30.000
//   Min 12:00 -> telat 50 jam, 48 jam efektif -> 4 blok (2 hari penuh) -> 40.000
//   Sel 10:00 -> telat 96 jam, 94 jam efektif -> 8 blok (4 hari penuh) -> 80.000
test('denda telat bertingkat sesuai tabel brief (toleransi 2 jam)', () => {
  const tolerance = 2;
  const rentDuration = 4;
  const cases: [number, number][] = [
    [1.5, 0],
    [5, 10_000],
    [23, 20_000],
    [34, 30_000],
    [50, 40_000],
    [96, 80_000],
  ];
  for (const [hoursLate, expectedFee] of cases) {
    assert.equal(
      computeTieredLateFee(hoursLate, tolerance, rentDuration, mandalikaRates),
      expectedFee,
      `hoursLate=${hoursLate}`,
    );
  }
});

// Item flat (semua tingkat sama) tidak boleh berubah perilaku —
// verifikasi matematis yang sudah diklaim di CLAUDE.md bagian 6.
test('item flat: paket tidak mengubah harga/denda dibanding tarif flat', () => {
  const flat: ItemDayRates = {
    price_per_day: 30_000,
    day2_rate: 30_000,
    day3_rate: 30_000,
    day4_rate: 30_000,
    day5_rate: 30_000,
    extra_day_rate: 30_000,
  };
  assert.equal(computeItemRentalPrice(flat, 3), 90_000);
  assert.equal(computeTieredLateFee(23, 2, 3, flat), 30_000 * 1); // 1 hari penuh @ tarif flat
});
