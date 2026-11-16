// Parita rumus harga paket antara backend (lib/pricing.ts) dan frontend
// (utils/formatters.ts) -- Paket Alat Tahap 2, catatan koordinator 16 Nov
// 2026 ("buat test PARITAS dengan fixture angka yang sama di test
// frontend dan backend"). Dua file itu TIDAK bisa saling import secara
// normal (beda package/workspace), tapi tsx bisa resolve import relatif
// lintas folder langsung dari sumber TS-nya -- test ini sengaja
// mengimpor KEDUA salinan dan membandingkan hasilnya byte-demi-byte,
// supaya drift ketahuan di sini, bukan cuma lewat dua suite test yang
// terpisah tanpa saling bandingkan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as backend from '../pricing.js';
import * as frontend from '../../../../frontend/src/utils/formatters.js';
import type { ItemDayRates, BundleComponent } from '../pricing.js';

const tendaOdd: ItemDayRates = {
  price_per_day: 12_555,
  day2_rate: 12_555,
  day3_rate: 12_555,
  day4_rate: 12_555,
  day5_rate: 12_555,
  extra_day_rate: 12_555,
};

const matrasRates: ItemDayRates = {
  price_per_day: 7_777,
  day2_rate: 7_000,
  day3_rate: 6_500,
  day4_rate: 6_500,
  day5_rate: 6_500,
  extra_day_rate: 6_000,
};

test('combinedComponentRates: backend dan frontend identik', () => {
  const components: BundleComponent[] = [
    { item_id: 'tenda', quantityPerBundle: 1, catalogRates: tendaOdd },
    { item_id: 'matras', quantityPerBundle: 2, catalogRates: matrasRates },
  ];
  assert.deepEqual(backend.combinedComponentRates(components), frontend.combinedComponentRates(components));
});

test('applyBundleDiscount persen pada tarif ganjil Rp12.555: backend dan frontend identik', () => {
  const rates = backend.combinedComponentRates([{ item_id: 'tenda', quantityPerBundle: 1, catalogRates: tendaOdd }]);
  const b = backend.applyBundleDiscount(rates, 'percent', 10);
  const f = frontend.applyBundleDiscount(rates, 'percent', 10);
  assert.deepEqual(b, f);
  assert.equal(b.price_per_day, 11_300); // 12555 * 0.9 = 11299.5 -> round 11300
});

test('applyBundleDiscount nominal Rp12.555: backend dan frontend identik', () => {
  const rates: ItemDayRates = { price_per_day: 50_000, day2_rate: 50_000, day3_rate: 50_000, day4_rate: 50_000, day5_rate: 50_000, extra_day_rate: 50_000 };
  const b = backend.applyBundleDiscount(rates, 'nominal', 12_555);
  const f = frontend.applyBundleDiscount(rates, 'nominal', 12_555);
  assert.deepEqual(b, f);
  assert.equal(b.price_per_day, 37_445);
});

test('allocateBundlePrice tarif ganjil + potongan: backend dan frontend identik, jumlah persis total', () => {
  const components: BundleComponent[] = [
    { item_id: 'tenda', quantityPerBundle: 1, catalogRates: tendaOdd },
    { item_id: 'matras', quantityPerBundle: 2, catalogRates: matrasRates },
  ];
  const combined = backend.combinedComponentRates(components);
  const discounted = backend.applyBundleDiscount(combined, 'percent', 10);
  const days = 3;
  const totalPerInstance = backend.computeItemRentalPrice(discounted, days);

  const allocatedBackend = backend.allocateBundlePrice(components, totalPerInstance, days);
  const allocatedFrontend = frontend.allocateBundlePrice(components, totalPerInstance, days);

  assert.deepEqual(allocatedBackend, allocatedFrontend);
  const sum = allocatedBackend.reduce((a, c) => a + c.subtotalPerInstance, 0);
  assert.equal(sum, totalPerInstance);
});

test('allocateBundlePrice semua komponen Rp0: backend dan frontend identik (bagi rata)', () => {
  const zero: ItemDayRates = { price_per_day: 0, day2_rate: 0, day3_rate: 0, day4_rate: 0, day5_rate: 0, extra_day_rate: 0 };
  const components: BundleComponent[] = [
    { item_id: 'a', quantityPerBundle: 1, catalogRates: zero },
    { item_id: 'b', quantityPerBundle: 1, catalogRates: zero },
    { item_id: 'c', quantityPerBundle: 1, catalogRates: zero },
  ];
  const b = backend.allocateBundlePrice(components, 100, 1);
  const f = frontend.allocateBundlePrice(components, 100, 1);
  assert.deepEqual(b, f);
});

test('computeItemRentalPrice tarif ganjil 3 hari: backend dan frontend identik', () => {
  assert.equal(backend.computeItemRentalPrice(tendaOdd, 3), frontend.computeItemRentalPrice(tendaOdd, 3));
  assert.equal(backend.computeItemRentalPrice(tendaOdd, 3), 37_665);
});
