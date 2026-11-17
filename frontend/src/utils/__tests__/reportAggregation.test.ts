// Unit test Laporan (Riwayat Transaksi -> tab "Laporan", brief 16 Nov
// 2026). buildMonthlyReport/buildPerAlatReport/clipOccupiedDaysToPeriod
// diuji murni (tanpa Supabase/React) -- fixture HistoryBooking minimal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyReport, buildCashReceivedByMonth, buildPerAlatReport, buildBarangJualReport, clipOccupiedDaysToPeriod } from '../reportAggregation.js';
import type { HistoryBooking, HistoryBookingItem, HistorySaleItem } from '../../hooks/useHistory.js';

function item(overrides: Partial<HistoryBookingItem>): HistoryBookingItem {
  return {
    item_id: 'item-a',
    name: 'Tenda Dome',
    category: null,
    variant: null,
    size: null,
    color: null,
    quantity: 1,
    subtotal: null,
    price_at_booking: 10_000,
    bundle_id: null,
    bundle_instance_id: null,
    bundle_name: null,
    total_units: 5,
    ...overrides,
  };
}

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
    items: [item({})],
    saleItems: [],
    penalties: [],
    payments: [],
    rental_day_mode: 'per_hari_kalender',
    ...overrides,
  };
}

function saleItem(overrides: Partial<HistorySaleItem>): HistorySaleItem {
  return { sale_item_id: 'baterai', name: 'Baterai AA', quantity: 1, price_at_booking: 10_000, subtotal: 10_000, ...overrides };
}

test('buildMonthlyReport: status batal TIDAK dihitung (caller harus filter sebelum memanggil)', () => {
  const bookings = [
    booking({ id: 'b1', start_date: '2026-03-05', total_price: 100_000, dp_paid: 100_000 }),
    booking({ id: 'b2', start_date: '2026-03-10', total_price: 999_999, status: 'dibatalkan' }),
  ];
  // Pola sama computeHistorySummary -- fungsi TIDAK menyaring status,
  // caller yang filter. Di sini sengaja TIDAK difilter dulu untuk
  // membuktikan: kalau caller lupa filter, booking batal IKUT
  // terhitung (bukti fungsi murni ikut apa adanya) -- jadi caller WAJIB
  // filter, seperti yang akan dilakukan LaporanScreen.tsx.
  const withoutFilter = buildMonthlyReport(bookings, new Map());
  assert.equal(withoutFilter[2].pendapatanSewa, 100_000 + 999_999); // bulan 3 (index 2) -- bukti TANPA filter ikut salah

  const filtered = buildMonthlyReport(bookings.filter((b) => b.status !== 'dibatalkan'), new Map());
  assert.equal(filtered[2].pendapatanSewa, 100_000); // dengan filter -- benar
  assert.equal(filtered[2].jumlahTransaksi, 1);
});

test('buildMonthlyReport: denda telat dan kerusakan/hilang dipisah, totalPemasukan = sewa + keduanya', () => {
  const bookings = [
    booking({
      start_date: '2026-05-01',
      total_price: 50_000,
      penalties: [
        { type: 'keterlambatan', amount: 20_000, item_id: null },
        { type: 'kerusakan', amount: 15_000, item_id: 'item-a' },
        { type: 'kehilangan', amount: 5_000, item_id: 'item-a' },
      ],
    }),
  ];
  const [row] = [buildMonthlyReport(bookings, new Map())[4]];
  assert.equal(row.dendaTelat, 20_000);
  assert.equal(row.dendaKerusakan, 20_000); // kerusakan + kehilangan
  assert.equal(row.totalPemasukan, 50_000 + 20_000 + 20_000);
});

test('buildMonthlyReport: Januari tidak ada pembanding (null), bulan lain dihitung vs bulan sebelumnya', () => {
  const bookings = [
    booking({ id: 'jan', start_date: '2026-01-05', total_price: 100_000 }),
    booking({ id: 'feb', start_date: '2026-02-05', total_price: 150_000 }),
  ];
  const rows = buildMonthlyReport(bookings, new Map());
  assert.equal(rows[0].perubahanPersenVsBulanLalu, null); // Januari
  assert.equal(rows[1].perubahanPersenVsBulanLalu, 50); // (150000-100000)/100000*100
});

test('buildMonthlyReport: rataRata null kalau jumlahTransaksi 0, bukan NaN/Infinity', () => {
  const rows = buildMonthlyReport([], new Map());
  for (const row of rows) {
    assert.equal(row.jumlahTransaksi, 0);
    assert.equal(row.rataRata, null);
  }
});

test('clipOccupiedDaysToPeriod: booking SEPENUHNYA di dalam periode -> hari penuh', () => {
  assert.equal(clipOccupiedDaysToPeriod('2026-03-10', '2026-03-12', '2026-03-01', '2026-03-31'), 3);
});

test('clipOccupiedDaysToPeriod: booking melintasi AWAL periode -- cuma hari di dalam periode dihitung', () => {
  // Booking 28 Feb - 3 Mar, periode Maret (1-31) -- cuma 1,2,3 Mar = 3 hari.
  assert.equal(clipOccupiedDaysToPeriod('2026-02-28', '2026-03-03', '2026-03-01', '2026-03-31'), 3);
});

test('clipOccupiedDaysToPeriod: booking melintasi AKHIR periode -- cuma hari di dalam periode dihitung', () => {
  // Booking 30 Mar - 2 Apr, periode Maret -- cuma 30,31 Mar = 2 hari.
  assert.equal(clipOccupiedDaysToPeriod('2026-03-30', '2026-04-02', '2026-03-01', '2026-03-31'), 2);
});

test('clipOccupiedDaysToPeriod: booking SELURUHNYA di luar periode -> 0', () => {
  assert.equal(clipOccupiedDaysToPeriod('2026-01-01', '2026-01-05', '2026-03-01', '2026-03-31'), 0);
});

test('buildPerAlatReport: keterpakaian dipotong ke periode -- tidak pernah >100%, booking melintasi batas dihitung benar', () => {
  // Alat total_units=2. Booking melintasi SELURUH Februari (28 hari di
  // 2026, bukan kabisat) dari 1 Jan s/d 28 Feb, quantity 2 -- kalau TIDAK
  // dipotong ke periode Februari saja, unit-hari mentahnya (59 hari x 2)
  // akan menghasilkan keterpakaian jauh di atas 100%. Dengan pemotongan,
  // yang dihitung cuma hari di dalam Februari (28 hari) x 2 unit = 56
  // unit-hari, dari denominator (2 unit x 28 hari periode) = 56 ->
  // keterpakaian PERSIS 100%, bukan lebih.
  const b = booking({
    id: 'melintasi',
    start_date: '2026-01-01',
    end_date: '2026-02-28',
    items: [item({ item_id: 'item-a', quantity: 2, total_units: 2 })],
  });
  const activeItems = [{ id: 'item-a', name: 'Tenda Dome', total_units: 2, category: null }];
  const result = buildPerAlatReport([b], activeItems, '2026-02-01', '2026-02-28');
  assert.equal(result.periodDaysCount, 28);
  const row = result.rows.find((r) => r.itemId === 'item-a')!;
  assert.equal(row.keterpakaianPersen, 100);
});

test('buildPerAlatReport: fallback subtotal null -> price_at_booking x quantity x hari, pola InvoiceModal', () => {
  const b = booking({
    start_date: '2026-04-01',
    end_date: '2026-04-03',
    rental_day_mode: 'per_hari_kalender', // 3 hari inklusif
    items: [item({ item_id: 'item-a', quantity: 2, price_at_booking: 10_000, subtotal: null })],
  });
  const activeItems = [{ id: 'item-a', name: 'Tenda Dome', total_units: 5, category: null }];
  const result = buildPerAlatReport([b], activeItems, '2026-04-01', '2026-04-30');
  const row = result.rows.find((r) => r.itemId === 'item-a')!;
  assert.equal(row.pendapatan, 10_000 * 2 * 3); // 60000
});

test('buildPerAlatReport: baris komponen paket memakai subtotal teralokasi (bukan harga katalog)', () => {
  const b = booking({
    start_date: '2026-06-01',
    end_date: '2026-06-02',
    items: [
      item({ item_id: 'tenda', quantity: 1, subtotal: 27_000, bundle_id: 'bundle-1', bundle_instance_id: 'inst-1', bundle_name: 'Tektok' }),
      item({ item_id: 'carrier', quantity: 1, subtotal: 31_500, price_at_booking: 35_000, bundle_id: 'bundle-1', bundle_instance_id: 'inst-1', bundle_name: 'Tektok' }),
    ],
  });
  const activeItems = [
    { id: 'tenda', name: 'Tenda Dome', total_units: 5, category: null },
    { id: 'carrier', name: 'Carrier', total_units: 5, category: null },
  ];
  const result = buildPerAlatReport([b], activeItems, '2026-06-01', '2026-06-30');
  const tendaRow = result.rows.find((r) => r.itemId === 'tenda')!;
  const carrierRow = result.rows.find((r) => r.itemId === 'carrier')!;
  assert.equal(tendaRow.pendapatan, 27_000); // porsi paket, BUKAN harga katalog
  assert.equal(carrierRow.pendapatan, 31_500); // porsi paket, BUKAN 35000 katalog

  assert.equal(result.bundleSummary.length, 1);
  assert.equal(result.bundleSummary[0].bundleName, 'Tektok');
  assert.equal(result.bundleSummary[0].jumlahKaliDipilih, 1);
  assert.equal(result.bundleSummary[0].pendapatan, 27_000 + 31_500);
});

test('buildPerAlatReport: alat aktif yang tidak pernah disewa di periode ikut dilaporkan', () => {
  const b = booking({ items: [item({ item_id: 'item-a' })] });
  const activeItems = [
    { id: 'item-a', name: 'Disewa', total_units: 5, category: null },
    { id: 'item-b', name: 'Tidak Pernah Disewa', total_units: 3, category: null },
  ];
  const result = buildPerAlatReport([b], activeItems, '2026-01-01', '2026-01-31');
  assert.equal(result.itemsNeverRented.length, 1);
  assert.equal(result.itemsNeverRented[0].id, 'item-b');
});

// Kolom Kategori di Laporan per Alat (brief 17 Nov 2026).

test('buildPerAlatReport: category diambil dari katalog alat aktif', () => {
  const b = booking({ items: [item({ item_id: 'item-a' })] });
  const activeItems = [{ id: 'item-a', name: 'Tenda Dome', total_units: 5, category: 'Tenda' }];
  const result = buildPerAlatReport([b], activeItems, '2026-01-01', '2026-01-31');
  assert.equal(result.rows[0].category, 'Tenda');
});

test('buildPerAlatReport: category fallback "Lainnya" kalau null di katalog', () => {
  const b = booking({ items: [item({ item_id: 'item-a' })] });
  const activeItems = [{ id: 'item-a', name: 'Tenda Dome', total_units: 5, category: null }];
  const result = buildPerAlatReport([b], activeItems, '2026-01-01', '2026-01-31');
  assert.equal(result.rows[0].category, 'Lainnya');
});

// Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066).

test('buildMonthlyReport: pendapatanBarangJual dipisah, pendapatanSewa dibalik dari total_price (bukan dijumlah dobel)', () => {
  const b = booking({
    start_date: '2026-03-05',
    end_date: '2026-03-06',
    total_price: 30_000, // sewa 10.000 (item default) + barang jual 20.000
    saleItems: [saleItem({ subtotal: 20_000 })],
  });
  const rows = buildMonthlyReport([b], new Map());
  const march = rows.find((r) => r.month === 3)!;
  assert.equal(march.pendapatanBarangJual, 20_000);
  assert.equal(march.pendapatanSewa, 10_000); // 30.000 - 20.000
  assert.equal(march.totalPemasukan, 30_000); // rumus TIDAK berubah
});

test('buildMonthlyReport: tanpa barang jual, pendapatanSewa = total_price PERSIS seperti sebelum fitur ini (regresi)', () => {
  const b = booking({ start_date: '2026-04-05', end_date: '2026-04-06', total_price: 50_000, saleItems: [] });
  const rows = buildMonthlyReport([b], new Map());
  const april = rows.find((r) => r.month === 4)!;
  assert.equal(april.pendapatanSewa, 50_000);
  assert.equal(april.pendapatanBarangJual, 0);
  assert.equal(april.totalPemasukan, 50_000);
});

test('buildBarangJualReport: jumlah terjual + pendapatan digabung per sale_item_id lintas transaksi', () => {
  const b1 = booking({ id: 'b1', start_date: '2026-05-01', saleItems: [saleItem({ sale_item_id: 'baterai', quantity: 2, subtotal: 20_000 })] });
  const b2 = booking({ id: 'b2', start_date: '2026-05-10', saleItems: [saleItem({ sale_item_id: 'baterai', quantity: 1, subtotal: 10_000 })] });
  const rows = buildBarangJualReport([b1, b2], '2026-05-01', '2026-05-31');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].jumlahTransaksi, 2);
  assert.equal(rows[0].jumlahTerjual, 3);
  assert.equal(rows[0].pendapatan, 30_000);
});

test('buildBarangJualReport: booking di luar periode tidak ikut dihitung', () => {
  const inPeriod = booking({ id: 'b1', start_date: '2026-06-10', saleItems: [saleItem({ subtotal: 10_000 })] });
  const outOfPeriod = booking({ id: 'b2', start_date: '2026-07-01', saleItems: [saleItem({ subtotal: 999_000 })] });
  const rows = buildBarangJualReport([inPeriod, outOfPeriod], '2026-06-01', '2026-06-30');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pendapatan, 10_000);
});

test('buildBarangJualReport: tanpa barang jual sama sekali -> array kosong', () => {
  const b = booking({ saleItems: [] });
  const rows = buildBarangJualReport([b], '2026-01-01', '2026-01-31');
  assert.deepEqual(rows, []);
});

test('buildCashReceivedByMonth: dikelompokkan per bulan paid_at, bukan start_date booking manapun', () => {
  const byMonth = buildCashReceivedByMonth([
    { amount: 50_000, paid_at: '2026-11-20T10:00:00Z' },
    { amount: 25_000, paid_at: '2026-11-25T10:00:00Z' },
    { amount: 100_000, paid_at: '2026-12-02T10:00:00Z' },
  ]);
  assert.equal(byMonth.get(11), 75_000);
  assert.equal(byMonth.get(12), 100_000);
  assert.equal(byMonth.get(1), undefined);
});

test('buildCashReceivedByMonth: refund/koreksi (amount negatif) menetralkan di bulan yang sama', () => {
  const byMonth = buildCashReceivedByMonth([
    { amount: 50_000, paid_at: '2026-11-20T10:00:00Z' },
    { amount: -50_000, paid_at: '2026-11-21T10:00:00Z' },
  ]);
  assert.equal(byMonth.get(11), 0);
});

test('buildMonthlyReport: uangDiterima dari payments terpisah -- DP Desember untuk booking Januari tahun DEPAN tetap terhitung di Desember (lintas tahun)', () => {
  // Booking yang start_date-nya TAHUN DEPAN tidak ada di dataset `bookings`
  // tahun ini sama sekali (difilter caller di LaporanScreen.tsx) -- tapi
  // DP-nya yang dibayar BULAN INI (Desember tahun ini) tetap harus masuk
  // "Uang Diterima" Desember, karena paymentsInYear di-fetch TERPISAH
  // berdasarkan paid_at, bukan ikut filter start_date booking.
  const cashByMonth = buildCashReceivedByMonth([{ amount: 75_000, paid_at: '2026-12-15T10:00:00Z' }]);
  const rows = buildMonthlyReport([], cashByMonth);
  assert.equal(rows[11].uangDiterima, 75_000);
  assert.equal(rows[11].jumlahTransaksi, 0); // booking-nya sendiri tidak ada di tahun ini
});
