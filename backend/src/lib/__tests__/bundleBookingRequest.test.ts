// Unit test pemecahan paket server-side untuk Pesanan Online (Paket Alat
// Tahap 2, brief 16 Nov 2026) — validateSubmitRows/mergeDuplicate*/
// explodeBundleRow, murni tanpa Express/Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSubmitRows,
  mergeDuplicateItems,
  mergeDuplicateBundles,
  explodeBundleRow,
  MAX_ITEMS_PER_REQUEST,
} from '../bundleBookingRequest.js';
import type { PublicPageBundle } from '../bundleBookingRequest.js';
import type { ItemDayRates } from '../pricing.js';

const ITEM_A = '11111111-1111-1111-1111-111111111111';
const ITEM_B = '22222222-2222-2222-2222-222222222222';
const BUNDLE_X = '33333333-3333-3333-3333-333333333333';

test('validateSubmitRows: menerima campuran item_id dan bundle_id', () => {
  const result = validateSubmitRows([
    { item_id: ITEM_A, quantity: 2 },
    { bundle_id: BUNDLE_X, quantity: 1 },
  ]);
  assert.ok(result);
  assert.deepEqual(result!.items, [{ item_id: ITEM_A, quantity: 2 }]);
  assert.deepEqual(result!.bundles, [{ bundle_id: BUNDLE_X, quantity: 1 }]);
});

test('validateSubmitRows: menolak baris tanpa item_id maupun bundle_id', () => {
  assert.equal(validateSubmitRows([{ quantity: 1 }]), null);
});

test('validateSubmitRows: menolak baris dengan item_id DAN bundle_id sekaligus', () => {
  assert.equal(validateSubmitRows([{ item_id: ITEM_A, bundle_id: BUNDLE_X, quantity: 1 }]), null);
});

test('validateSubmitRows: menolak quantity di luar 1-20', () => {
  assert.equal(validateSubmitRows([{ item_id: ITEM_A, quantity: 21 }]), null);
  assert.equal(validateSubmitRows([{ item_id: ITEM_A, quantity: 0 }]), null);
});

test('validateSubmitRows: menolak array kosong', () => {
  assert.equal(validateSubmitRows([]), null);
});

test('mergeDuplicateItems: menjumlahkan quantity item_id yang sama', () => {
  const merged = mergeDuplicateItems([
    { item_id: ITEM_A, quantity: 3 },
    { item_id: ITEM_A, quantity: 2 },
  ]);
  assert.deepEqual(merged, [{ item_id: ITEM_A, quantity: 5 }]);
});

test('mergeDuplicateBundles: menjumlahkan quantity bundle_id yang sama', () => {
  const merged = mergeDuplicateBundles([
    { bundle_id: BUNDLE_X, quantity: 1 },
    { bundle_id: BUNDLE_X, quantity: 2 },
  ]);
  assert.deepEqual(merged, [{ bundle_id: BUNDLE_X, quantity: 3 }]);
});

const tendaRates: ItemDayRates = { price_per_day: 20_000, day2_rate: 20_000, day3_rate: 20_000, day4_rate: 20_000, day5_rate: 20_000, extra_day_rate: 20_000 };
const matrasRates: ItemDayRates = { price_per_day: 10_000, day2_rate: 10_000, day3_rate: 10_000, day4_rate: 10_000, day5_rate: 10_000, extra_day_rate: 10_000 };

function bundleIkutiAlat(): PublicPageBundle {
  return {
    id: BUNDLE_X,
    name: 'Paket Tektok',
    pricing_mode: 'ikuti_alat',
    price_per_day: null,
    day2_rate: null,
    day3_rate: null,
    day4_rate: null,
    day5_rate: null,
    extra_day_rate: null,
    discount_type: 'percent',
    discount_value: 10,
    components: [
      { item_id: ITEM_A, quantity: 1, name: 'Tenda' },
      { item_id: ITEM_B, quantity: 1, name: 'Matras' },
    ],
  };
}

const catalogRates = new Map<string, ItemDayRates>([
  [ITEM_A, tendaRates],
  [ITEM_B, matrasRates],
]);

test('explodeBundleRow: memecah paket jadi baris per komponen dengan penanda bundle_* konsisten', () => {
  const result = explodeBundleRow(bundleIkutiAlat(), catalogRates, 2, 1);
  assert.ok('rows' in result);
  const rows = (result as { rows: any[] }).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].quantity, 2); // quantityPerBundle(1) * bundleQty(2)
  assert.equal(rows[1].quantity, 2);
  const instanceIds = new Set(rows.map((r) => r.bundle_instance_id));
  assert.equal(instanceIds.size, 1); // satu instance id untuk seluruh grup
  for (const r of rows) {
    assert.equal(r.bundle_id, BUNDLE_X);
    assert.equal(r.bundle_name, 'Paket Tektok');
    assert.equal(r.bundle_quantity, 2);
  }
});

test('explodeBundleRow: subtotal total paket dihitung dari tarif gabungan setelah diskon', () => {
  const result = explodeBundleRow(bundleIkutiAlat(), catalogRates, 1, 3) as { rows: any[]; subtotal: number };
  // Tenda+Matras = 30rb/hari, diskon 10% = 27rb/hari, 3 hari = 81rb.
  assert.equal(result.subtotal, 81_000);
});

test('explodeBundleRow: paket "sendiri" pakai tarif sendiri, bukan tarif katalog', () => {
  const bundle: PublicPageBundle = {
    ...bundleIkutiAlat(),
    pricing_mode: 'sendiri',
    price_per_day: 25_000,
    day2_rate: 25_000,
    day3_rate: 25_000,
    day4_rate: 25_000,
    day5_rate: 25_000,
    extra_day_rate: 25_000,
    discount_type: null,
    discount_value: null,
  };
  const result = explodeBundleRow(bundle, catalogRates, 1, 1) as { rows: any[]; subtotal: number };
  assert.equal(result.subtotal, 25_000);
});

test('explodeBundleRow: komponen × jumlah paket melewati batas -> error jelas, bukan RPC mentah', () => {
  const bundle: PublicPageBundle = {
    ...bundleIkutiAlat(),
    components: [{ item_id: ITEM_A, quantity: 2, name: 'Matras' }],
  };
  const result = explodeBundleRow(bundle, catalogRates, 11, 1); // 2 * 11 = 22 > 20
  assert.ok('error' in result);
  assert.match((result as { error: string }).error, /Paket Tektok/);
  assert.match((result as { error: string }).error, new RegExp(String(MAX_ITEMS_PER_REQUEST)));
});

test('explodeBundleRow: komponen tidak ada di katalog -> error', () => {
  const bundle: PublicPageBundle = {
    ...bundleIkutiAlat(),
    components: [{ item_id: '99999999-9999-9999-9999-999999999999', quantity: 1, name: 'Hilang' }],
  };
  const result = explodeBundleRow(bundle, catalogRates, 1, 1);
  assert.ok('error' in result);
});

test('gabungan paket + alat satuan sama: kebutuhan per item_id dijumlahkan (simulasi lapisan Express)', () => {
  // Paket Tektok (komponen Tenda+Matras) x1 + Tenda lepas x1 -- item_id
  // ITEM_A (Tenda) harus dijumlahkan 1(dari paket)+1(lepas)=2 sebelum
  // dibandingkan ke stok, sesuai brief bagian B/C.
  const bundleResult = explodeBundleRow(bundleIkutiAlat(), catalogRates, 1, 1) as { rows: any[] };
  const plainRows = [{ item_id: ITEM_A, quantity: 1, bundle_id: null, bundle_instance_id: null, bundle_name: null, bundle_quantity: null }];
  const allRows = [...plainRows, ...bundleResult.rows];

  const combined = new Map<string, number>();
  for (const r of allRows) combined.set(r.item_id, (combined.get(r.item_id) ?? 0) + r.quantity);

  assert.equal(combined.get(ITEM_A), 2);
  assert.equal(combined.get(ITEM_B), 1);
});
