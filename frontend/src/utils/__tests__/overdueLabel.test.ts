// Unit test label "Telat, N unit terkunci..." di kartu alat Kalender
// (Opsi B Tahap 2, tweak koordinator 17 Nov 2026) -- formatOverdueLabel().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatOverdueLabel } from '../formatters.js';

function booking(overrides: Partial<{ booking_number: string | null; customer_name: string | null; end_date: string; quantity: number }>) {
  return { booking_number: 'SWL-1', customer_name: 'Budi', end_date: '2026-11-10', quantity: 1, ...overrides };
}

test('formatOverdueLabel: N = jumlah quantity (bukan jumlah transaksi), satu nama', () => {
  const label = formatOverdueLabel([
    booking({ booking_number: 'SWL-1', customer_name: 'Bagus Setiawan', quantity: 2, end_date: '2026-11-10' }),
    booking({ booking_number: 'SWL-2', customer_name: 'Bagus Setiawan', quantity: 3, end_date: '2026-11-12' }), // nama sama, duplikat, cuma 1 entri di nama
  ]);
  assert.equal(label, 'Telat, 5 unit terkunci sampai dikembalikan · Bagus Setiawan');
});

test('formatOverdueLabel: 2 nama berbeda, diurutkan end_date paling lama dulu', () => {
  const label = formatOverdueLabel([
    booking({ booking_number: 'SWL-2', customer_name: 'Siti Rahma', quantity: 1, end_date: '2026-11-12' }),
    booking({ booking_number: 'SWL-1', customer_name: 'Bagus Setiawan', quantity: 1, end_date: '2026-11-08' }), // paling lama -> harus duluan
  ]);
  assert.equal(label, 'Telat, 2 unit terkunci sampai dikembalikan · Bagus Setiawan, Siti Rahma');
});

test('formatOverdueLabel: 3 nama -> dipotong jadi "A, B +1 lainnya"', () => {
  const label = formatOverdueLabel([
    booking({ booking_number: 'SWL-1', customer_name: 'Bagus Setiawan', quantity: 1, end_date: '2026-11-08' }),
    booking({ booking_number: 'SWL-2', customer_name: 'Siti Rahma', quantity: 1, end_date: '2026-11-10' }),
    booking({ booking_number: 'SWL-3', customer_name: 'Andi Wijaya', quantity: 1, end_date: '2026-11-12' }),
  ]);
  assert.equal(label, 'Telat, 3 unit terkunci sampai dikembalikan · Bagus Setiawan, Siti Rahma +1 lainnya');
});

test('formatOverdueLabel: 4 nama -> "+2 lainnya"', () => {
  const label = formatOverdueLabel([
    booking({ booking_number: 'SWL-1', customer_name: 'A', quantity: 1, end_date: '2026-11-05' }),
    booking({ booking_number: 'SWL-2', customer_name: 'B', quantity: 1, end_date: '2026-11-06' }),
    booking({ booking_number: 'SWL-3', customer_name: 'C', quantity: 1, end_date: '2026-11-07' }),
    booking({ booking_number: 'SWL-4', customer_name: 'D', quantity: 1, end_date: '2026-11-08' }),
  ]);
  assert.equal(label, 'Telat, 4 unit terkunci sampai dikembalikan · A, B +2 lainnya');
});

test('formatOverdueLabel: nama kosong fallback ke kode booking', () => {
  const label = formatOverdueLabel([booking({ booking_number: 'SWL-99', customer_name: null, quantity: 1, end_date: '2026-11-10' })]);
  assert.equal(label, 'Telat, 1 unit terkunci sampai dikembalikan · SWL-99');
});

test('formatOverdueLabel: nama kosong (string kosong/spasi) juga fallback ke kode booking', () => {
  const label = formatOverdueLabel([booking({ booking_number: 'SWL-5', customer_name: '   ', quantity: 1, end_date: '2026-11-10' })]);
  assert.equal(label, 'Telat, 1 unit terkunci sampai dikembalikan · SWL-5');
});
