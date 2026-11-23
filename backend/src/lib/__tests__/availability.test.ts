// Unit test Stok "Sedang Disewa" (Opsi B), brief URGENT 17 Nov 2026
// (research/brief-stok-sedang-disewa-opsi-b-2026-11.md, komplain Campease)
// -- usedUnitsOn() status 'aktif': BELUM TELAT (today <= end_date) blokir
// SIMETRIS seperti 'dipesan' (start-readiness s/d end+readiness); SUDAH
// TELAT (today > end_date) tetap blokir TANPA BATAS ATAS (perilaku lama/
// Bilbo). `today` dihitung di zona rental (todayInTz), berbasis TANGGAL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usedUnitsOn, isBookingOverdue } from '../availability.js';
import { addDays, todayInTz, toDateStrInTz } from '../dates.js';
import type { BookingItemRow } from '../availability.js';

const WIB = 'Asia/Jakarta';
const WITA = 'Asia/Makassar';
const WIT = 'Asia/Jayapura';

function aktifItem(
  startDate: string,
  endDate: string,
  overrides: Partial<BookingItemRow> = {},
  pickedUpAt: string | null = null,
): BookingItemRow {
  return {
    item_id: 'item-1',
    quantity: 1,
    booking_id: 'b1',
    bookings: { start_date: startDate, end_date: endDate, status: 'aktif', actual_return_at: null, picked_up_at: pickedUpAt },
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

test('isBookingOverdue: penentuan telat berbasis tanggal, dipakai tanda "terkunci" di Kalender (Opsi B Tahap 2)', () => {
  assert.equal(isBookingOverdue('2026-11-17', '2026-11-16'), false); // today sebelum end_date
  assert.equal(isBookingOverdue('2026-11-17', '2026-11-17'), false); // today == end_date -> belum telat
  assert.equal(isBookingOverdue('2026-11-17', '2026-11-18'), true); // today setelah end_date -> telat
  // Zona rental: instant yang sama bisa beda "today" antar zona (sama
  // pembuktian offset seperti tes WIB/WITA di atas).
  const instant = '2026-11-17T16:30:00Z';
  const todayWib = toDateStrInTz(instant, WIB);
  const todayWita = toDateStrInTz(instant, WITA);
  assert.equal(isBookingOverdue('2026-11-17', todayWib), false); // WIB: masih 17, belum telat
  assert.equal(isBookingOverdue('2026-11-17', todayWita), true); // WITA: sudah 18, telat
});

test('regresi: dipesan/telat-selesai/dibatalkan TIDAK berubah oleh Opsi B', () => {
  const today = todayInTz(WIB);
  const dipesan: BookingItemRow[] = [
    { item_id: 'item-1', quantity: 1, booking_id: 'b2', bookings: { start_date: addDays(today, 5), end_date: addDays(today, 7), status: 'dipesan', actual_return_at: null, picked_up_at: null } },
  ];
  // dipesan tetap simetris seperti sebelumnya (tidak terpengaruh perubahan status aktif).
  assert.equal(usedUnitsOn(dipesan, 'item-1', addDays(today, 6), 0, WIB), 1);
  assert.equal(usedUnitsOn(dipesan, 'item-1', addDays(today, 20), 0, WIB), 0);

  const dibatalkan: BookingItemRow[] = [
    { item_id: 'item-1', quantity: 1, booking_id: 'b3', bookings: { start_date: addDays(today, -1), end_date: addDays(today, 1), status: 'dibatalkan', actual_return_at: null, picked_up_at: null } },
  ];
  assert.equal(usedUnitsOn(dibatalkan, 'item-1', today, 0, WIB), 0); // dibatalkan tidak pernah dihitung
});

// ============================================================
// Mulai Sewa + ambil lebih awal (brief 23 Nov 2026, migration 072) --
// 'aktif' dengan picked_up_at LEBIH AWAL dari start_date -- batas bawah
// blokir ikut mundur ke least(start_date, tanggal picked_up_at).
// ============================================================

test('ambil lebih awal 1 hari, readiness 0: hari H-1 (malam diambil) ikut terblokir', () => {
  const today = todayInTz(WIB);
  const start = addDays(today, 1); // start_date BESOK
  const end = addDays(today, 3);
  const bi = [aktifItem(start, end, {}, `${today}T13:00:00.000Z`)]; // diambil HARI INI (H-1 dari start)
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, -1), 0, WIB), 0); // sebelum hari diambil -> bebas
  assert.equal(usedUnitsOn(bi, 'item-1', today, 0, WIB), 1); // hari diambil (H-1 start) -> terblokir
  assert.equal(usedUnitsOn(bi, 'item-1', start, 0, WIB), 1); // start_date sendiri -> tetap terblokir
});

test('ambil lebih awal 2 hari, readiness 0: dua malam sebelum start_date ikut terblokir', () => {
  const today = todayInTz(WIB);
  const start = addDays(today, 2); // start_date LUSA
  const end = addDays(today, 4);
  const bi = [aktifItem(start, end, {}, `${today}T13:00:00.000Z`)]; // diambil HARI INI (H-2 dari start)
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, -1), 0, WIB), 0); // sebelum hari diambil -> bebas
  assert.equal(usedUnitsOn(bi, 'item-1', today, 0, WIB), 1); // hari diambil -> terblokir
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, 1), 0, WIB), 1); // di antara ambil dan start -> terblokir
  assert.equal(usedUnitsOn(bi, 'item-1', start, 0, WIB), 1); // start_date -> terblokir
});

test('ambil lebih awal + readiness 25 jam (margin 2 hari): margin mundur dihitung dari TANGGAL AMBIL, bukan start_date', () => {
  const today = todayInTz(WIB);
  const start = addDays(today, 3);
  const end = addDays(today, 5);
  const bi = [aktifItem(start, end, {}, `${today}T13:00:00.000Z`)]; // diambil hari ini, H-3 dari start
  // Batas bawah = least(start, tanggal ambil) - margin(2) = today - 2.
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, -2), 25, WIB), 1); // today-2, dalam margin
  assert.equal(usedUnitsOn(bi, 'item-1', addDays(today, -3), 25, WIB), 0); // today-3, luar margin
  assert.equal(usedUnitsOn(bi, 'item-1', today, 25, WIB), 1); // hari ambil sendiri
});

test('ambil lebih awal dekat tengah malam zona WITA: tanggal ambil dihitung di zona rental, bukan UTC', () => {
  // picked_up_at 23:30 WITA (15:30 UTC) tanggal 16 Nov -- di UTC murni ini
  // masih tanggal 16, tapi WITA (UTC+8) sudah masuk tanggal 17 kalau
  // offsetnya lebih dari 30 menit... pilih instant yang benar-benar
  // melewati tengah malam WITA: 16:30 UTC tanggal 16 = 00:30 WITA
  // tanggal 17.
  const pickedUpAtUtc = '2026-11-16T16:30:00.000Z'; // 00:30 WITA tgl 17
  const start = '2026-11-19';
  const end = '2026-11-20';
  const bi = [aktifItem(start, end, {}, pickedUpAtUtc)];
  // Tanggal ambil di WITA = 2026-11-17 (BUKAN 2026-11-16, kalau salah
  // dihitung di UTC).
  assert.equal(usedUnitsOn(bi, 'item-1', '2026-11-16', 0, WITA), 0); // sebelum tanggal ambil WITA -> bebas
  assert.equal(usedUnitsOn(bi, 'item-1', '2026-11-17', 0, WITA), 1); // tanggal ambil WITA -> terblokir
});

test('diambil TEPAT di start_date atau TELAT -> least() jatuh balik ke start_date, regresi identik', () => {
  const today = todayInTz(WIB);
  const start = addDays(today, -2);
  const end = addDays(today, 2);
  // Diambil TEPAT start_date -> sama seperti tanpa picked_up_at sama sekali.
  const tepatWaktu = [aktifItem(start, end, {}, `${start}T03:00:00.000Z`)];
  const tanpaPickup = [aktifItem(start, end)];
  for (const d of [addDays(start, -1), start, addDays(start, 1), end, addDays(end, 1)]) {
    assert.equal(
      usedUnitsOn(tepatWaktu, 'item-1', d, 0, WIB),
      usedUnitsOn(tanpaPickup, 'item-1', d, 0, WIB),
      `diambil tepat start_date harus identik regresi untuk tanggal ${d}`,
    );
  }
  // Diambil TELAT (picked_up_at > start_date) -> least() tetap start_date,
  // tidak pernah MEMPERSEMPIT blokir.
  const diambilTelat = [aktifItem(start, end, {}, `${addDays(start, 1)}T03:00:00.000Z`)];
  assert.equal(usedUnitsOn(diambilTelat, 'item-1', start, 0, WIB), 1); // start_date tetap terblokir
});
