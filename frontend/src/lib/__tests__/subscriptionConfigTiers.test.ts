// Unit test resolvePriceTier() -- 3 tingkat harga (keputusan Andi 24 Nov
// 2026, migration 074, Opsi B Pendiri->Perkenalan). Tes ini memverifikasi
// HASIL resolusi tingkat harga untuk kombinasi flag yang SEHARUSNYA
// dihasilkan oleh record_subscription_payment() (migration) untuk tiap
// skenario di brief -- bukan menjalankan SQL sungguhan (di luar
// jangkauan unit test Node), tapi memastikan logika frontend membaca
// flag-flag itu dengan benar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePriceTier, isFounderEligible, pricingAnnounced, PRICING_ANNOUNCE_AT_ISO } from '../subscriptionConfig.js';

test('Pendiri bulan 1-12: founder_price_until belum lewat -> founder (39rb)', () => {
  const founderEligible = isFounderEligible('2026-11-01T00:00:00+07:00', null);
  assert.equal(founderEligible, true);
  for (const periodStart of ['2026-12-01', '2027-06-01', '2027-11-30']) {
    assert.equal(
      resolvePriceTier({
        founderEligible,
        founderPriceUntil: '2027-11-30', // 12 bulan dari pembayaran pertama 2026-12-01
        perkenalanLockedForever: false,
        perkenalanPriceUntil: null,
        periodStart,
      }),
      'founder',
    );
  }
});

test('Pendiri bulan 13+ (tidak pernah putus) -> perkenalan (49rb) TANPA BATAS', () => {
  // Setelah founder_price_until lewat dan tidak pernah putus, migration
  // mengunci perkenalan_locked_forever=true -- perkenalan_price_until
  // TETAP null selamanya (tidak pernah diisi untuk kasus ini).
  for (const periodStart of ['2027-12-01', '2029-01-01', '2035-06-15']) {
    assert.equal(
      resolvePriceTier({
        founderEligible: true,
        founderPriceUntil: '2027-11-30',
        perkenalanLockedForever: true,
        perkenalanPriceUntil: null,
        periodStart,
      }),
      'perkenalan',
    );
  }
});

test('Pendiri putus lalu kembali 2027 -> perkenalan 12 bulan dari comeback, lalu normal', () => {
  // Comeback periodStart 2027-06-01 -> perkenalan_price_until (migration)
  // = 2028-05-31 (12 bulan - 1 hari), perkenalan_locked_forever DICABUT
  // (false) oleh migration saat putus terdeteksi.
  const perkenalanPriceUntil = '2028-05-31';
  assert.equal(
    resolvePriceTier({
      founderEligible: true,
      founderPriceUntil: '2027-01-01', // sudah lama lewat
      perkenalanLockedForever: false,
      perkenalanPriceUntil,
      periodStart: '2027-06-01',
    }),
    'perkenalan',
  );
  assert.equal(
    resolvePriceTier({
      founderEligible: true,
      founderPriceUntil: '2027-01-01',
      perkenalanLockedForever: false,
      perkenalanPriceUntil,
      periodStart: '2028-05-31',
    }),
    'perkenalan',
  );
  // Setelah 12 bulan comeback itu lewat -> normal.
  assert.equal(
    resolvePriceTier({
      founderEligible: true,
      founderPriceUntil: '2027-01-01',
      perkenalanLockedForever: false,
      perkenalanPriceUntil,
      periodStart: '2028-06-01',
    }),
    'normal',
  );
});

test('Pendiri putus lalu kembali 2028 (lewat batas eligibility Perkenalan) -> langsung normal', () => {
  // Comeback periodStart 2028-01-15 > batas 2027-12-31 -> migration TIDAK
  // mengisi perkenalan_price_until sama sekali (tetap null selamanya).
  assert.equal(
    resolvePriceTier({
      founderEligible: true,
      founderPriceUntil: '2027-01-01',
      perkenalanLockedForever: false,
      perkenalanPriceUntil: null,
      periodStart: '2028-01-15',
    }),
    'normal',
  );
});

test('BUG FIX koordinator: Pendiri putus -> kembali -> BAYAR LAGI (kontinu) -> TIDAK terkunci 49-selamanya, tetap di jendela Perkenalan lalu normal setelah 12 bulan', () => {
  // Pembayaran comeback (2027-06-01) mengisi perkenalan_price_until =
  // 2028-05-31. Pembayaran BERIKUTNYA yang kontinu (mis. 2027-07-01,
  // bulanan) HARUS TETAP 'perkenalan' (bukan balik dikunci 49-selamanya)
  // karena perkenalan_price_until sudah terisi -- guard tambahan di
  // migration (`perkenalan_price_until is null`) mencegah pengambilan
  // kunci 49-selamanya kedua kalinya untuk kasus ini.
  const perkenalanPriceUntil = '2028-05-31';
  assert.equal(
    resolvePriceTier({
      founderEligible: true,
      founderPriceUntil: '2027-01-01',
      perkenalanLockedForever: false, // TIDAK terkunci lagi (fix)
      perkenalanPriceUntil,
      periodStart: '2027-07-01',
    }),
    'perkenalan',
  );
  // Setelah jendela 12 bulan comeback itu habis -> normal, BUKAN kembali
  // ke 49-selamanya.
  assert.equal(
    resolvePriceTier({
      founderEligible: true,
      founderPriceUntil: '2027-01-01',
      perkenalanLockedForever: false,
      perkenalanPriceUntil,
      periodStart: '2028-07-01',
    }),
    'normal',
  );
});

test('Non-Pendiri: perkenalan 12 bulan sejak pembayaran pertama, lalu normal (tidak terpengaruh putus)', () => {
  const perkenalanPriceUntil = '2027-05-31'; // pembayaran pertama periodStart 2026-06-01
  assert.equal(
    resolvePriceTier({
      founderEligible: false,
      founderPriceUntil: null,
      perkenalanLockedForever: false,
      perkenalanPriceUntil,
      periodStart: '2026-06-01',
    }),
    'perkenalan',
  );
  assert.equal(
    resolvePriceTier({
      founderEligible: false,
      founderPriceUntil: null,
      perkenalanLockedForever: false,
      perkenalanPriceUntil,
      periodStart: '2027-05-31',
    }),
    'perkenalan',
  );
  assert.equal(
    resolvePriceTier({
      founderEligible: false,
      founderPriceUntil: null,
      perkenalanLockedForever: false,
      perkenalanPriceUntil,
      periodStart: '2027-06-01',
    }),
    'normal',
  );
});

test('Non-Pendiri belum pernah bayar sama sekali -> saran perkenalan sebelum batas 2027-12-31, normal sesudahnya', () => {
  assert.equal(
    resolvePriceTier({
      founderEligible: false,
      founderPriceUntil: null,
      perkenalanLockedForever: false,
      perkenalanPriceUntil: null,
      periodStart: '2027-06-01',
    }),
    'perkenalan',
  );
  assert.equal(
    resolvePriceTier({
      founderEligible: false,
      founderPriceUntil: null,
      perkenalanLockedForever: false,
      perkenalanPriceUntil: null,
      periodStart: '2028-01-01',
    }),
    'normal',
  );
});

// Embargo harga (review koordinator 24 Nov 2026): kode ini mungkin
// sudah di-deploy SEBELUM 20 Des 2026 -- LanggananScreen.tsx menggerbang
// SELURUH angka harga (dan status tingkat) di belakang pricingAnnounced(),
// jadi fungsi murni ini adalah SATU-SATUNYA titik yang menentukan kapan
// angka boleh tampil. Alat Admin (AdminPaymentModal.tsx) SENGAJA TIDAK
// ikut digerbang -- cuma Andi yang melihatnya, perlu saran nominal
// kapan pun untuk mencatat pembayaran manual.
test('pricingAnnounced: false sebelum 20 Des 2026 WIB, true persis di/setelah batas', () => {
  assert.equal(pricingAnnounced(new Date('2026-12-19T23:59:59+07:00')), false);
  assert.equal(pricingAnnounced(new Date('2026-11-01T00:00:00+07:00')), false);
  assert.equal(pricingAnnounced(new Date(PRICING_ANNOUNCE_AT_ISO)), true);
  assert.equal(pricingAnnounced(new Date('2026-12-20T00:00:01+07:00')), true);
  assert.equal(pricingAnnounced(new Date('2027-01-01T00:00:00+07:00')), true);
});

test('flag wawancara (founder_override true) mengalahkan tanggal daftar', () => {
  assert.equal(isFounderEligible('2027-03-01T00:00:00+07:00', true), true);
  assert.equal(
    resolvePriceTier({
      founderEligible: true,
      founderPriceUntil: null,
      perkenalanLockedForever: false,
      perkenalanPriceUntil: null,
      periodStart: '2027-06-01',
    }),
    'founder',
  );
});
