import type { HistoryBooking } from '../hooks/useHistory';
import { rentalDays, computeRemainingBalance } from './formatters';
import { itemSubtotal, bookingPenaltyByType } from './historyExport';

// Laporan (Riwayat Transaksi -> tab "Laporan", brief 16 Nov 2026,
// research/brief-laporan-pemasukan-per-alat-2026-11.md). Fungsi murni
// (tidak menyentuh Supabase/React) supaya bisa diuji lewat `npm test`
// tanpa browser -- lihat __tests__/reportAggregation.test.ts.
//
// Dipanggil HANYA dengan booking yang SUDAH dikecualikan status
// 'dibatalkan' oleh caller (pola sama `computeHistorySummary`,
// historyExport.ts) -- fungsi di sini tidak menyaring status apa pun.

// ----------------------------------------------------------------
// Bagian A: Pemasukan per bulan
// ----------------------------------------------------------------

export type MonthlyReportRow = {
  month: number; // 1-12
  pendapatanSewa: number;
  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
  // dipisah dari pendapatanSewa (yang DIBALIK dari b.total_price dikurangi
  // ini, bukan dijumlah dobel -- lihat buildMonthlyReport di bawah).
  // totalPemasukan TIDAK berubah rumusnya sama sekali (regresi aman).
  pendapatanBarangJual: number;
  dendaTelat: number;
  dendaKerusakan: number;
  totalPemasukan: number;
  sudahDiterima: number;
  piutang: number;
  // Pelunasan (brief 17 Nov 2026) -- NILAI KAS, dikelompokkan per bulan
  // `paid_at` (kapan uang BENAR-BENAR masuk), BUKAN bulan start_date
  // seperti baris lain di tabel ini (nilai transaksi). Dua basis ini
  // SENGAJA beda dan tidak harus sama jumlahnya per bulan -- lihat
  // disclaimer baru di LaporanScreen.tsx.
  uangDiterima: number;
  jumlahTransaksi: number;
  rataRata: number | null; // null kalau jumlahTransaksi 0
  // null = tidak ada pembanding (Januari -- bulan sebelumnya di luar
  // tahun yang dipilih, brief minta "pilih tahun" per-tahun, bukan
  // lintas tahun; lihat catatan UI LaporanScreen.tsx).
  perubahanPersenVsBulanLalu: number | null;
};

// "Uang Diterima" per bulan `paid_at` (brief Pelunasan 17 Nov 2026, revisi
// koordinator 17 Nov 2026) -- `payments` HARUS datang dari fetch
// TERPISAH (`fetchPaymentsInYear()`, useHistory.ts), difilter `paid_at`
// dalam TAHUN yang dipilih secara LANGSUNG -- BUKAN diturunkan dari
// `HistoryBooking.payments` pada booking yang sudah difilter per tahun
// lewat `start_date` (pendekatan SEBELUMNYA, salah: DP yang dibayar di
// tahun N untuk booking yang start_date-nya tahun N+1 -- kasus UMUM di
// akhir tahun, bukan langka -- akan hilang karena bookingnya sendiri
// tidak masuk hitungan tahun N). Baris refund/koreksi (amount negatif)
// ikut dijumlah apa adanya, tanpa filter status booking apa pun -- sudah
// benar secara aritmatika (refund pada booking dibatalkan menetralkan
// payment aslinya di bulan yang sama).
export function buildCashReceivedByMonth(paymentsInYear: { amount: number; paid_at: string }[]): Map<number, number> {
  const byMonth = new Map<number, number>();
  for (const p of paymentsInYear) {
    const month = Number(p.paid_at.slice(5, 7));
    byMonth.set(month, (byMonth.get(month) ?? 0) + p.amount);
  }
  return byMonth;
}

// bookings SUDAH difilter oleh caller ke tahun yang dipilih (start_date
// diawali `${year}-`) DAN dikecualikan 'dibatalkan' -- fungsi ini cuma
// mengelompokkan per bulan dari `start_date`, konsisten Riwayat.
// `uangDiterimaByMonth` dari `buildCashReceivedByMonth()` di atas.
export function buildMonthlyReport(
  bookingsInYearExcludingCancelled: HistoryBooking[],
  uangDiterimaByMonth: Map<number, number>,
): MonthlyReportRow[] {
  const byMonth = new Map<number, HistoryBooking[]>();
  for (const b of bookingsInYearExcludingCancelled) {
    const month = Number(b.start_date.slice(5, 7));
    const list = byMonth.get(month) ?? [];
    list.push(b);
    byMonth.set(month, list);
  }

  const rows: MonthlyReportRow[] = [];
  let prevTotalPemasukan: number | null = null;

  for (let month = 1; month <= 12; month++) {
    const bookings = byMonth.get(month) ?? [];
    let pendapatanSewa = 0;
    let pendapatanBarangJual = 0;
    let sudahDiterima = 0;
    let piutang = 0;
    let dendaTelat = 0;
    let dendaKerusakan = 0;

    for (const b of bookings) {
      // b.total_price adalah gabungan sewa+barang jual sejak Barang Jual
      // v1 -- pendapatanSewa DIBALIK (dikurangi porsi barang jual), BUKAN
      // dijumlah dobel, supaya totalPemasukan di bawah rumusnya TIDAK
      // berubah sama sekali (rental tanpa barang jual: saleTotal=0,
      // pendapatanSewa=b.total_price PERSIS seperti sebelum fitur ini).
      const saleTotal = b.saleItems.reduce((sum, s) => sum + s.subtotal, 0);
      pendapatanSewa += b.total_price - saleTotal;
      pendapatanBarangJual += saleTotal;
      sudahDiterima += b.dp_paid;
      // Pelunasan (brief 17 Nov 2026) -- piutang SEKARANG termasuk denda
      // (computeRemainingBalance), di-clamp 0 PER TRANSAKSI (keputusan
      // koordinator 17 Nov 2026).
      const bookingFinesTotal = b.penalties.reduce((sum, p) => sum + p.amount, 0);
      piutang += Math.max(0, computeRemainingBalance(b.total_price, bookingFinesTotal, b.dp_paid));
      dendaTelat += bookingPenaltyByType(b, 'keterlambatan');
      dendaKerusakan += bookingPenaltyByType(b, 'kerusakan-kehilangan');
    }

    const totalPemasukan = pendapatanSewa + pendapatanBarangJual + dendaTelat + dendaKerusakan;
    const jumlahTransaksi = bookings.length;
    const rataRata = jumlahTransaksi > 0 ? totalPemasukan / jumlahTransaksi : null;

    // Januari (month===1): tidak ada pembanding dalam tahun yang sama --
    // prevTotalPemasukan masih null dari inisialisasi di atas.
    const perubahanPersenVsBulanLalu =
      prevTotalPemasukan == null ? null : prevTotalPemasukan === 0 ? null : ((totalPemasukan - prevTotalPemasukan) / prevTotalPemasukan) * 100;

    rows.push({
      month,
      pendapatanSewa,
      pendapatanBarangJual,
      dendaTelat,
      dendaKerusakan,
      totalPemasukan,
      sudahDiterima,
      piutang,
      uangDiterima: uangDiterimaByMonth.get(month) ?? 0,
      jumlahTransaksi,
      rataRata,
      perubahanPersenVsBulanLalu,
    });

    prevTotalPemasukan = totalPemasukan;
  }

  return rows;
}

// ----------------------------------------------------------------
// Bagian B: Laporan per alat (+ ringkasan per paket)
// ----------------------------------------------------------------

// Perbandingan string tanggal ISO (YYYY-MM-DD) BOLEH leksikografis --
// urutannya sama persis dengan urutan kronologis untuk format ini,
// tidak perlu parse ke Date untuk sekadar membandingkan.
function laterDateStr(a: string, b: string): string {
  return a > b ? a : b;
}
function earlierDateStr(a: string, b: string): string {
  return a < b ? a : b;
}

function daysBetweenInclusive(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

// Keterpakaian harus dipotong ke periode (koordinator 16 Nov 2026) --
// booking yang mulai SEBELUM periode tapi masih berlangsung, atau
// berakhir SESUDAH periode, cuma menyumbang hari yang jatuh DI DALAM
// periode -- supaya keterpakaian tidak pernah >100% dan tidak dobel
// dihitung di bulan/periode lain. "Hari terpakai" = hari KALENDER dari
// tanggal ambil s/d tanggal kembali, INKLUSIF kedua ujungnya -- pola
// SAMA dengan Kalender Ketersediaan (strip per hari kalender, bukan
// per-malam/per jam -- CLAUDE.md bagian 4 & 6, `usedUnitsOn()` juga
// memblokir hari kembali itu sendiri sebagai hari terpakai).
export function clipOccupiedDaysToPeriod(
  bookingStartDate: string,
  bookingEndDate: string,
  periodStart: string,
  periodEnd: string,
): number {
  const clippedStart = laterDateStr(bookingStartDate, periodStart);
  const clippedEnd = earlierDateStr(bookingEndDate, periodEnd);
  if (clippedStart > clippedEnd) return 0;
  return daysBetweenInclusive(clippedStart, clippedEnd);
}

export type ActiveItemRef = { id: string; name: string; total_units: number; category: string | null };

export type PerAlatReportRow = {
  itemId: string;
  name: string;
  category: string; // brief 17 Nov 2026, sama fallback dengan "Peralatan Terlaris Disewa" (HistoryScreen) -- null/kosong -> "Lainnya"
  jumlahTransaksi: number;
  totalUnitHari: number; // TIDAK dipotong -- booking yang MULAI di periode (konsisten sheet "Per Alat" Riwayat yang sudah ada)
  pendapatan: number; // Σ subtotal baris, booking yang MULAI di periode -- BISA beda dari total_price transaksi kalau vendor override manual (lihat catatan UI)
  keterpakaianPersen: number; // dari unit-hari TERPOTONG ke periode, basis total_units SAAT INI
};

export type BundleSummaryRow = {
  bundleName: string;
  jumlahKaliDipilih: number; // distinct bundle_instance_id, booking yang MULAI di periode
  pendapatan: number;
};

export type PerAlatReportResult = {
  rows: PerAlatReportRow[];
  itemsNeverRented: ActiveItemRef[];
  bundleSummary: BundleSummaryRow[];
  periodDaysCount: number;
};

// `bookingsOverlap`: SEMUA booking yang rentangnya bersinggungan dengan
// [periodStart,periodEnd] (fetchHistoryBookings mode 'overlap'), SUDAH
// dikecualikan 'dibatalkan' oleh caller -- dipakai KHUSUS basis
// keterpakaian (perlu tahu booking yang melintasi batas periode).
// `activeItems`: daftar alat AKTIF dari katalog (useItems()) -- dasar
// "alat tidak pernah disewa" dan total_units pembagi keterpakaian.
export function buildPerAlatReport(
  bookingsOverlapExcludingCancelled: HistoryBooking[],
  activeItems: ActiveItemRef[],
  periodStart: string,
  periodEnd: string,
): PerAlatReportResult {
  const periodDaysCount = daysBetweenInclusive(periodStart, periodEnd);

  // Subset "mulai di periode" -- basis jumlahTransaksi/pendapatan/
  // totalUnitHari (tidak terpotong), konsisten semantik Riwayat/sheet
  // "Per Alat" yang sudah ada (Σ total_price Laporan Bulanan ikut basis
  // yang sama).
  const startedInPeriod = bookingsOverlapExcludingCancelled.filter(
    (b) => b.start_date >= periodStart && b.start_date <= periodEnd,
  );

  type Agg = { name: string; category: string; bookingIds: Set<string>; totalUnitHari: number; pendapatan: number; unitHariClipped: number };
  const byItemId = new Map<string, Agg>();
  const totalUnitsByItemId = new Map<string, number>();
  const categoryByItemId = new Map<string, string>();
  for (const item of activeItems) {
    totalUnitsByItemId.set(item.id, item.total_units);
    categoryByItemId.set(item.id, item.category ?? 'Lainnya');
  }

  for (const b of startedInPeriod) {
    const days = rentalDays(b.start_date, b.end_date, b.rental_day_mode);
    for (const item of b.items) {
      if (!item.item_id) continue;
      const agg = byItemId.get(item.item_id) ?? {
        name: item.name,
        category: categoryByItemId.get(item.item_id) ?? item.category ?? 'Lainnya',
        bookingIds: new Set(),
        totalUnitHari: 0,
        pendapatan: 0,
        unitHariClipped: 0,
      };
      agg.bookingIds.add(b.id);
      agg.totalUnitHari += item.quantity * days;
      agg.pendapatan += itemSubtotal(item, days);
      byItemId.set(item.item_id, agg);
    }
  }

  // Keterpakaian dari SELURUH booking yang bersinggungan (bukan cuma
  // startedInPeriod) -- clip ke periode per booking.
  for (const b of bookingsOverlapExcludingCancelled) {
    const clippedDays = clipOccupiedDaysToPeriod(b.start_date, b.end_date, periodStart, periodEnd);
    if (clippedDays <= 0) continue;
    for (const item of b.items) {
      if (!item.item_id) continue;
      const agg = byItemId.get(item.item_id) ?? {
        name: item.name,
        category: categoryByItemId.get(item.item_id) ?? item.category ?? 'Lainnya',
        bookingIds: new Set(),
        totalUnitHari: 0,
        pendapatan: 0,
        unitHariClipped: 0,
      };
      agg.unitHariClipped += item.quantity * clippedDays;
      byItemId.set(item.item_id, agg);
    }
  }

  const rows: PerAlatReportRow[] = [...byItemId.entries()].map(([itemId, agg]) => {
    const totalUnits = totalUnitsByItemId.get(itemId) ?? 0;
    const denominator = totalUnits * periodDaysCount;
    const keterpakaianPersen = denominator > 0 ? (agg.unitHariClipped / denominator) * 100 : 0;
    return {
      itemId,
      name: agg.name,
      category: agg.category,
      jumlahTransaksi: agg.bookingIds.size,
      totalUnitHari: agg.totalUnitHari,
      pendapatan: agg.pendapatan,
      keterpakaianPersen,
    };
  });
  rows.sort((a, b) => b.pendapatan - a.pendapatan);

  const rentedItemIds = new Set(byItemId.keys());
  const itemsNeverRented = activeItems.filter((i) => !rentedItemIds.has(i.id));

  // Ringkasan per paket -- basis startedInPeriod juga (sama alasan
  // pendapatan/jumlahTransaksi di atas: "berapa kali dipilih" adalah
  // metrik transaksi, bukan keterpakaian).
  const bundleMap = new Map<string, { bundleName: string; instanceIds: Set<string>; pendapatan: number }>();
  for (const b of startedInPeriod) {
    for (const item of b.items) {
      if (!item.bundle_instance_id || !item.bundle_name) continue;
      const key = item.bundle_name;
      const agg = bundleMap.get(key) ?? { bundleName: item.bundle_name, instanceIds: new Set(), pendapatan: 0 };
      agg.instanceIds.add(item.bundle_instance_id);
      agg.pendapatan += item.subtotal ?? 0;
      bundleMap.set(key, agg);
    }
  }
  const bundleSummary: BundleSummaryRow[] = [...bundleMap.values()]
    .map((agg) => ({ bundleName: agg.bundleName, jumlahKaliDipilih: agg.instanceIds.size, pendapatan: agg.pendapatan }))
    .sort((a, b) => b.pendapatan - a.pendapatan);

  return { rows, itemsNeverRented, bundleSummary, periodDaysCount };
}

// ----------------------------------------------------------------
// Bagian B tambahan: ringkasan Barang Jual (habis pakai), v1 (brief 16
// Nov 2026) -- LEBIH SEDERHANA dari buildPerAlatReport: tidak ada
// konsep hari/keterpakaian/okupansi untuk barang habis pakai (bukan
// disewa, dibeli putus), cuma jumlah terjual + pendapatan.
// ----------------------------------------------------------------

export type BarangJualReportRow = { saleItemId: string; name: string; jumlahTransaksi: number; jumlahTerjual: number; pendapatan: number };

// Terima dataset yang SAMA dengan buildPerAlatReport (overlap set) --
// cuma disaring ke "mulai di periode" di sini juga, konsisten semantik
// jumlahTransaksi/pendapatan di atas (metrik transaksi, bukan okupansi
// yang memang tidak ada untuk barang jual).
export function buildBarangJualReport(bookingsOverlapExcludingCancelled: HistoryBooking[], periodStart: string, periodEnd: string): BarangJualReportRow[] {
  const startedInPeriod = bookingsOverlapExcludingCancelled.filter(
    (b) => b.start_date >= periodStart && b.start_date <= periodEnd,
  );

  type Agg = { name: string; bookingIds: Set<string>; jumlahTerjual: number; pendapatan: number };
  const bySaleItemId = new Map<string, Agg>();
  for (const b of startedInPeriod) {
    for (const s of b.saleItems) {
      const agg = bySaleItemId.get(s.sale_item_id) ?? { name: s.name, bookingIds: new Set(), jumlahTerjual: 0, pendapatan: 0 };
      agg.bookingIds.add(b.id);
      agg.jumlahTerjual += s.quantity;
      agg.pendapatan += s.subtotal;
      bySaleItemId.set(s.sale_item_id, agg);
    }
  }

  return [...bySaleItemId.entries()]
    .map(([saleItemId, agg]) => ({
      saleItemId,
      name: agg.name,
      jumlahTransaksi: agg.bookingIds.size,
      jumlahTerjual: agg.jumlahTerjual,
      pendapatan: agg.pendapatan,
    }))
    .sort((a, b) => b.pendapatan - a.pendapatan);
}
