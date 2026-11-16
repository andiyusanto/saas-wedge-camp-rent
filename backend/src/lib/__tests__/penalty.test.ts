// Unit test batas jam kembali TETAP (migration 062, brief 14 Nov 2026) —
// computeDueAt() dengan returnDeadlineTime/returnDeadlineNextDay. Juga
// Cara hitung denda telat (migration 063, brief 15 Nov 2026) di bagian
// bawah file ini.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDueAt,
  computeLateFee,
  computeTieredLateFee,
  computeFullDayLateFee,
  computeFullDayLateFeeFlat,
  computeHourlyLateFee,
  fullDayLateDays,
} from '../penalty.js';
import type { ItemDayRates } from '../pricing.js';

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

// ============================================================
// Cara hitung denda telat (migration 063, brief 15 Nov 2026)
// ============================================================

test('fullDayLateDays: lewat toleransi 1 menit pun sudah 1 hari, tanpa setengah hari', () => {
  assert.equal(fullDayLateDays(0.5 / 60, 0), 1); // 30 detik lewat -> tetap 1 hari (ceil)
  assert.equal(fullDayLateDays(24, 0), 1); // persis 24 jam -> 1 hari
  assert.equal(fullDayLateDays(24.01, 0), 2); // sedikit lewat 24 jam -> 2 hari
  assert.equal(fullDayLateDays(5, 10), 0); // masih di dalam toleransi -> 0
  // Review -c2 (15 Nov 2026) poin batas tambahan -- dicek ulang eksplisit
  // setelah verifikasi live sempat diragukan (tapi ternyata TIDAK ada bug,
  // cuma salah tebak manual di laporan sebelumnya -- lihat catatan di
  // commit): 72,5 jam -> ceil(72.5/24) = ceil(3.0208) = 4 hari, BUKAN 3.
  assert.equal(fullDayLateDays(72.5, 0), 4);
  assert.equal(fullDayLateDays(72, 0), 3); // persis 72 jam (kelipatan genap) -> 3 hari, tanpa dibulatkan naik
});

test('computeFullDayLateFeeFlat: 2 hari telat x tarif flat', () => {
  // Telat 30 jam, toleransi 0 -> ceil(30/24) = 2 hari.
  assert.equal(computeFullDayLateFeeFlat(30, 0, 30000), 60000);
});

test('computeFullDayLateFee (tiered): 2 hari telat, marginal dari computeItemRentalPrice', () => {
  const rates: ItemDayRates = {
    price_per_day: 30000,
    day2_rate: 30000,
    day3_rate: 30000,
    day4_rate: 30000,
    day5_rate: 30000,
    extra_day_rate: 30000,
  };
  // rentDuration 2 hari, telat 30 jam toleransi 0 -> lateDays 2 -> harga(4)-harga(2) = 60000.
  assert.equal(computeFullDayLateFee(30, 0, 2, rates), 60000);
});

test('computeFullDayLateFee: regresi angka live yang sempat diragukan (-c2 15 Nov 2026) -- Tenda Dome 4 Orang', () => {
  // Tarif asli demo: 30rb/20rb/10rb/10rb/10rb (hari 1-5), ekstra 10rb.
  // rentDuration 1 hari (1 malam), telat ~48,0003 jam (verifikasi live:
  // booking sungguhan toleransi 0) -> lateDays = ceil(48.0003/24) = 3
  // (BUKAN 2) -> harga(1+3=4) - harga(1) = (30000+20000+10000+10000) -
  // 30000 = 40000. Nilai ini SAMA PERSIS dengan suggested_late_fee yang
  // dikembalikan GET /trackings pada verifikasi live -- bukti TIDAK ADA
  // off-by-one, cuma salah tebak manual ("3 hari" vs sebenarnya 4 hari
  // untuk kasus telat ~72-73 jam) di laporan verifikasi sebelumnya.
  const tendaDomeRates: ItemDayRates = {
    price_per_day: 30000,
    day2_rate: 20000,
    day3_rate: 10000,
    day4_rate: 10000,
    day5_rate: 10000,
    extra_day_rate: 10000,
  };
  assert.equal(fullDayLateDays(48.0003, 0), 3);
  assert.equal(computeFullDayLateFeeFlat(48.0003, 0, 30000), 3 * 30000); // untuk pembanding tarif FLAT
  assert.equal(computeFullDayLateFee(48.0003, 0, 1, tendaDomeRates), 40000); // tarif bertingkat sungguhan

  // Kasus ~72-73 jam dari verifikasi sebelumnya -> lateDays 4 (bukan 3) ->
  // harga(1+4=5) - harga(1) = 80000 - 30000 = 50000.
  assert.equal(fullDayLateDays(72.03, 0), 4);
  assert.equal(computeFullDayLateFee(72.03, 0, 1, tendaDomeRates), 50000);
});

test('computeHourlyLateFee: batas atas AKTIF -> tidak lebih mahal dari "per hari penuh" (contoh brief)', () => {
  // Tenda Dome Rp30rb/hari flat, 2 hari, telat 30 jam toleransi 0,
  // Rp10rb/jam -> raw 300rb, cap (= per hari penuh) 60rb -> hasil 60rb.
  const fullDayFeeTotal = computeFullDayLateFeeFlat(30, 0, 30000);
  const result = computeHourlyLateFee(30, 0, 10000, true, fullDayFeeTotal);
  assert.equal(fullDayFeeTotal, 60000);
  assert.equal(result.hours, 30);
  assert.equal(result.cap, 60000);
  assert.equal(result.capped, true);
  assert.equal(result.fee, 60000); // BUKAN 300.000 -- dibatasi setara per hari penuh
  assert.equal(result.needsManualInput, false);
});

test('computeHourlyLateFee: batas atas DIMATIKAN -> nominal penuh tanpa pembanding', () => {
  const fullDayFeeTotal = computeFullDayLateFeeFlat(30, 0, 30000);
  const result = computeHourlyLateFee(30, 0, 10000, false, fullDayFeeTotal);
  assert.equal(result.fee, 300000);
  assert.equal(result.cap, null);
  assert.equal(result.capped, false);
});

test('computeHourlyLateFee: perHourRate null/0 (seharusnya tidak pernah terjadi, snapshot lama tidak konsisten) -> aman, saran 0 + needsManualInput', () => {
  const resultNull = computeHourlyLateFee(30, 0, null, true, 60000);
  assert.equal(resultNull.fee, 0);
  assert.equal(resultNull.needsManualInput, true);

  const resultZero = computeHourlyLateFee(30, 0, 0, true, 60000);
  assert.equal(resultZero.fee, 0);
  assert.equal(resultZero.needsManualInput, true);
});

test('computeHourlyLateFee: belum telat (di dalam toleransi) -> 0, TIDAK minta isi manual walau perHourRate null', () => {
  const result = computeHourlyLateFee(5, 10, null, true, 0);
  assert.equal(result.hours, 0);
  assert.equal(result.fee, 0);
  assert.equal(result.needsManualInput, false);
});

test('regresi: mode bertahap_12jam (computeLateFee/computeTieredLateFee) TIDAK disentuh oleh fitur mode baru', () => {
  // Sekadar bukti functions lama masih diekspor & berperilaku sama --
  // computeFullDayLateFee/Flat adalah fungsi BARU terpisah, bukan
  // pengganti, lihat lib/penalty.ts.
  assert.equal(computeLateFee(13, 11, 100000), 0.5 * 100000 * Math.ceil((13 - 11) / 12));
  const rates: ItemDayRates = {
    price_per_day: 100000,
    day2_rate: 0,
    day3_rate: 0,
    day4_rate: 0,
    day5_rate: 20000,
    extra_day_rate: 20000,
  };
  assert.equal(typeof computeTieredLateFee(30, 0, 4, rates), 'number');
});

// Perbaikan pembulatan (koordinator 16 Nov 2026) -- tarif ganjil (bukan
// kelipatan ribuan, baru mungkin terjadi sejak step HTML dihapus di
// kolom Rupiah, 16 Nov 2026) × blok setengah hari (BLOCK_RATE 0.5) bisa
// desimal -- dibulatkan ke rupiah terdekat di titik akhir.
test('computeLateFee: tarif ganjil Rp37.665, telat 6 jam (1 blok/setengah hari) -> dibulatkan ke rupiah terdekat', () => {
  // Tanpa pembulatan: 1 blok x 0.5 x 37665 = 18832.5 -> round ke 18833.
  assert.equal(computeLateFee(6, 0, 37_665), 18_833);
  assert.equal(Number.isInteger(computeLateFee(6, 0, 37_665)), true);
});

test('computeTieredLateFee: marginal ganjil pada setengah blok -> dibulatkan ke rupiah terdekat', () => {
  const rates: ItemDayRates = {
    price_per_day: 37_665,
    day2_rate: 37_665,
    day3_rate: 37_665,
    day4_rate: 37_665,
    day5_rate: 37_665,
    extra_day_rate: 37_665,
  };
  // telat 6 jam toleransi 0 -> 1 blok -> setengah hari -> marginal hari
  // ke-(rentDuration+1) = 37665, fee = round(0.5 * 37665) = 18833.
  const fee = computeTieredLateFee(6, 0, 1, rates);
  assert.equal(fee, 18_833);
  assert.equal(Number.isInteger(fee), true);
});
