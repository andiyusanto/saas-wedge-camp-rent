import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminBusinessesCsv } from '../adminCsv';
import type { AdminBusinessRow } from '../../hooks/useAdminBusinesses';

function buildRow(overrides: Partial<AdminBusinessRow> = {}): AdminBusinessRow {
  return {
    business_id: 'b1',
    name: 'Rental Contoh',
    owner_email: 'owner@example.com',
    active_until: '2027-01-30',
    plan: 'standar',
    status: 'aktif',
    signed_up_at: '2026-11-01T00:00:00Z',
    founder_override: null,
    founder_price_until: null,
    perkenalan_price_until: null,
    perkenalan_locked_forever: false,
    active_items_count: 5,
    txn_count_month: 3,
    txn_value_month: 150000,
    last_active_date: '2026-11-20',
    referred_by_name: null,
    ...overrides,
  };
}

test('kolom "Nilai transaksi" TIDAK ADA sama sekali di CSV kalau showTxnValue=false (embargo)', () => {
  const csv = buildAdminBusinessesCsv([buildRow()], false);
  assert.ok(!csv.includes('Nilai transaksi'));
  assert.ok(!csv.includes('150000'));
});

test('kolom "Nilai transaksi" muncul di header DAN baris kalau showTxnValue=true', () => {
  const csv = buildAdminBusinessesCsv([buildRow()], true);
  assert.ok(csv.includes('Nilai transaksi (bulan)'));
  assert.ok(csv.includes('150000'));
});

test('nama usaha dengan koma dikutip dengan benar (escape CSV)', () => {
  const csv = buildAdminBusinessesCsv([buildRow({ name: 'Rental, Alat Camping' })], false);
  assert.ok(csv.includes('"Rental, Alat Camping"'));
});

test('diajak oleh kosong tampil sebagai string kosong, bukan "null"', () => {
  const csv = buildAdminBusinessesCsv([buildRow({ referred_by_name: null })], false);
  assert.ok(!csv.includes('null'));
});
