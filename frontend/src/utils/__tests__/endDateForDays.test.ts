// Unit test isi otomatis tanggal kembali (brief 23 Nov 2026) --
// endDateForDays(), dipakai NewBookingModal.tsx (Catat Transaksi) dan
// disalin di routes/etalase.ts (runtime JS terpisah, vanilla) untuk
// Etalase/Pesanan Online. days = JUMLAH HARI (bukan malam).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endDateForDays } from '../formatters.js';

test('per_malam: N hari -> +N hari (ambil Sabtu, kembali +N malam)', () => {
  assert.equal(endDateForDays('2026-11-21', 1, 'per_malam'), '2026-11-22');
  assert.equal(endDateForDays('2026-11-21', 2, 'per_malam'), '2026-11-23');
  assert.equal(endDateForDays('2026-11-21', 4, 'per_malam'), '2026-11-25');
});

test('per_hari_kalender: N hari -> +(N-1) hari (ambil & kembali hari sama = 1 hari)', () => {
  assert.equal(endDateForDays('2026-11-21', 1, 'per_hari_kalender'), '2026-11-21');
  assert.equal(endDateForDays('2026-11-21', 2, 'per_hari_kalender'), '2026-11-22');
  assert.equal(endDateForDays('2026-11-21', 4, 'per_hari_kalender'), '2026-11-24');
});

test('null (baris lama, ditafsirkan per_hari_kalender) -> sama seperti per_hari_kalender', () => {
  assert.equal(endDateForDays('2026-11-21', 3, null), endDateForDays('2026-11-21', 3, 'per_hari_kalender'));
});

test('per_malam tidak pernah menghasilkan tanggal sama dengan start, walau days=0', () => {
  assert.equal(endDateForDays('2026-11-21', 0, 'per_malam'), '2026-11-22');
});
