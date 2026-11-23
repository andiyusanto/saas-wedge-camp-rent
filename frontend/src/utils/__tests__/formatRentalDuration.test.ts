// Unit test label lama sewa "2H1M" (brief 23 Nov 2026, migration 072;
// diperluas 24 Nov 2026 untuk rental_day_mode='per_hari_kalender' --
// Wasup: "1 kali sewa = 2 hari 1 malam" meski mode mereka per_hari_kalender,
// bukan per_malam). formatRentalDuration() -- dua rumus beda per mode:
// per_malam = "{N+1}H{N}M" (N = jumlah MALAM); per_hari_kalender (termasuk
// null, baris lama) = "{N}H{N-1}M" (N = jumlah hari KALENDER, N=1 tetap
// "1 hari" biasa, tidak ada "1H0M").
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

test('style "hari_malam" + mode per_hari_kalender (termasuk null) -> "{N}H{N-1}M" untuk N>=2, "1 hari" untuk N=1 (brief 24 Nov 2026)', () => {
  assert.equal(formatRentalDuration(1, 'hari_malam', 'per_hari_kalender'), '1 hari');
  assert.equal(formatRentalDuration(1, 'hari_malam', null), '1 hari');
  assert.equal(formatRentalDuration(2, 'hari_malam', 'per_hari_kalender'), '2H1M');
  assert.equal(formatRentalDuration(2, 'hari_malam', null), '2H1M');
  assert.equal(formatRentalDuration(4, 'hari_malam', 'per_hari_kalender'), '4H3M');
});
