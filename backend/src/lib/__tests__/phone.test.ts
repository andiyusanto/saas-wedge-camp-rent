// Unit test normalisasi nomor WA (brief 23 Nov 2026 -- cocokkan
// pelanggan existing di POST /bookings). Diekstrak dari
// routes/bookingRequests.ts, test ini sekarang jadi test resminya.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../phone.js';

test('08xxx -> 628xxx', () => {
  assert.equal(normalizePhone('081234000003'), '6281234000003');
});

test('628xxx tetap 628xxx', () => {
  assert.equal(normalizePhone('6281234000003'), '6281234000003');
});

test('+628xxx -> 628xxx', () => {
  assert.equal(normalizePhone('+6281234000003'), '6281234000003');
});

test('spasi dan strip dibuang sebelum normalisasi', () => {
  assert.equal(normalizePhone('0812-3400-0003'), '6281234000003');
  assert.equal(normalizePhone('0812 3400 0003'), '6281234000003');
  assert.equal(normalizePhone('+62 812-3400-0003'), '6281234000003');
});

test('keempat bentuk nomor yang sama menghasilkan hasil normalisasi identik', () => {
  const variants = ['081234000003', '6281234000003', '+6281234000003', '0812-3400-0003'];
  const normalized = variants.map(normalizePhone);
  for (const n of normalized) assert.equal(n, normalized[0]);
});
