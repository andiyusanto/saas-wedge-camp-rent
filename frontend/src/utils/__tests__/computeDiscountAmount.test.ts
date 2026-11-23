// Unit test diskon Member/Mitra (brief 23 Nov 2026) -- computeDiscountAmount().
// Rumus SAMA dengan create_booking_atomic() (migration 073): SUM bruto x
// persen/100, dibulatkan. Termasuk kasus pembulatan .5 (PG round() dan
// JS Math.round() sepakat untuk angka POSITIF -- discount_percent selalu
// 0-100 dan bruto selalu >= 0, jadi tidak ada kasus negatif di sini).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiscountAmount } from '../formatters.js';

test('diskon dasar: 10% dari 100000 = 10000', () => {
  assert.equal(computeDiscountAmount(100000, 0, 10, false), 10000);
});

test('tidak berlaku untuk barang jual kalau toggle OFF, walau brutoSaleItems > 0', () => {
  assert.equal(computeDiscountAmount(100000, 50000, 10, false), 10000);
});

test('ikut barang jual kalau toggle ON', () => {
  assert.equal(computeDiscountAmount(100000, 50000, 10, true), 15000);
});

test('pembulatan .5 -- round half away from zero (sama seperti PG round() untuk bilangan positif)', () => {
  // 2001 x 50% = 1000.5 -> dibulatkan ke 1001.
  assert.equal(computeDiscountAmount(2001, 0, 50, false), 1001);
});

test('persen 0 -> diskon 0', () => {
  assert.equal(computeDiscountAmount(500000, 0, 0, false), 0);
});

test('bruto 0 -> diskon 0 walau persen > 0', () => {
  assert.equal(computeDiscountAmount(0, 0, 15, false), 0);
});
