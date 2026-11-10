// Memastikan angka contoh di 6 ilustrasi Panduan
// (frontend/src/components/guideIllustrations.tsx, datanya di
// frontend/src/utils/guideIllustrationData.ts) SAMA PERSIS dengan hasil
// fungsi hitung asli -- supaya Panduan tidak pernah diam-diam beda dari
// aplikasi sungguhan. Lintas package (frontend data, backend test) --
// sengaja diimpor langsung dari sumbernya (bukan ditulis ulang di sini),
// dijalankan lewat tsx yang transpile TS apa adanya terlepas dari package
// boundary; data file itu sendiri murni TS tanpa JSX/import React.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTieredLateFee } from '../penalty.js';
import { computeItemRentalPrice } from '../pricing.js';
import { rentalDuration } from '../dates.js';
import { usedUnitsOn } from '../availability.js';
import {
  LATE_FEE_EXAMPLE,
  PACKAGE_DAYS_EXAMPLE,
  DURATION_MODE_EXAMPLE,
  TIERED_PRICE_EXAMPLE,
  READINESS_EXAMPLE,
} from '../../../../frontend/src/utils/guideIllustrationData.js';

test('Ilustrasi 1 (denda telat): tiap titik cocok dengan computeTieredLateFee', () => {
  for (const p of LATE_FEE_EXAMPLE.points) {
    const fee = computeTieredLateFee(p.hoursLate, LATE_FEE_EXAMPLE.toleranceHours, LATE_FEE_EXAMPLE.rentDuration, LATE_FEE_EXAMPLE.rates);
    assert.equal(fee, p.fee, `${p.label}: computeTieredLateFee=${fee}, ilustrasi=${p.fee}`);
  }
});

test('Ilustrasi 2 (paket N hari): total 4/5/6 hari cocok dengan computeItemRentalPrice', () => {
  for (const t of PACKAGE_DAYS_EXAMPLE.totals) {
    const total = computeItemRentalPrice(PACKAGE_DAYS_EXAMPLE.rates, t.days);
    assert.equal(total, t.total, `${t.days} hari: computeItemRentalPrice=${total}, ilustrasi=${t.total}`);
  }
});

test('Ilustrasi 3 (per malam vs per hari kalender): cocok dengan rentalDuration', () => {
  assert.equal(
    rentalDuration(DURATION_MODE_EXAMPLE.startDate, DURATION_MODE_EXAMPLE.endDate, 'per_malam'),
    DURATION_MODE_EXAMPLE.perMalam,
  );
  assert.equal(
    rentalDuration(DURATION_MODE_EXAMPLE.startDate, DURATION_MODE_EXAMPLE.endDate, 'per_hari_kalender'),
    DURATION_MODE_EXAMPLE.perHariKalender,
  );
});

test('Ilustrasi 4 (harga bertingkat): total 3 hari cocok dengan computeItemRentalPrice', () => {
  const total = computeItemRentalPrice(TIERED_PRICE_EXAMPLE.fullRates, 3);
  assert.equal(total, TIERED_PRICE_EXAMPLE.total3Days);
  // Tangga per-hari di ilustrasi (rates[]) juga harus sama dengan fullRates.
  assert.equal(TIERED_PRICE_EXAMPLE.rates[0].price, TIERED_PRICE_EXAMPLE.fullRates.price_per_day);
  assert.equal(TIERED_PRICE_EXAMPLE.rates[1].price, TIERED_PRICE_EXAMPLE.fullRates.day2_rate);
  assert.equal(TIERED_PRICE_EXAMPLE.rates[2].price, TIERED_PRICE_EXAMPLE.fullRates.day3_rate);
});

test('Ilustrasi 5 (jeda persiapan): Senin+Selasa terblokir, Rabu tersedia -- cocok usedUnitsOn', () => {
  const bookingItems = [
    {
      item_id: 'qa-item',
      quantity: 1,
      booking_id: 'qa-booking',
      bookings: {
        start_date: '2026-11-05',
        end_date: READINESS_EXAMPLE.returnDateStr,
        status: 'selesai',
        actual_return_at: `${READINESS_EXAMPLE.returnDateStr}T10:00:00+07:00`,
      },
    },
  ];
  for (const d of READINESS_EXAMPLE.days) {
    const used = usedUnitsOn(bookingItems, 'qa-item', d.dateStr, READINESS_EXAMPLE.readinessHours, 'Asia/Jakarta');
    const expectedBlocked = d.status !== 'Tersedia';
    assert.equal(used > 0, expectedBlocked, `${d.label} (${d.dateStr}): used=${used}, expectedBlocked=${expectedBlocked}`);
  }
});
