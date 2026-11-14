// Unit test untuk Ubah Alat (migration 061, brief 14 Nov 2026) —
// mergeBookingItemsForUpdate(): alat existing pakai tarif SNAPSHOT
// lama apa adanya, alat baru pakai tarif katalog SAAT INI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBookingItemsForUpdate, type ExistingBookingItemRow, type CatalogItemRow } from '../bookingItems.js';

// Alat A sudah ada di booking dengan tarif SNAPSHOT lama (katalog
// sekarang sudah berbeda, sengaja — supaya tes membuktikan snapshot
// LAMA yang dipakai, bukan katalog sekarang).
const existingItemA: ExistingBookingItemRow = {
  item_id: 'item-a',
  quantity: 1,
  price_at_booking: 30_000, // tarif snapshot lama
  day2_rate_at_booking: 20_000,
  day3_rate_at_booking: 10_000,
  day4_rate_at_booking: 10_000,
  day5_rate_at_booking: 10_000,
  extra_day_rate_at_booking: 10_000,
};

const catalogItemA: CatalogItemRow = {
  id: 'item-a',
  price_per_day: 50_000, // katalog SEKARANG sudah naik -- tidak boleh dipakai untuk alat existing
  day2_rate: 50_000,
  day3_rate: 50_000,
  day4_rate: 50_000,
  day5_rate: 50_000,
  extra_day_rate: 50_000,
};

const catalogItemB: CatalogItemRow = {
  id: 'item-b',
  price_per_day: 15_000,
  day2_rate: 10_000,
  day3_rate: 10_000,
  day4_rate: 10_000,
  day5_rate: 10_000,
  extra_day_rate: 10_000,
};

test('alat existing tetap pakai tarif SNAPSHOT lama, bukan katalog sekarang', () => {
  const result = mergeBookingItemsForUpdate(
    [{ item_id: 'item-a', quantity: 1 }],
    [existingItemA],
    [catalogItemA],
    3, // 3 hari
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].price_at_booking, 30_000); // snapshot lama, BUKAN 50_000 katalog sekarang
  // 3 hari: 30rb + 20rb + 10rb = 60rb
  assert.equal(result.items[0].subtotal, 60_000);
});

test('alat baru (belum pernah ada di booking) pakai tarif katalog SAAT INI', () => {
  const result = mergeBookingItemsForUpdate(
    [{ item_id: 'item-b', quantity: 2 }],
    [existingItemA], // item-b belum ada di existing
    [catalogItemA, catalogItemB],
    2, // 2 hari
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].price_at_booking, 15_000); // dari katalog
  // 2 hari x 2 unit: (15rb + 10rb) * 2 = 50rb
  assert.equal(result.items[0].subtotal, 50_000);
});

test('campuran: alat existing (snapshot) + alat baru (katalog) dalam satu panggilan', () => {
  const result = mergeBookingItemsForUpdate(
    [
      { item_id: 'item-a', quantity: 1 },
      { item_id: 'item-b', quantity: 1 },
    ],
    [existingItemA],
    [catalogItemA, catalogItemB],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const a = result.items.find((i) => i.item_id === 'item-a')!;
  const b = result.items.find((i) => i.item_id === 'item-b')!;
  assert.equal(a.price_at_booking, 30_000);
  assert.equal(b.price_at_booking, 15_000);
});

test('ubah jumlah alat existing TIDAK mengubah tarif snapshot-nya', () => {
  const result = mergeBookingItemsForUpdate([{ item_id: 'item-a', quantity: 5 }], [existingItemA], [catalogItemA], 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0].price_at_booking, 30_000);
  assert.equal(result.items[0].subtotal, 30_000 * 5);
});

test('item_id tidak ditemukan di existing maupun katalog -> error', () => {
  const result = mergeBookingItemsForUpdate([{ item_id: 'item-ghost', quantity: 1 }], [existingItemA], [catalogItemA], 1);
  assert.equal(result.ok, false);
});

test('daftar alat kosong -> error "minimal satu alat"', () => {
  const result = mergeBookingItemsForUpdate([], [existingItemA], [catalogItemA], 1);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /minimal satu alat/i);
});

test('quantity bukan bilangan bulat positif -> error', () => {
  assert.equal(mergeBookingItemsForUpdate([{ item_id: 'item-a', quantity: 0 }], [existingItemA], [catalogItemA], 1).ok, false);
  assert.equal(
    mergeBookingItemsForUpdate([{ item_id: 'item-a', quantity: 1.5 }], [existingItemA], [catalogItemA], 1).ok,
    false,
  );
  assert.equal(
    mergeBookingItemsForUpdate([{ item_id: 'item-a', quantity: -1 }], [existingItemA], [catalogItemA], 1).ok,
    false,
  );
});

test('menghapus alat (tidak ikut dikirim di requested) -> tidak muncul di hasil merge', () => {
  const result = mergeBookingItemsForUpdate([{ item_id: 'item-b', quantity: 1 }], [existingItemA], [catalogItemA, catalogItemB], 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.find((i) => i.item_id === 'item-a'), undefined);
});
