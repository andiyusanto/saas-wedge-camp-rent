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

test('generateWhatsAppReceipt: tanpa barang jual, Total Tagihan tetap tampil (sama dengan Total Harga Sewa kalau tanpa denda)', () => {
  // Revisi koordinator 17 Nov 2026: "Total Tagihan" SEKARANG SELALU
  // ditampilkan (bukan cuma saat ada barang jual) karena harus
  // mencerminkan sewa+barang+denda -- baris lama yang menegaskan "TIDAK
  // ADA Total Tagihan tanpa barang jual" sudah tidak berlaku lagi.
  const text = generateWhatsAppReceipt(receipt({ saleItems: [], totalPrice: 20_000 }));
  assert.doesNotMatch(text, /BARANG YANG DIBELI/);
  assert.match(text, /Total Harga Sewa.*Rp\s?20\.000/);
  assert.match(text, /Total Tagihan.*Rp\s?20\.000/);
});

test('generateWhatsAppReceipt: Total Tagihan termasuk denda, Rincian Denda muncul SEBELUM Total Tagihan, label Total Dibayar (bukan DP Terbayar)', () => {
  // Bug ditemukan dari Nota reprint Pelunasan (17 Nov 2026): sewa 45rb +
  // denda kerusakan 30rb, dibayar 75rb (DP 20rb + pelunasan 25rb + 30rb)
  // -- Total Tagihan SEBELUMNYA cuma 45rb (tidak termasuk denda), padahal
  // Sisa Tagihan di bawahnya sudah benar menghitung 45rb+30rb-75rb=0
  // (LUNAS) -- pelanggan bisa mengira dia lebih bayar karena 75rb > 45rb.
  const text = generateWhatsAppReceipt(
    receipt({
      items: [item({ subtotal: 45_000 })],
      totalPrice: 45_000,
      dpPaid: 75_000,
      fines: [{ type: 'kerusakan', amount: 30_000, description: 'Tiang patah', item_name: 'Tenda Dome' }],
    }),
  );
  assert.doesNotMatch(text, /DP Terbayar/);
  assert.match(text, /Total Dibayar.*Rp\s?75\.000/);
  assert.match(text, /Total Tagihan.*Rp\s?75\.000/); // 45.000 + 30.000
  assert.match(text, /LUNAS/);
  assert.doesNotMatch(text, /Lebih Bayar/);
  // Rincian Denda harus muncul SEBELUM Total Tagihan, bukan sesudahnya.
  const dendaIdx = text.indexOf('RINCIAN DENDA');
  const totalTagihanIdx = text.indexOf('Total Tagihan');
  assert.ok(dendaIdx >= 0 && dendaIdx < totalTagihanIdx, 'Rincian Denda harus muncul sebelum Total Tagihan');
});

test('generateWhatsAppReceipt: sewa+barang+denda digabung benar ke Total Tagihan', () => {
  const text = generateWhatsAppReceipt(
    receipt({
      items: [item({ subtotal: 20_000 })],
      saleItems: [{ name: 'Baterai AA', quantity: 2, unitPrice: 10_000, subtotal: 20_000 }],
      totalPrice: 40_000, // 20.000 sewa + 20.000 barang jual
      dpPaid: 0,
      fines: [{ type: 'keterlambatan', amount: 15_000, description: null, item_name: null }],
    }),
  );
  assert.match(text, /Total Harga Sewa.*Rp\s?20\.000/);
  assert.match(text, /Total Barang Jual.*Rp\s?20\.000/);
  assert.match(text, /Total Tagihan.*Rp\s?55\.000/); // 20.000 + 20.000 + 15.000
  assert.match(text, /Sisa Tagihan.*Rp\s?55\.000/);
});

// Rencana bayar (brief rencana-bayar-bebaskan-denda 24 Nov 2026).
test('generateWhatsAppReceipt: "Rencana bayar" tampil kalau diisi dan belum LUNAS', () => {
  const text = generateWhatsAppReceipt(
    receipt({
      items: [item({ subtotal: 20_000 })],
      totalPrice: 20_000,
      dpPaid: 0,
      paymentPlan: 'qris',
    }),
  );
  assert.match(text, /Rencana bayar: QRIS/);
});

test('generateWhatsAppReceipt: "Rencana bayar" TIDAK tampil kalau sudah LUNAS', () => {
  const text = generateWhatsAppReceipt(
    receipt({
      items: [item({ subtotal: 20_000 })],
      totalPrice: 20_000,
      dpPaid: 20_000,
      paymentPlan: 'qris',
    }),
  );
  assert.ok(!text.includes('Rencana bayar'));
});

test('generateWhatsAppReceipt: tanpa paymentPlan, baris "Rencana bayar" tidak muncul (regresi)', () => {
  const text = generateWhatsAppReceipt(receipt({ items: [item({ subtotal: 20_000 })], totalPrice: 20_000, dpPaid: 0 }));
  assert.ok(!text.includes('Rencana bayar'));
});
