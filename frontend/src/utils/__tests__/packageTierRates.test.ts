import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePackageTierRates, computeItemRentalPrice } from '../formatters';

// Paritas terhadap perilaku LAMA tombol "Paket N hari" di ItemsScreen.tsx
// (brief Pilih Skema Sewa 24 Nov 2026, koreksi koordinator poin 4) --
// disalin APA ADANYA dari kode sebelum refactor (termasuk fix 10 Nov
// 2026: hari setelah tingkat N WAJIB eksplisit = over, bukan kosong).
function oldBehavior(over: number, n: 2 | 3 | 4 | 5) {
  return {
    day2_rate: 0,
    day3_rate: n >= 3 ? 0 : over,
    day4_rate: n >= 4 ? 0 : over,
    day5_rate: n >= 5 ? 0 : over,
    extra_day_rate: over,
  };
}

test('computePackageTierRates: identik dengan perilaku lama untuk N=2..5, over=0 dan over>0', () => {
  for (const n of [2, 3, 4, 5] as const) {
    for (const over of [0, 10_000, 15_000]) {
      assert.deepEqual(computePackageTierRates(over, n), oldBehavior(over, n), `N=${n}, over=${over}`);
    }
  }
});

test('computePackageTierRates: fix 10 Nov 2026 -- hari setelah tingkat N tidak pernah 0 kalau over>0 (paket <5 hari)', () => {
  const tiers = computePackageTierRates(10_000, 3);
  assert.equal(tiers.day4_rate, 10_000);
  assert.equal(tiers.day5_rate, 10_000);
  assert.equal(tiers.extra_day_rate, 10_000);
  // Total 6 hari = harga paket (day1) + 2 hari gratis (day2/day3=0) + 3 hari @10.000 (day4,day5,extra)
  const total6 = computeItemRentalPrice({ price_per_day: 30_000, ...tiers }, 6);
  assert.equal(total6, 30_000 + 0 + 0 + 10_000 + 10_000 + 10_000);
});
