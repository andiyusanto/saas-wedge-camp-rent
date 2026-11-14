// Unit test batas jam kembali TETAP (migration 062, brief 14 Nov 2026) —
// computeDueAt() dengan returnDeadlineTime/returnDeadlineNextDay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDueAt } from '../penalty.js';

const WIB = 'Asia/Jakarta';
const WITA = 'Asia/Makassar';

test('returnDeadlineTime null -> regresi PERSIS sama (ikut jam ambil/created_at)', () => {
  // Ambil (created_at) Senin 10:00 WIB, end_date Rabu -> due Rabu 10:00 WIB.
  const createdAt = '2026-11-09T03:00:00.000Z'; // 10:00 WIB
  const due = computeDueAt('2026-11-11', createdAt, null, WIB, null, false);
  assert.equal(due.toISOString(), '2026-11-11T03:00:00.000Z'); // Rabu 10:00 WIB
});

test('jam tetap 22:00 -> due end_date pukul 22:00 WIB, tidak peduli jam ambil', () => {
  const createdAt = '2026-11-09T03:00:00.000Z'; // 10:00 WIB (tidak relevan)
  const due = computeDueAt('2026-11-11', createdAt, null, WIB, '22:00', false);
  assert.equal(due.toISOString(), '2026-11-11T15:00:00.000Z'); // 22:00 WIB = 15:00 UTC
});

test('00:00 TANPA hari berikutnya -> end_date+1 00:00 (bukan end_date 00:00)', () => {
  const createdAt = '2026-11-09T00:00:00.000Z'; // 07:00 WIB, jauh dari batas
  const due = computeDueAt('2026-11-11', createdAt, null, WIB, '00:00', false);
  assert.equal(due.toISOString(), '2026-11-11T17:00:00.000Z'); // 2026-11-12 00:00 WIB = 2026-11-11 17:00 UTC
});

test('00:00 DENGAN hari berikutnya=true -> hasil SAMA (tidak dobel jadi +2 hari)', () => {
  const createdAt = '2026-11-09T00:00:00.000Z';
  const dueWithoutNextDay = computeDueAt('2026-11-11', createdAt, null, WIB, '00:00', false);
  const dueWithNextDay = computeDueAt('2026-11-11', createdAt, null, WIB, '00:00', true);
  assert.equal(dueWithoutNextDay.toISOString(), dueWithNextDay.toISOString());
});

test('hari berikutnya 12:00 -> due end_date+1 pukul 12:00 WIB', () => {
  const createdAt = '2026-11-09T00:00:00.000Z';
  const due = computeDueAt('2026-11-11', createdAt, null, WIB, '12:00', true);
  assert.equal(due.toISOString(), '2026-11-12T05:00:00.000Z'); // 2026-11-12 12:00 WIB = 05:00 UTC
});

test('WITA: jam tetap 22:00 dihitung di zona WITA (UTC+8), bukan WIB', () => {
  const createdAt = '2026-11-09T00:00:00.000Z';
  const due = computeDueAt('2026-11-11', createdAt, null, WITA, '22:00', false);
  assert.equal(due.toISOString(), '2026-11-11T14:00:00.000Z'); // 22:00 WITA = 14:00 UTC
});

test('toleransi tetap diterapkan DI ATAS due dari jam tetap (computeDueAt sendiri tidak menyentuh toleransi)', () => {
  // Jam tetap 22:00 WIB (15:00 UTC) tanggal 11; kembali 23:00 WIB (16:00 UTC)
  // tanggal 11 -> 1 jam telat, masih di dalam toleransi 6 jam -> hoursLate
  // dihitung normal oleh hoursLate(), computeDueAt() tidak tahu toleransi.
  const due = computeDueAt('2026-11-11', '2026-11-09T00:00:00.000Z', null, WIB, '22:00', false);
  const returnAt = new Date('2026-11-11T16:00:00.000Z'); // 23:00 WIB
  const diffHours = (returnAt.getTime() - due.getTime()) / (60 * 60 * 1000);
  assert.equal(diffHours, 1);
});

test('booking lama tanpa snapshot (returnDeadlineTime undefined, dari DB kolom null) -> fallback ke jam ambil, sama seperti null eksplisit', () => {
  const createdAt = '2026-11-09T03:00:00.000Z'; // 10:00 WIB
  // undefined tidak valid secara TS untuk parameter ini (string | null),
  // tapi dari DB baris lama nilainya memang null murni -- disimulasikan
  // langsung dengan null, bukan undefined, karena itulah bentuk data asli.
  const due = computeDueAt('2026-11-11', createdAt, null, WIB, null, false);
  assert.equal(due.toISOString(), '2026-11-11T03:00:00.000Z');
});

test('due <= anchor (ambil 23:00, batas 22:00 di hari yang sama) -> digeser +1 hari, jaring pengaman', () => {
  // picked_up_at 23:00 WIB tanggal 11, end_date = 11 (sewa 1 hari jalan),
  // batas tetap 22:00 -> due mentah 22:00 tgl 11 SUDAH LEWAT dari jam
  // ambil (23:00 tgl 11) -> harus digeser ke 22:00 tgl 12.
  const pickedUpAt = '2026-11-11T16:00:00.000Z'; // 23:00 WIB
  const due = computeDueAt('2026-11-11', '2026-11-11T15:00:00.000Z', pickedUpAt, WIB, '22:00', false);
  assert.equal(due.toISOString(), '2026-11-12T15:00:00.000Z'); // 22:00 WIB tgl 12 = 15:00 UTC tgl 12
  assert.ok(due.getTime() > new Date(pickedUpAt).getTime(), 'due harus setelah jam ambil sungguhan');
});

test('due > anchor (kasus normal) -> TIDAK ikut digeser oleh jaring pengaman', () => {
  const pickedUpAt = '2026-11-09T03:00:00.000Z'; // 10:00 WIB, jauh sebelum due
  const due = computeDueAt('2026-11-11', pickedUpAt, pickedUpAt, WIB, '22:00', false);
  assert.equal(due.toISOString(), '2026-11-11T15:00:00.000Z'); // tetap end_date pukul 22:00, tidak digeser
});
