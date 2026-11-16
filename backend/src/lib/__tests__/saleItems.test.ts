// Unit test Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration
// 066) — mergeSaleItemsForUpdate(): barang existing pakai harga
// SNAPSHOT lama apa adanya, barang baru pakai harga katalog SAAT INI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSaleItemsForUpdate,
  mergeDuplicateSaleItemRequests,
  type ExistingBookingSaleItemRow,
  type CatalogSaleItemRow,
} from '../saleItems.js';

const existingBaterai: ExistingBookingSaleItemRow = {
  sale_item_id: 'baterai',
  quantity: 2,
  price_at_booking: 10_000, // snapshot lama
  name: 'Baterai AA',
};

const catalogBaterai: CatalogSaleItemRow = {
  id: 'baterai',
  name: 'Baterai AA',
  price: 15_000, // harga katalog SEKARANG sudah naik -- tidak boleh dipakai untuk barang existing
};

const catalogJasHujan: CatalogSaleItemRow = {
  id: 'jas-hujan',
  name: 'Jas Hujan Plastik',
  price: 20_000,
};

test('mergeSaleItemsForUpdate: barang existing pakai snapshot harga lama, bukan katalog sekarang', () => {
  const result = mergeSaleItemsForUpdate(
    [{ sale_item_id: 'baterai', quantity: 3 }],
    [existingBaterai],
    [catalogBaterai],
  );
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.items[0].price_at_booking, 10_000);
  assert.equal(result.items[0].quantity, 3);
  assert.equal(result.items[0].subtotal, 30_000);
  assert.equal(result.items[0].name, 'Baterai AA');
});

test('mergeSaleItemsForUpdate: barang BARU pakai harga katalog saat ini', () => {
  const result = mergeSaleItemsForUpdate([{ sale_item_id: 'jas-hujan', quantity: 2 }], [], [catalogJasHujan]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.items[0].price_at_booking, 20_000);
  assert.equal(result.items[0].subtotal, 40_000);
});

test('mergeSaleItemsForUpdate: barang tidak ditemukan di existing maupun katalog -> error', () => {
  const result = mergeSaleItemsForUpdate([{ sale_item_id: 'tidak-ada', quantity: 1 }], [], []);
  assert.equal(result.ok, false);
});

test('mergeSaleItemsForUpdate: quantity 0 atau negatif -> error', () => {
  const result = mergeSaleItemsForUpdate([{ sale_item_id: 'baterai', quantity: 0 }], [existingBaterai], []);
  assert.equal(result.ok, false);
});

test('mergeSaleItemsForUpdate: gabungan existing+baru, total subtotal benar', () => {
  const result = mergeSaleItemsForUpdate(
    [
      { sale_item_id: 'baterai', quantity: 4 },
      { sale_item_id: 'jas-hujan', quantity: 1 },
    ],
    [existingBaterai],
    [catalogJasHujan],
  );
  assert.ok(result.ok);
  if (!result.ok) return;
  const total = result.items.reduce((sum, it) => sum + it.subtotal, 0);
  assert.equal(total, 4 * 10_000 + 1 * 20_000);
});

test('mergeDuplicateSaleItemRequests: baris sale_item_id sama dijumlahkan', () => {
  const merged = mergeDuplicateSaleItemRequests([
    { sale_item_id: 'baterai', quantity: 2 },
    { sale_item_id: 'baterai', quantity: 3 },
  ]);
  assert.deepEqual(merged, [{ sale_item_id: 'baterai', quantity: 5 }]);
});

test('mergeSaleItemsForUpdate: baris duplikat di requested otomatis digabung sebelum resolusi harga', () => {
  const result = mergeSaleItemsForUpdate(
    [
      { sale_item_id: 'baterai', quantity: 1 },
      { sale_item_id: 'baterai', quantity: 2 },
    ],
    [existingBaterai],
    [],
  );
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 3);
});
