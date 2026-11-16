// Unit test Barang Jual (habis pakai), v1 (brief 16 Nov 2026) --
// generateWhatsAppReceipt() menampilkan "Barang Jual" terpisah dari
// alat sewa, dan transaksi tanpa barang jual tetap PERSIS seperti
// sebelum fitur ini ada (regresi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWhatsAppReceipt } from '../formatters.js';
import type { ReceiptData, ReceiptItem } from '../formatters.js';

function item(overrides: Partial<ReceiptItem>): ReceiptItem {
  return { name: 'Tenda Dome', quantity: 1, price_per_day: 20_000, subtotal: 20_000, ...overrides };
}

function receipt(overrides: Partial<ReceiptData>): ReceiptData {
  return {
    bookingNumber: 'SWL-001',
    customerName: 'Budi',
    customerPhone: '081234567890',
    startDate: '2026-11-20',
    endDate: '2026-11-21',
    items: [item({})],
    saleItems: [],
    totalPrice: 20_000,
    dpPaid: 10_000,
    depositType: null,
    depositNote: null,
    depositStatus: null,
    status: 'aktif',
    fines: [],
    businessName: 'Sewalog Demo',
    businessAddress: 'Jl. Contoh No. 1',
    businessLogoUrl: null,
    rentalDayMode: 'per_hari_kalender',
    returnDeadlineTime: null,
    returnDeadlineNextDay: null,
    ...overrides,
  };
}

test('generateWhatsAppReceipt: barang jual tampil terpisah, total sewa+barang+tagihan benar', () => {
  const text = generateWhatsAppReceipt(
    receipt({
      items: [item({ subtotal: 20_000 })],
      saleItems: [
        { name: 'Baterai AA', quantity: 2, unitPrice: 10_000, subtotal: 20_000 },
        { name: 'Jas Hujan Plastik', quantity: 1, unitPrice: 15_000, subtotal: 15_000 },
      ],
      totalPrice: 55_000,
    }),
  );
  assert.match(text, /BARANG YANG DIBELI/);
  assert.match(text, /Baterai AA/);
  assert.match(text, /Jas Hujan Plastik/);
  assert.match(text, /Total Harga Sewa.*Rp\s?20\.000/);
  assert.match(text, /Total Barang Jual.*Rp\s?35\.000/);
  assert.match(text, /Total Tagihan.*Rp\s?55\.000/);
});

test('generateWhatsAppReceipt: tanpa barang jual, struk PERSIS seperti sebelum fitur ini ada (regresi)', () => {
  const text = generateWhatsAppReceipt(receipt({ saleItems: [], totalPrice: 20_000 }));
  assert.doesNotMatch(text, /BARANG YANG DIBELI/);
  assert.doesNotMatch(text, /Total Tagihan/);
  assert.match(text, /Total Harga Sewa.*Rp\s?20\.000/);
});
