// Unit test harga Pendiri (keputusan Andi 12 Nov 2026, migration 060) —
// isFounderEligible() (otomatis created_at vs override admin) dan
// isFounderPricing() (masa berlaku 12 bulan dari pembayaran pertama,
// tidak hangus karena jeda). Skenario diminta koordinator saat approve
// desain final.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFounderEligible, isFounderPricing, FOUNDER_CUTOFF_ISO } from '../subscriptionConfig.js';

void FOUNDER_CUTOFF_ISO; // dipakai tidak langsung lewat tanggal di bawah, impor untuk dokumentasi skenario

test('daftar Desember 2026 (sebelum cutoff), tanpa override -> eligible pendiri', () => {
  assert.equal(isFounderEligible('2026-12-15T10:00:00+07:00', null), true);
});

test('daftar Januari 2027 (setelah cutoff), tanpa override -> normal', () => {
  assert.equal(isFounderEligible('2027-01-15T10:00:00+07:00', null), false);
});

test('daftar Januari 2027, ditandai manual admin -> eligible pendiri', () => {
  assert.equal(isFounderEligible('2027-01-15T10:00:00+07:00', true), true);
});

test('daftar Desember 2026, dibatalkan manual admin -> normal walau otomatis eligible', () => {
  assert.equal(isFounderEligible('2026-12-15T10:00:00+07:00', false), false);
});

test('belum pernah bayar (founder_price_until null) -> tetap harga pendiri untuk saran pembayaran pertama', () => {
  assert.equal(isFounderPricing(true, null, '2027-03-01'), true);
});

test('bulan ke-13 setelah pembayaran pertama -> normal (lewat founder_price_until)', () => {
  // Pembayaran pertama periodStart 2027-01-10 -> founder_price_until 2028-01-09.
  const founderPriceUntil = '2028-01-09';
  assert.equal(isFounderPricing(true, founderPriceUntil, '2028-02-01'), false);
});

test('jeda di dalam 12 bulan -> tetap pendiri (founder_price_until tidak berubah oleh jeda)', () => {
  const founderPriceUntil = '2028-01-09';
  // periodStart pembayaran kedua mundur karena sempat jeda/telat, tapi
  // masih <= founder_price_until -> tetap pendiri.
  assert.equal(isFounderPricing(true, founderPriceUntil, '2027-11-20'), true);
});

test('tidak eligible -> selalu normal apa pun founder_price_until-nya', () => {
  assert.equal(isFounderPricing(false, '2028-01-09', '2027-03-01'), false);
});
