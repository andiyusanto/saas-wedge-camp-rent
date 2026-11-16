import type { HistoryBooking } from '../hooks/useHistory';
import { rentalDays } from './formatters';
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
  dendaTelat: number;
  dendaKerusakan: number;
  totalPemasukan: number;
  sudahDiterima: number;
  piutang: number;
  jumlahTransaksi: number;
  rataRata: number | null; // null kalau jumlahTransaksi 0
  // null = tidak ada pembanding (Januari -- bulan sebelumnya di luar
  // tahun yang dipilih, brief minta "pilih tahun" per-tahun, bukan
  // lintas tahun; lihat catatan UI LaporanScreen.tsx).
  perubahanPersenVsBulanLalu: number | null;
};

// bookings SUDAH difilter oleh caller ke tahun yang dipilih (start_date
// diawali `${year}-`) DAN dikecualikan 'dibatalkan' -- fungsi ini cuma
// mengelompokkan per bulan dari `start_date`, konsisten Riwayat.
export function buildMonthlyReport(bookingsInYearExcludingCancelled: HistoryBooking[]): MonthlyReportRow[] {
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
    let sudahDiterima = 0;
    let piutang = 0;
    let dendaTelat = 0;
    let dendaKerusakan = 0;

    for (const b of bookings) {
      pendapatanSewa += b.total_price;
      sudahDiterima += b.dp_paid;
      piutang += Math.max(0, b.total_price - b.dp_paid);
      dendaTelat += bookingPenaltyByType(b, 'keterlambatan');
      dendaKerusakan += bookingPenaltyByType(b, 'kerusakan-kehilangan');
    }

    const totalPemasukan = pendapatanSewa + dendaTelat + dendaKerusakan;
    const jumlahTransaksi = bookings.length;
    const rataRata = jumlahTransaksi > 0 ? totalPemasukan / jumlahTransaksi : null;

    // Januari (month===1): tidak ada pembanding dalam tahun yang sama --
    // prevTotalPemasukan masih null dari inisialisasi di atas.
    const perubahanPersenVsBulanLalu =
      prevTotalPemasukan == null ? null : prevTotalPemasukan === 0 ? null : ((totalPemasukan - prevTotalPemasukan) / prevTotalPemasukan) * 100;

    rows.push({
      month,
      pendapatanSewa,
      dendaTelat,
      dendaKerusakan,
      totalPemasukan,
      sudahDiterima,
      piutang,
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

export type ActiveItemRef = { id: string; name: string; total_units: number };

export type PerAlatReportRow = {
  itemId: string;
  name: string;
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

  type Agg = { name: string; bookingIds: Set<string>; totalUnitHari: number; pendapatan: number; unitHariClipped: number };
  const byItemId = new Map<string, Agg>();
  const totalUnitsByItemId = new Map<string, number>();
  for (const item of activeItems) totalUnitsByItemId.set(item.id, item.total_units);

  for (const b of startedInPeriod) {
    const days = rentalDays(b.start_date, b.end_date, b.rental_day_mode);
    for (const item of b.items) {
      if (!item.item_id) continue;
      const agg = byItemId.get(item.item_id) ?? { name: item.name, bookingIds: new Set(), totalUnitHari: 0, pendapatan: 0, unitHariClipped: 0 };
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
      const agg = byItemId.get(item.item_id) ?? { name: item.name, bookingIds: new Set(), totalUnitHari: 0, pendapatan: 0, unitHariClipped: 0 };
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
