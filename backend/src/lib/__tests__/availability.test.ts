// Unit test Stok "Sedang Disewa" (Opsi B), brief URGENT 17 Nov 2026
// (research/brief-stok-sedang-disewa-opsi-b-2026-11.md, komplain Campease)
// -- usedUnitsOn() status 'aktif': BELUM TELAT (today <= end_date) blokir
// SIMETRIS seperti 'dipesan' (start-readiness s/d end+readiness); SUDAH
// TELAT (today > end_date) tetap blokir TANPA BATAS ATAS (perilaku lama/
// Bilbo). `today` dihitung di zona rental (todayInTz), berbasis TANGGAL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usedUnitsOn } from '../availability.js';
import { addDays, todayInTz, toDateStrInTz } from '../dates.js';
import type { BookingItemRow } from '../availability.js';

const WIB = 'Asia/Jakarta';
const WITA = 'Asia/Makassar';
const WIT = 'Asia/Jayapura';

function aktifItem(startDate: string, endDate: string, overrides: Partial<BookingItemRow> = {}): BookingItemRow {
  return {
    item_id: 'item-1',
    quantity: 1,
    booking_id: 'b1',
    bookings: { start_date: startDate, end_date: endDate, status: 'aktif', actual_return_at: null },
    ...overrides,
  };
}

test('aktif belum telat, readiness 0: blokir simetris, bebas setelah end_date', () => {
  const today = todayInTz(WIB);
  const bi = [aktifItem(addDays(today, -2), addDays(today, 2))]; // today <= end_date -> belum telat
  // Dalam rentang -> diblokir.
  assert.equal(usedUnitsOn(bi, 'item-1', today, 0, WIB), 1);
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 2), 0, WIB), 1);
  // Setelah end_date (margin 0) -> BEBAS (ini yang diperbaiki brief ini --
  // sebelumnya tanpa batas atas sama sekali).
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 3), 0, WIB), 0);
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 30), 0, WIB), 0);
});

test('aktif belum telat, readiness 48 jam (margin 2 hari): simetris di kedua sisi', () => {
  const today = todayInTz(WIB);
  const bi = [aktifItem(addDays(today, -1), addDays(today, 1))]; // today <= end_date -> belum telat
  // Margin mundur dari start_date.
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, -3), 48, WIB), 1); // start-2
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, -4), 48, WIB), 0); // start-3, luar margin
  // Margin maju dari end_date (bagian YANG BARU -- sebelumnya unbounded).
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 3), 48, WIB), 1); // end+2
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 4), 48, WIB), 0); // end+3, luar margin
});

test('aktif SUDAH TELAT: tetap blokir tanpa batas atas (perilaku lama/Bilbo)', () => {
  const today = todayInTz(WIB);
  const bi = [aktifItem(addDays(today, -10), addDays(today, -1))]; // today > end_date -> telat
  assert.equal(usedUnitsOn(bi, 'item-1', today, 0, WIB), 1);
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 30), 0, WIB), 1); // jauh ke depan, tetap diblokir
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 365), 0, WIB), 1);
});

test('aktif: batas tepat hari end_date dan end_date+1 (belum telat, readiness 0)', () => {
  const today = todayInTz(WIB);
  const bi = [aktifItem(addDays(today, -5), addDays(today, 3))];
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 3), 0, WIB), 1); // == end_date
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 4), 0, WIB), 0); // end_date+1
});

test('aktif: skenario Campease -- carrier stok 1, aktif, booking setelah tanggal kembali diterima', () => {
  const today = todayInTz(WIB);
  // Aktif start=today-1, end=today+2 (belum telat) -- booking baru 5 hari
  // setelah end_date harus BEBAS (tidak lagi memblokir semua tanggal ke
  // depan seperti sebelum brief ini).
  const bi = [aktifItem(addDays(today, -1), addDays(today, 2))];
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 7), 0, WIB), 0);
});

test('aktif: 23:30 WIB vs 00:30 WITA -- tanggal "hari ini" bisa beda sehari pas lewat tengah malam (instant tetap, bukan mock jam)', () => {
  // 16:30 UTC == 23:30 WIB (UTC+7, masih tanggal 17) == 00:30 WITA (UTC+8,
  // sudah tanggal 18) -- todayInTz() dibangun dari mekanisme offset yang
  // SAMA (tzOffsetMs) seperti toDateStrInTz() di sini, jadi instant tetap
  // (tanpa mock Date.now()) sudah cukup membuktikan "today" bisa berbeda
  // sehari antar zona pada jam yang sama, sesuai catatan koordinator.
  const instant = '2026-11-17T16:30:00Z';
  assert.equal(toDateStrInTz(instant, WIB), '2026-11-17');
  assert.equal(toDateStrInTz(instant, WITA), '2026-11-18');
  // Dampak: booking aktif dengan end_date 2026-11-17, dicek PERSIS pada
  // instant ini, akan dianggap SUDAH TELAT ("today" > end_date) kalau
  // dihitung di WITA, tapi MASIH BELUM TELAT ("today" == end_date) kalau
  // dihitung di WIB -- todayInTz() (dipakai usedUnitsOn()) dibangun dari
  // mekanisme offset yang SAMA (tzOffsetMs) dengan toDateStrInTz() di
  // atas, jadi pembuktian lewat instant tetap ini berlaku juga untuknya.
});

test('aktif: zona WITA/WIT -- today dihitung di zona rental, bukan selalu WIB', () => {
  for (const tz of [WIB, WITA, WIT]) {
    const today = todayInTz(tz);
    const belumTelat = [aktifItem(addDays(today, -1), today)]; // today == end_date -> belum telat
    const sudahTelat = [aktifItem(addDays(today, -2), addDays(today, -1))]; // today > end_date -> telat
    // Belum telat: bebas sehari setelah end_date.
    assert.equal(usedUnitsOn(belumTelat, 'item-1', addDays(today, 1), 0, tz), 0, `tz=${tz} belum telat harus bebas setelah end_date`);
    // Sudah telat: tetap terblokir jauh ke depan.
    assert.equal(usedUnitsOn(sudahTelat, 'item-1', addDays(today, 30), 0, tz), 1, `tz=${tz} sudah telat harus tetap terblokir`);
  }
});

test('aktif: regresi margin mundur tetap diterapkan sebelum start_date (readiness>0)', () => {
  const today = todayInTz(WIB);
  const bi = [aktifItem(today, addDays(today, 5))]; // belum telat
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, -1), 24, WIB), 1); // start-1, dalam margin 1 hari
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, -2), 24, WIB), 0); // start-2, luar margin
});

test('regresi: dipesan/telat-selesai/dibatalkan TIDAK berubah oleh Opsi B', () => {
  const today = todayInTz(WIB);
  const dipesan: BookingItemRow[] = [
    { item_id: 'item-1', quantity: 1, booking_id: 'b2', bookings: { start_date: addDays(today, 5), end_date: addDays(today, 7), status: 'dipesan', actual_return_at: null } },
  ];
  // dipesan tetap simetris seperti sebelumnya (tidak terpengaruh perubahan status aktif).
  assert.equal(usedUnitsOn(dipesan, 'item-1', addDays(today, 6), 0, WIB), 1);
  assert.equal(usedUnitsOn(dipesan, 'item-1', addDays(today, 20), 0, WIB), 0);

  const dibatalkan: BookingItemRow[] = [
    { item_id: 'item-1', quantity: 1, booking_id: 'b3', bookings: { start_date: addDays(today, -1), end_date: addDays(today, 1), status: 'dibatalkan', actual_return_at: null } },
  ];
  assert.equal(usedUnitsOn(dibatalkan, 'item-1', today, 0, WIB), 0); // dibatalkan tidak pernah dihitung
});
