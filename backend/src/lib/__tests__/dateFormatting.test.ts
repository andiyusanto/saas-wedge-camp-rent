// Unit test untuk format tanggal diseragamkan dd-mm-yyyy (keputusan Andi
// 10 Nov 2026) -- formatDateIndo()/formatDateTimeIndo() (frontend/src/
// utils/formatters.ts) sengaja diimpor LANGSUNG dari sumbernya (lintas
// package, pola sama seperti guideIllustrations.test.ts), supaya
// Panduan/dokumentasi tidak pernah beda dari fungsi sungguhan yang
// dipakai di seluruh aplikasi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateIndo, formatDateTimeIndo } from '../../../../frontend/src/utils/formatters.js';

test('formatDateIndo: dd-mm-yyyy tanpa nama hari', () => {
  assert.equal(formatDateIndo('2026-11-10', false), '10-11-2026');
  assert.equal(formatDateIndo('2026-01-05', false), '05-01-2026');
  assert.equal(formatDateIndo('2026-12-31', false), '31-12-2026');
});

test('formatDateIndo: dengan nama hari singkat Indonesia (default)', () => {
  // 2026-11-10 = Selasa
  assert.equal(formatDateIndo('2026-11-10'), 'Sel, 10-11-2026');
  // 2026-11-13 = Jumat (dipakai di brief/ilustrasi)
  assert.equal(formatDateIndo('2026-11-13'), 'Jum, 13-11-2026');
  // 2026-11-07 = Sabtu, 2026-11-08 = Minggu
  assert.equal(formatDateIndo('2026-11-07'), 'Sab, 07-11-2026');
  assert.equal(formatDateIndo('2026-11-08'), 'Min, 08-11-2026');
});

test('formatDateIndo: pergantian tahun', () => {
  // 2026-12-31 = Kamis, 2027-01-01 = Jumat
  assert.equal(formatDateIndo('2026-12-31'), 'Kam, 31-12-2026');
  assert.equal(formatDateIndo('2027-01-01'), 'Jum, 01-01-2027');
});

test('formatDateIndo: tanggal kosong/tidak valid', () => {
  assert.equal(formatDateIndo(''), '-');
});

test('formatDateTimeIndo: dd-mm-yyyy HH:mm, jam 24 jam, tanpa nama hari', () => {
  // Instant WIB-equivalent diuji via offset eksplisit supaya tidak
  // bergantung timezone mesin yang menjalankan test -- pakai ISO dengan
  // offset +00:00 dan cek hasil dalam UTC (tzOffsetMs di luar lingkup
  // fungsi ini; formatDateTimeIndo murni membaca komponen Date lokal
  // mesin, sama seperti perilaku sebelumnya yang dipakai struk WA/Nota).
  const result = formatDateTimeIndo('2026-11-10T07:05:00.000Z');
  // Cukup pastikan formatnya dd-mm-yyyy HH:mm (regex), bukan nilai
  // absolut jam (bisa bergeser sesuai TZ mesin test).
  assert.match(result, /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
});

test('formatDateTimeIndo: pergantian tahun tetap dd-mm-yyyy', () => {
  const result = formatDateTimeIndo('2026-12-31T20:30:00.000Z');
  assert.match(result, /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
});
