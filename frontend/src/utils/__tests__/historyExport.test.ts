// Unit test Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration
// 066) -- computeHistorySummary() ikut menjumlahkan pendapatanBarangJual
// TERPISAH dari omset (omset = Σ total_price, yang SUDAH gabungan sewa+
// barang jual sejak fitur ini -- tidak dijumlah dobel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHistorySummary } from '../historyExport.js';
import type { HistoryBooking } from '../../hooks/useHistory.js';

function booking(overrides: Partial<HistoryBooking>): HistoryBooking {
  return {
    id: 'b1',
    booking_number: 'SWL-1',
    status: 'selesai',
    start_date: '2026-01-10',
    end_date: '2026-01-11',
    total_price: 10_000,
    dp_paid: 10_000,
    customer: null,
    items: [],
    saleItems: [],
    penalties: [],
    rental_day_mode: 'per_hari_kalender',
    ...overrides,
  };
}

test('computeHistorySummary: pendapatanBarangJual dijumlah terpisah, omset TIDAK dobel-hitung', () => {
  const b = booking({
    total_price: 30_000,
    saleItems: [{ sale_item_id: 'baterai', name: 'Baterai AA', quantity: 2, price_at_booking: 10_000, subtotal: 20_000 }],
  });
  const summary = computeHistorySummary([b]);
  assert.equal(summary.omset, 30_000);
  assert.equal(summary.pendapatanBarangJual, 20_000);
});

test('computeHistorySummary: tanpa barang jual, pendapatanBarangJual=0 (regresi)', () => {
  const b = booking({ total_price: 30_000, saleItems: [] });
  const summary = computeHistorySummary([b]);
  assert.equal(summary.pendapatanBarangJual, 0);
  assert.equal(summary.omset, 30_000);
});
