// Unit test "layout model" Bagikan Nota (brief 24 Nov 2026, bagian B) --
// buildNotaImageLines() murni (tanpa canvas/DOM), isinya harus sama
// dengan aturan bisnis Nota A4 (InvoiceModal.tsx)/struk WA/struk thermal.
// Penggambaran canvas sungguhan (renderNotaImageCanvas) TIDAK diuji di
// sini -- butuh DOM, diverifikasi lewat Playwright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotaImageLines } from '../notaImage.js';
import { formatIDR } from '../formatters.js';
import type { ReceiptData, ReceiptItem } from '../formatters.js';

function item(overrides: Partial<ReceiptItem>): ReceiptItem {
  return {
    name: 'Tenda Dome',
    quantity: 1,
    price_per_day: 20_000,
    subtotal: 20_000,
    bundle_instance_id: null,
    bundle_name: null,
    bundle_quantity: null,
    ...overrides,
  };
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

function findText(lines: ReturnType<typeof buildNotaImageLines>['lines'], predicate: (l: any) => boolean) {
  return lines.find(predicate);
}

test('nota polos: tanpa paket/barang jual/denda/diskon -- bagian itu tidak muncul sama sekali (regresi)', () => {
  const { lines } = buildNotaImageLines(receipt({}));
  assert.ok(!lines.some((l) => l.kind === 'bundle-header'));
  assert.ok(!lines.some((l) => l.kind === 'fine-row'));
  assert.ok(!lines.some((l) => l.kind === 'deposit-block'));
  assert.ok(!lines.some((l) => l.kind === 'summary-row' && l.label.startsWith('Diskon')));
  assert.ok(!lines.some((l) => l.kind === 'table-header' && l.cols[0] === 'Barang Jual'));
  assert.ok(lines.some((l) => l.kind === 'item-row' && l.name === 'Tenda Dome'));
});

test('reprint: baris SALINAN muncul kalau isReprint true', () => {
  const withReprint = buildNotaImageLines(receipt({ isReprint: true, reprintedAt: '2026-11-24T00:00:00Z' }));
  assert.ok(withReprint.lines.some((l) => l.kind === 'reprint' && l.text.includes('SALINAN')));
  const without = buildNotaImageLines(receipt({}));
  assert.ok(!without.lines.some((l) => l.kind === 'reprint'));
});

test('paket: header "Paket {nama} xN" + komponen indent muncul', () => {
  const { lines } = buildNotaImageLines(
    receipt({
      items: [
        item({ name: 'Tenda Dome', quantity: 1, subtotal: 50_000, bundle_instance_id: 'i1', bundle_name: 'Tektok', bundle_quantity: 2 }),
        item({ name: 'Matras', quantity: 2, subtotal: 30_000, bundle_instance_id: 'i1', bundle_name: 'Tektok', bundle_quantity: 2 }),
      ],
    }),
  );
  assert.ok(lines.some((l) => l.kind === 'bundle-header' && l.text === 'Paket Tektok ×2'));
  const tenda = findText(lines, (l) => l.kind === 'item-row' && l.name === 'Tenda Dome');
  assert.equal((tenda as any)?.indent, true);
});

test('barang jual: tabel kedua muncul dengan subtotal flat (bukan tergantung hari)', () => {
  const { lines } = buildNotaImageLines(
    receipt({ saleItems: [{ name: 'Baterai AA', quantity: 2, unitPrice: 5_000, subtotal: 10_000 }] }),
  );
  assert.ok(lines.some((l) => l.kind === 'table-header' && l.cols[0] === 'Barang Jual'));
  assert.ok(lines.some((l) => l.kind === 'item-row' && l.name === 'Baterai AA' && l.subtotal === formatIDR(10_000)));
});

test('diskon: baris "Diskon {jenis} {persen}%: -Rp X" muncul cuma kalau discountAmount > 0', () => {
  const { lines } = buildNotaImageLines(
    receipt({ discountTypeName: 'Member', discountPercent: 10, discountAmount: 2_000 }),
  );
  const row = findText(lines, (l) => l.kind === 'summary-row' && l.label.startsWith('Diskon')) as any;
  assert.ok(row);
  assert.equal(row.label, 'Diskon Member 10%');
  assert.equal(row.value, '-' + formatIDR(2_000));
});

test('denda: Rincian Denda + Total Denda terpisah dari Total Tagihan', () => {
  const { lines } = buildNotaImageLines(
    receipt({
      fines: [
        { type: 'keterlambatan', amount: 15_000 },
        { type: 'kerusakan', amount: 30_000, item_name: 'Tenda Dome', description: 'Resleting rusak' },
      ],
    }),
  );
  assert.ok(lines.some((l) => l.kind === 'section-title' && l.text === 'Rincian Denda'));
  const kerusakan = findText(lines, (l) => l.kind === 'fine-row' && l.text.includes('Resleting rusak')) as any;
  assert.ok(kerusakan);
  assert.ok(kerusakan.text.includes('Tenda Dome'));
  const totalDenda = findText(lines, (l) => l.kind === 'summary-row' && l.label === 'Total Denda') as any;
  assert.equal(totalDenda.value, formatIDR(45_000));
  const totalTagihan = findText(lines, (l) => l.kind === 'summary-row' && l.label === 'Total Tagihan') as any;
  assert.equal(totalTagihan.value, formatIDR(65_000)); // 20.000 sewa + 45.000 denda
});

test('status LUNAS vs Sisa Tagihan vs Lebih Bayar', () => {
  const lunas = buildNotaImageLines(receipt({ totalPrice: 20_000, dpPaid: 20_000 }));
  assert.ok(lunas.lines.some((l) => l.kind === 'summary-row' && l.label === 'Status' && l.value === 'LUNAS'));

  const sisa = buildNotaImageLines(receipt({ totalPrice: 20_000, dpPaid: 5_000 }));
  assert.ok(sisa.lines.some((l) => l.kind === 'summary-row' && l.label === 'Sisa Tagihan' && l.value === formatIDR(15_000)));

  const lebih = buildNotaImageLines(receipt({ totalPrice: 20_000, dpPaid: 30_000 }));
  assert.ok(lebih.lines.some((l) => l.kind === 'summary-row' && l.label === 'Lebih Bayar' && l.value === formatIDR(10_000)));
});

test('jaminan: deposit-block muncul cuma kalau depositType diisi', () => {
  const withDeposit = buildNotaImageLines(receipt({ depositType: 'ktp', status: 'aktif', depositStatus: 'ditahan' }));
  const block = findText(withDeposit.lines, (l) => l.kind === 'deposit-block') as any;
  assert.ok(block);
  assert.ok(block.lines.some((l: string) => l.includes('Ditahan di Kasir')));

  const withoutDeposit = buildNotaImageLines(receipt({ depositType: null }));
  assert.ok(!withoutDeposit.lines.some((l) => l.kind === 'deposit-block'));
});

test('hasLogo mengikuti businessLogoUrl', () => {
  assert.equal(buildNotaImageLines(receipt({ businessLogoUrl: 'https://cdn.example/logo.png' })).hasLogo, true);
  assert.equal(buildNotaImageLines(receipt({ businessLogoUrl: null })).hasLogo, false);
});
