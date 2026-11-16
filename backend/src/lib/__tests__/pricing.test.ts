// Unit test untuk Paket Alat Tahap 1 (brief 15 Nov 2026, migration 064)
// -- alokasi harga paket ke komponen, snapshot tarif *_at_booking ber-
// rasio (koordinator 15 Nov 2026: denda telat/Perpanjang/Ubah Jadwal
// ikut "harga paket", bukan tarif katalog asli).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeItemRentalPrice,
  combinedComponentRates,
  applyBundleDiscount,
  allocateBundlePrice,
  computeBundleComponentRatesSnapshot,
  computeBookingItemSubtotal,
  type ItemDayRates,
  type BundleComponent,
} from '../pricing.js';

const tenda: ItemDayRates = { price_per_day: 30_000, day2_rate: 20_000, day3_rate: 10_000, day4_rate: 10_000, day5_rate: 10_000, extra_day_rate: 10_000 };
const carrier: ItemDayRates = { price_per_day: 20_000, day2_rate: 20_000, day3_rate: 20_000, day4_rate: 20_000, day5_rate: 20_000, extra_day_rate: 20_000 };

test('combinedComponentRates: jumlah tarif komponen dikali quantityPerBundle', () => {
  const components: BundleComponent[] = [
    { item_id: 'tenda', quantityPerBundle: 1, catalogRates: tenda },
    { item_id: 'carrier', quantityPerBundle: 2, catalogRates: carrier },
  ];
  const combined = combinedComponentRates(components);
  assert.equal(combined.price_per_day, 30_000 + 2 * 20_000);
  assert.equal(combined.day2_rate, 20_000 + 2 * 20_000);
});

test('applyBundleDiscount: persen diterapkan per tingkat hari', () => {
  const discounted = applyBundleDiscount(tenda, 'percent', 10);
  assert.equal(discounted.price_per_day, 27_000);
  assert.equal(discounted.day2_rate, 18_000);
});

test('applyBundleDiscount: nominal per hari, tidak pernah negatif', () => {
  const discounted = applyBundleDiscount(tenda, 'nominal', 25_000);
  assert.equal(discounted.price_per_day, 5_000);
  assert.equal(discounted.day3_rate, 0); // 10_000 - 25_000 -> floor di 0, bukan negatif
});

test('applyBundleDiscount: null type/value -> tidak berubah', () => {
  assert.deepEqual(applyBundleDiscount(tenda, null, null), tenda);
});

test('allocateBundlePrice: jumlah alokasi persis sama dengan total (sisa pembulatan ke komponen pertama)', () => {
  const components: BundleComponent[] = [
    { item_id: 'tenda', quantityPerBundle: 1, catalogRates: tenda },
    { item_id: 'carrier', quantityPerBundle: 1, catalogRates: carrier },
  ];
  // Total ganjil sengaja dipilih supaya ada sisa pembulatan.
  const allocated = allocateBundlePrice(components, 100_001, 3);
  const sum = allocated.reduce((s, a) => s + a.subtotalPerInstance, 0);
  assert.equal(sum, 100_001);
  assert.equal(allocated[0].item_id, 'tenda');
});

test('allocateBundlePrice: proporsional terhadap harga mandiri komponen untuk N hari', () => {
  const components: BundleComponent[] = [
    { item_id: 'tenda', quantityPerBundle: 1, catalogRates: tenda }, // standalone 3 hari = 30000+20000+10000 = 60000
    { item_id: 'carrier', quantityPerBundle: 1, catalogRates: carrier }, // standalone 3 hari = 60000
  ];
  // Standalone sama (60000 vs 60000) -> dibagi rata.
  const allocated = allocateBundlePrice(components, 100_000, 3);
  assert.equal(allocated[0].subtotalPerInstance, 50_000);
  assert.equal(allocated[1].subtotalPerInstance, 50_000);
});

test('allocateBundlePrice: semua komponen Rp0 -> bagi rata, sisa ke komponen pertama', () => {
  const free: ItemDayRates = { price_per_day: 0, day2_rate: 0, day3_rate: 0, day4_rate: 0, day5_rate: 0, extra_day_rate: 0 };
  const components: BundleComponent[] = [
    { item_id: 'a', quantityPerBundle: 1, catalogRates: free },
    { item_id: 'b', quantityPerBundle: 1, catalogRates: free },
    { item_id: 'c', quantityPerBundle: 1, catalogRates: free },
  ];
  const allocated = allocateBundlePrice(components, 100, 1);
  const sum = allocated.reduce((s, a) => s + a.subtotalPerInstance, 0);
  assert.equal(sum, 100);
});

test('computeBundleComponentRatesSnapshot: rasio 1 (subtotal = harga katalog) -> snapshot = tarif katalog', () => {
  const days = 3;
  const standalone = computeItemRentalPrice(tenda, days); // 60000
  const snapshot = computeBundleComponentRatesSnapshot(tenda, 1, days, standalone);
  assert.equal(snapshot.price_per_day, tenda.price_per_day);
  assert.equal(snapshot.day2_rate, tenda.day2_rate);
});

test('computeBundleComponentRatesSnapshot: rasio 0.5 (paket separuh harga alat) -> semua tingkat dikali 0.5', () => {
  const days = 3;
  const standalone = computeItemRentalPrice(tenda, days); // 60000
  const snapshot = computeBundleComponentRatesSnapshot(tenda, 1, days, standalone / 2);
  assert.equal(snapshot.price_per_day, tenda.price_per_day / 2);
  assert.equal(snapshot.day3_rate, tenda.day3_rate / 2);
  // Reproduksi subtotal ASLI persis dari snapshot untuk N hari yang sama.
  const reproduced = computeBookingItemSubtotal(
    { quantity: 1, price_at_booking: snapshot.price_per_day, day2_rate_at_booking: snapshot.day2_rate, day3_rate_at_booking: snapshot.day3_rate, day4_rate_at_booking: snapshot.day4_rate, day5_rate_at_booking: snapshot.day5_rate, extra_day_rate_at_booking: snapshot.extra_day_rate },
    days,
  );
  assert.equal(reproduced, standalone / 2);
});

test('computeBundleComponentRatesSnapshot: katalog Rp0 (standalone 0) -> ratio fallback 0, tidak membagi dengan nol', () => {
  const free: ItemDayRates = { price_per_day: 0, day2_rate: 0, day3_rate: 0, day4_rate: 0, day5_rate: 0, extra_day_rate: 0 };
  const snapshot = computeBundleComponentRatesSnapshot(free, 1, 3, 10_000);
  assert.equal(snapshot.price_per_day, 0);
});

// Skenario WAJIB koordinator 15 Nov 2026 ("Alat Dalam Paket
// Dikurangi"): komponen paket dihapus/dikurangi -> total turun TEPAT
// sebesar porsi alokasi komponen itu, baris sisa TIDAK ikut berubah
// (tanpa redistribusi/selisih pembulatan liar).
test('komponen paket dihapus -> jumlah alokasi sisa + porsi yang dihapus = total paket awal (persis)', () => {
  const components: BundleComponent[] = [
    { item_id: 'tenda', quantityPerBundle: 1, catalogRates: tenda },
    { item_id: 'carrier', quantityPerBundle: 1, catalogRates: carrier },
    { item_id: 'headlamp', quantityPerBundle: 2, catalogRates: { price_per_day: 5_000, day2_rate: 5_000, day3_rate: 5_000, day4_rate: 5_000, day5_rate: 5_000, extra_day_rate: 5_000 } },
  ];
  const totalPaket = 123_457; // angka ganjil sengaja, supaya ada sisa pembulatan di alokasi awal
  const allocated = allocateBundlePrice(components, totalPaket, 3);
  const headlampShare = allocated.find((a) => a.item_id === 'headlamp')!.subtotalPerInstance;
  const remainingSum = allocated.filter((a) => a.item_id !== 'headlamp').reduce((s, a) => s + a.subtotalPerInstance, 0);
  // Headlamp dihapus (tidak disertakan sebagai baris) -> total baru =
  // remainingSum, dan remainingSum + headlampShare harus PERSIS totalPaket.
  assert.equal(remainingSum + headlampShare, totalPaket);
});

// Skenario WAJIB koordinator 16 Nov 2026 (perbaikan kolom Rupiah --
// `step` kelipatan sebelumnya menolak nominal sampai satuan, mis.
// Rp12.555): pastikan perhitungan turunan (total N hari, alokasi paket)
// tetap BULAT TANPA DESIMAL untuk nominal ganjil seperti ini -- tidak
// ada operasi di computeItemRentalPrice/allocateBundlePrice yang bisa
// menghasilkan desimal selama input sudah integer (cuma penjumlahan +
// Math.floor/Math.round), jadi ini murni tes regresi, bukan perbaikan.
test('tarif Rp12.555/hari (nominal satuan, bukan kelipatan ribuan) -- total 3 hari tetap bulat & tepat', () => {
  const rates: ItemDayRates = { price_per_day: 12_555, day2_rate: 12_555, day3_rate: 12_555, day4_rate: 12_555, day5_rate: 12_555, extra_day_rate: 12_555 };
  const total = computeItemRentalPrice(rates, 3);
  assert.equal(total, 37_665); // 12555 * 3, bulat, tanpa pembulatan/desimal
  assert.equal(Number.isInteger(total), true);
});

test('paket "harga sendiri" Rp12.555/hari + potongan -- alokasi ke komponen tetap bulat & jumlahnya persis total', () => {
  const tenda12555: ItemDayRates = { price_per_day: 12_555, day2_rate: 12_555, day3_rate: 12_555, day4_rate: 12_555, day5_rate: 12_555, extra_day_rate: 12_555 };
  const carrier9999: ItemDayRates = { price_per_day: 9_999, day2_rate: 9_999, day3_rate: 9_999, day4_rate: 9_999, day5_rate: 9_999, extra_day_rate: 9_999 };
  const components: BundleComponent[] = [
    { item_id: 'tenda', quantityPerBundle: 1, catalogRates: tenda12555 },
    { item_id: 'carrier', quantityPerBundle: 1, catalogRates: carrier9999 },
  ];
  // Paket "harga sendiri" Rp12.555/hari (independen dari katalog komponen) untuk 3 hari.
  const bundleOwnRates: ItemDayRates = { price_per_day: 12_555, day2_rate: 12_555, day3_rate: 12_555, day4_rate: 12_555, day5_rate: 12_555, extra_day_rate: 12_555 };
  const totalPaket = computeItemRentalPrice(bundleOwnRates, 3);
  assert.equal(totalPaket, 37_665);
  assert.equal(Number.isInteger(totalPaket), true);

  const allocated = allocateBundlePrice(components, totalPaket, 3);
  for (const a of allocated) assert.equal(Number.isInteger(a.subtotalPerInstance), true);
  const sum = allocated.reduce((s, a) => s + a.subtotalPerInstance, 0);
  assert.equal(sum, totalPaket); // alokasi = total persis, tanpa desimal/selisih
});

test('potongan nominal Rp12.555 pada mode ikuti_alat -- hasil tiap tingkat tetap bulat', () => {
  const tenda: ItemDayRates = { price_per_day: 50_000, day2_rate: 50_000, day3_rate: 50_000, day4_rate: 50_000, day5_rate: 50_000, extra_day_rate: 50_000 };
  const discounted = applyBundleDiscount(tenda, 'nominal', 12_555);
  assert.equal(discounted.price_per_day, 37_445); // 50000 - 12555, bulat
  assert.equal(Number.isInteger(discounted.price_per_day), true);
});

test('Perpanjang 1 hari pada paket "harga sendiri" -- tambahan proporsional harga paket, bukan harga katalog komponen', () => {
  // Skenario koordinator: paket harga sendiri Rp75rb/hari, komponen
  // (kalau disewa lepas) totalnya Rp120rb/hari -- rasio 75/120 = 0.625.
  const mahal: ItemDayRates = { price_per_day: 120_000, day2_rate: 120_000, day3_rate: 120_000, day4_rate: 120_000, day5_rate: 120_000, extra_day_rate: 120_000 };
  const days = 2;
  const bundleTotalPerDay = 75_000;
  const subtotalForDays = bundleTotalPerDay * days; // 150000, flat karena tarif katalog flat di skenario ini
  const snapshot = computeBundleComponentRatesSnapshot(mahal, 1, days, subtotalForDays);
  // Snapshot per hari harus 75000 (bukan 120000 katalog asli).
  assert.equal(snapshot.price_per_day, 75_000);
  assert.equal(snapshot.day2_rate, 75_000);
  // Perpanjang ke 3 hari -- subtotal baru pakai snapshot ini, harus 3x75000 = 225000, BUKAN lompat ke tarif katalog 120000/hari.
  const extended = computeBookingItemSubtotal(
    { quantity: 1, price_at_booking: snapshot.price_per_day, day2_rate_at_booking: snapshot.day2_rate, day3_rate_at_booking: snapshot.day3_rate, day4_rate_at_booking: snapshot.day4_rate, day5_rate_at_booking: snapshot.day5_rate, extra_day_rate_at_booking: snapshot.extra_day_rate },
    3,
  );
  assert.equal(extended, 225_000);
});

// Perbaikan pembulatan (koordinator 16 Nov 2026) -- tarif ganjil +
// potongan persen bisa desimal per tingkat; dibulatkan SEBELUM
// dijumlah untuk N hari, supaya total tetap konsisten dengan tarif
// per-hari yang ditampilkan, dan alokasi ke komponen tetap = total persis.
test('paket "ikuti_alat" + potongan 10% pada tarif ganjil -- tiap tingkat bulat, total bulat, alokasi = total persis', () => {
  const tenda37665: ItemDayRates = { price_per_day: 37_665, day2_rate: 37_665, day3_rate: 37_665, day4_rate: 37_665, day5_rate: 37_665, extra_day_rate: 37_665 };
  const carrier9999: ItemDayRates = { price_per_day: 9_999, day2_rate: 9_999, day3_rate: 9_999, day4_rate: 9_999, day5_rate: 9_999, extra_day_rate: 9_999 };
  const components: BundleComponent[] = [
    { item_id: 'tenda', quantityPerBundle: 1, catalogRates: tenda37665 },
    { item_id: 'carrier', quantityPerBundle: 1, catalogRates: carrier9999 },
  ];
  const combined = combinedComponentRates(components); // 47664/hari
  const discounted = applyBundleDiscount(combined, 'percent', 10);
  // 47664 * 0.9 = 42897.6 -> round 42898, bulat di setiap tingkat.
  assert.equal(discounted.price_per_day, 42_898);
  assert.equal(Number.isInteger(discounted.price_per_day), true);

  const days = 3;
  const totalPaket = computeItemRentalPrice(discounted, days);
  assert.equal(Number.isInteger(totalPaket), true);
  assert.equal(totalPaket, 42_898 * 3);

  const allocated = allocateBundlePrice(components, totalPaket, days);
  for (const a of allocated) assert.equal(Number.isInteger(a.subtotalPerInstance), true);
  const sum = allocated.reduce((s, a) => s + a.subtotalPerInstance, 0);
  assert.equal(sum, totalPaket); // alokasi = total persis
});

test('Perpanjang paket dari snapshot RASIO terskala (tarif ganjil) -- tetap bulat di hari tambahan', () => {
  // Komponen katalog tarif ganjil Rp37.665/hari, dialokasikan porsi
  // ganjil (bukan rasio bulat) -- snapshot *_at_booking hasil rasio
  // HARUS bulat (dibulatkan), dan subtotal utk hari tambahan (Perpanjang)
  // tetap bulat.
  const tenda37665: ItemDayRates = { price_per_day: 37_665, day2_rate: 37_665, day3_rate: 37_665, day4_rate: 37_665, day5_rate: 37_665, extra_day_rate: 37_665 };
  const days = 2;
  const standaloneTotal = 1 * computeItemRentalPrice(tenda37665, days); // 75330
  const subtotalAllocated = 42_017; // porsi ganjil sembarang (bukan kelipatan rapi dari standaloneTotal)
  const snapshot = computeBundleComponentRatesSnapshot(tenda37665, 1, days, subtotalAllocated);
  for (const key of ['price_per_day', 'day2_rate', 'day3_rate', 'day4_rate', 'day5_rate', 'extra_day_rate'] as const) {
    assert.equal(Number.isInteger(snapshot[key]), true, `${key} harus bulat`);
  }
  // Perpanjang ke 3 hari (1 hari tambahan) -- subtotal baru tetap bulat.
  const extended = computeBookingItemSubtotal(
    {
      quantity: 1,
      price_at_booking: snapshot.price_per_day,
      day2_rate_at_booking: snapshot.day2_rate,
      day3_rate_at_booking: snapshot.day3_rate,
      day4_rate_at_booking: snapshot.day4_rate,
      day5_rate_at_booking: snapshot.day5_rate,
      extra_day_rate_at_booking: snapshot.extra_day_rate,
    },
    3,
  );
  assert.equal(Number.isInteger(extended), true);
});
