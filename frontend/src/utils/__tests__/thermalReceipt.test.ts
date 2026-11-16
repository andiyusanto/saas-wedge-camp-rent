// Unit test struk thermal (Cetak Printer Thermal v1, brief 16 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildThermalReceiptDoc, buildThermalTestReceipt, columnsForPaperWidth } from '../thermalReceipt.js';
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

for (const width of [58, 80] as const) {
  test(`buildThermalReceiptDoc(${width}mm) tiap baris tidak melebihi kolom`, () => {
    const cols = columnsForPaperWidth(width);
    const doc = buildThermalReceiptDoc(
      receipt({
        items: [
          item({ name: 'Tenda Dome Kapasitas 4 Orang Waterproof Edisi Spesial', quantity: 2, subtotal: 100_000 }),
        ],
      }),
      width,
    );
    for (const line of doc.textLines) {
      assert.ok(line.length <= cols, `baris "${line}" (${line.length}) melebihi ${cols} kolom`);
    }
  });
}

test('nama alat panjang dibungkus, bukan terpotong diam-diam', () => {
  const doc = buildThermalReceiptDoc(
    receipt({ items: [item({ name: 'Kompor Lapangan Portable Multifungsi Tahan Angin', quantity: 1, subtotal: 15_000 })] }),
    58,
  );
  const joined = doc.textLines.join(' ');
  assert.ok(joined.includes('Kompor'));
  assert.ok(joined.includes('Angin'));
});

test('Paket ditampilkan sebagai grup "Paket X ×N" + rincian komponen', () => {
  const doc = buildThermalReceiptDoc(
    receipt({
      items: [
        item({ name: 'Tenda', bundle_instance_id: 'inst1', bundle_name: 'Tektok', bundle_quantity: 2, subtotal: 30_000 }),
        item({ name: 'Matras', bundle_instance_id: 'inst1', bundle_name: 'Tektok', bundle_quantity: 2, subtotal: 10_000 }),
      ],
    }),
    58,
  );
  const joined = doc.textLines.join('\n');
  assert.match(joined, /Paket Tektok x2/);
  assert.match(joined, /Tenda/);
  assert.match(joined, /Matras/);
});

test('denda keterlambatan dan kerusakan/kehilangan dipisah dengan nama alat', () => {
  const doc = buildThermalReceiptDoc(
    receipt({
      fines: [
        { type: 'keterlambatan', amount: 15_000, description: 'Telat 1 hari', item_name: null },
        { type: 'kerusakan', amount: 25_000, description: 'Tiang patah', item_name: 'Tenda Dome' },
      ],
    }),
    58,
  );
  const joined = doc.textLines.join(' ');
  assert.match(joined, /Telat 1 hari/);
  assert.match(joined, /Tenda Dome/);
  assert.match(joined, /Total Denda/);
});

test('jaminan "Rencana saat ambil" untuk booking Siap Diambil (dipesan)', () => {
  const doc = buildThermalReceiptDoc(
    receipt({ status: 'dipesan', depositType: 'ktp', depositNote: null, depositStatus: 'ditahan' }),
    58,
  );
  assert.match(doc.textLines.join('\n'), /Akan Diminta Saat Ambil/);
});

test('jaminan "Ditahan di Kasir" untuk booking yang sudah diambil', () => {
  const doc = buildThermalReceiptDoc(receipt({ status: 'aktif', depositType: 'ktp', depositStatus: 'ditahan' }), 58);
  assert.match(doc.textLines.join('\n'), /Ditahan di Kasir/);
});

test('"Kembali paling lambat" tampil kalau diisi, tidak tampil kalau kosong', () => {
  const withDeadline = buildThermalReceiptDoc(
    receipt({ returnDeadlineTime: '22:00', returnDeadlineNextDay: false }),
    58,
  );
  assert.match(withDeadline.textLines.join('\n'), /Plg lambat/);

  const withoutDeadline = buildThermalReceiptDoc(receipt({ returnDeadlineTime: null }), 58);
  assert.doesNotMatch(withoutDeadline.textLines.join('\n'), /Plg lambat/);
});

test('rupiah dibulatkan tanpa desimal di baris harga', () => {
  const doc = buildThermalReceiptDoc(receipt({ items: [item({ subtotal: 12_555 })] }), 58);
  assert.doesNotMatch(doc.textLines.join('\n'), /,\d/);
});

test('transaksi tanpa denda dan tanpa jaminan tidak menampilkan bagian itu', () => {
  const doc = buildThermalReceiptDoc(receipt({ fines: [], depositType: null }), 58);
  const joined = doc.textLines.join('\n');
  assert.doesNotMatch(joined, /RINCIAN DENDA/);
  assert.doesNotMatch(joined, /JAMINAN SEWA/);
});

test('karakter non-ASCII pada nama disanitasi (tidak ada byte di luar ASCII)', () => {
  const doc = buildThermalReceiptDoc(receipt({ items: [item({ name: 'Tenda “Dome” – Édisi' })] }), 58);
  for (const line of doc.textLines) {
    for (const ch of line) {
      assert.ok(ch.charCodeAt(0) <= 0x7e, `karakter non-ASCII lolos: ${ch}`);
    }
  }
});

test('Barang Jual: ditampilkan terpisah dari alat sewa, dengan rincian sewa+barang+total tagihan', () => {
  const doc = buildThermalReceiptDoc(
    receipt({
      items: [item({ subtotal: 20_000 })],
      saleItems: [{ name: 'Baterai AA', quantity: 2, unitPrice: 10_000, subtotal: 20_000 }],
      totalPrice: 40_000,
    }),
    58,
  );
  const joined = doc.textLines.join(' ');
  assert.match(joined, /BARANG JUAL/);
  assert.match(joined, /Baterai AA/);
  assert.match(joined, /Total Sewa/);
  assert.match(joined, /Total Barang Jual/);
  assert.match(joined, /Total Tagihan/);
});

test('Barang Jual kosong: struk thermal PERSIS seperti sebelum fitur ini ada (regresi)', () => {
  const doc = buildThermalReceiptDoc(receipt({ saleItems: [] }), 58);
  const joined = doc.textLines.join(' ');
  assert.doesNotMatch(joined, /BARANG JUAL/);
  assert.doesNotMatch(joined, /Total Tagihan/);
  assert.match(joined, /Total Sewa/);
});

test('buildThermalTestReceipt menghasilkan struk tes ringkas', () => {
  const doc = buildThermalTestReceipt('Sewalog Demo', 58, '16 Nov 2026');
  const joined = doc.textLines.join('\n');
  assert.match(joined, /Printer siap dipakai/);
  assert.match(joined, /Sewalog/);
  for (const line of doc.textLines) assert.ok(line.length <= 32);
});
