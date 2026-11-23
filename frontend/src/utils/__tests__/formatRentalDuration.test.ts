// Unit test label lama sewa "2H1M" (brief 23 Nov 2026, migration 072) --
// formatRentalDuration(). N = 1..5, keduanya style, dan kasus
// rental_day_mode='per_hari_kalender' yang HARUS memaksa "N hari" terlepas
// dari style tersimpan (catatan review koordinator 23 Nov 2026 -- owner
// pernah pilih 2H1M lalu pindah mode, snapshot style lama tidak boleh
// ikut dipakai).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRentalDuration } from '../formatters.js';

test('style "hari" (atau null) -> selalu "N hari", N = 1..5', () => {
  for (let n = 1; n <= 5; n++) {
    assert.equal(formatRentalDuration(n, 'hari', 'per_malam'), `${n} hari`);
    assert.equal(formatRentalDuration(n, null, 'per_malam'), `${n} hari`);
  }
});

test('style "hari_malam" + mode per_malam -> "{N+1}H{N}M", N = 1..5', () => {
  assert.equal(formatRentalDuration(1, 'hari_malam', 'per_malam'), '2H1M');
  assert.equal(formatRentalDuration(2, 'hari_malam', 'per_malam'), '3H2M');
  assert.equal(formatRentalDuration(3, 'hari_malam', 'per_malam'), '4H3M');
  assert.equal(formatRentalDuration(4, 'hari_malam', 'per_malam'), '5H4M');
  assert.equal(formatRentalDuration(5, 'hari_malam', 'per_malam'), '6H5M');
});

test('style "hari_malam" TAPI rental_day_mode BUKAN per_malam -> dipaksa "N hari" (review koordinator 23 Nov 2026)', () => {
  assert.equal(formatRentalDuration(1, 'hari_malam', 'per_hari_kalender'), '1 hari');
  assert.equal(formatRentalDuration(1, 'hari_malam', null), '1 hari');
});
