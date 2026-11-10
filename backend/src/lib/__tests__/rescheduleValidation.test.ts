// Unit test untuk validasi input PATCH /bookings/:id/reschedule dan
// /extend (Tahap 2, migration 055) — ditambahkan setelah review -c1
// (10 Nov 2026) menemukan `Number(x) || 0` diam-diam mengubah NaN jadi
// 0 dan menerima nilai minus untuk total_price, dan start_date/end_date
// cuma dicek truthy (bukan format/validitas tanggal sungguhan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDateStr, validateOptionalTotalPriceAndReason } from '../validation.js';

test('isValidDateStr menolak format dan tanggal tidak valid', () => {
  assert.equal(isValidDateStr('2026-11-10'), true);
  assert.equal(isValidDateStr('2026-02-29'), false); // 2026 bukan tahun kabisat
  assert.equal(isValidDateStr('2024-02-29'), true); // 2024 tahun kabisat
  assert.equal(isValidDateStr('2026-13-01'), false); // bulan tidak valid
  assert.equal(isValidDateStr('2026-11-10T00:00:00Z'), false); // bukan format polos
  assert.equal(isValidDateStr('10/11/2026'), false);
  assert.equal(isValidDateStr(''), false);
  assert.equal(isValidDateStr(undefined), false);
  assert.equal(isValidDateStr(null), false);
});

test('validateOptionalTotalPriceAndReason: total_price harus angka >= 0', () => {
  assert.equal(validateOptionalTotalPriceAndReason(undefined, undefined), null); // tidak dikirim = ok
  assert.equal(validateOptionalTotalPriceAndReason(100000, undefined), null);
  assert.equal(validateOptionalTotalPriceAndReason(0, undefined), null);
  assert.notEqual(validateOptionalTotalPriceAndReason(-1, undefined), null); // minus ditolak
  assert.notEqual(validateOptionalTotalPriceAndReason('abc', undefined), null); // NaN ditolak, bukan diam-diam jadi 0
  assert.notEqual(validateOptionalTotalPriceAndReason(NaN, undefined), null);
  assert.notEqual(validateOptionalTotalPriceAndReason(Infinity, undefined), null);
});

test('validateOptionalTotalPriceAndReason: reason maksimal 500 karakter', () => {
  assert.equal(validateOptionalTotalPriceAndReason(undefined, undefined), null);
  assert.equal(validateOptionalTotalPriceAndReason(undefined, 'a'.repeat(500)), null);
  assert.notEqual(validateOptionalTotalPriceAndReason(undefined, 'a'.repeat(501)), null);
});
