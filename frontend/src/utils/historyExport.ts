import type { HistoryBooking } from '../hooks/useHistory';
import { rentalDays, formatDateIndo, bookingStatusLabel, computeRemainingBalance } from './formatters';

// Export Excel Riwayat Transaksi — permintaan Andi 29 Okt, dikoreksi 3x
// (lihat commit message). exceljs di-import DINAMIS di buildAndDownload()
// di bawah, BUKAN di top-level file ini, supaya Vite code-split jadi chunk
// terpisah yang cuma diunduh browser saat tombol "Unduh Excel" ditekan —
// tidak menambah ukuran bundle awal. exceljs dipakai (bukan `xlsx` npm)
// karena sudah tidak dirawat dan ber-CVE, sama alasan dengan impor data alat.

export type HistorySummary = {
  totalTransaksi: number;
  omset: number;
  sudahDiterima: number;
  piutang: number;
  totalDendaTelat: number;
  totalDendaKerusakan: number;
  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
  // dijumlahkan dari booking_sale_items, TERPISAH dari omset alat sewa
  // (b.total_price sudah SELALU gabungan sewa+barang jual sejak fitur
  // ini, jadi tidak perlu dijumlahkan dobel ke omset).
  pendapatanBarangJual: number;
};

// Diekspor (bukan lokal lagi) supaya reportAggregation.ts (Laporan,
// koordinator 16 Nov 2026) bisa pakai definisi SAMA PERSIS, bukan
// menyalin dua rumus yang bisa diam-diam beda.
export const KERUSAKAN_TYPES = new Set(['kerusakan', 'kehilangan']);

// Diekstrak dari HistoryScreen.tsx (dulu dihitung inline cuma untuk
// StatCard) supaya satu fungsi yang sama dipakai di layar DAN di export —
// kalau datasetnya sama (tanpa filter status/pencarian), angkanya DIJAMIN
// identik secara struktural, bukan dua salinan rumus yang bisa diam-diam
// beda. Parameter HARUS sudah dikecualikan 'dibatalkan' oleh caller (sama
// seperti nonCancelled di HistoryScreen) — fungsi ini sendiri tidak
// menyaring status apa pun, supaya caller yang menentukan dataset mana
// yang dipakai (layar: date-only; export: date+status+search).
export function computeHistorySummary(bookingsExcludingCancelled: HistoryBooking[]): HistorySummary {
  let omset = 0;
  let sudahDiterima = 0;
  let piutang = 0;
  let totalDendaTelat = 0;
  let totalDendaKerusakan = 0;
  let pendapatanBarangJual = 0;

  for (const b of bookingsExcludingCancelled) {
    omset += b.total_price;
    sudahDiterima += b.dp_paid;
    const bookingFines = b.penalties.reduce((sum, p) => sum + p.amount, 0);
    // Pelunasan (brief 17 Nov 2026) -- piutang SEKARANG termasuk denda
    // (computeRemainingBalance), di-clamp 0 PER TRANSAKSI (keputusan
    // koordinator 17 Nov 2026) -- "lebih bayar" di satu transaksi tidak
    // boleh mengurangi piutang transaksi lain yang masih nunggak.
    piutang += Math.max(0, computeRemainingBalance(b.total_price, bookingFines, b.dp_paid));
    for (const p of b.penalties) {
      if (p.type === 'keterlambatan') totalDendaTelat += p.amount;
      else if (KERUSAKAN_TYPES.has(p.type)) totalDendaKerusakan += p.amount;
    }
    for (const s of b.saleItems) pendapatanBarangJual += s.subtotal;
  }

  return {
    totalTransaksi: bookingsExcludingCancelled.length,
    omset,
    sudahDiterima,
    piutang,
    totalDendaTelat,
    totalDendaKerusakan,
    pendapatanBarangJual,
  };
}

export function itemSubtotal(item: HistoryBooking['items'][number], days: number): number {
  return item.subtotal ?? item.price_at_booking * item.quantity * days;
}

export function bookingPenaltyByType(b: HistoryBooking, type: 'keterlambatan' | 'kerusakan-kehilangan'): number {
  return b.penalties
    .filter((p) => (type === 'keterlambatan' ? p.type === 'keterlambatan' : KERUSAKAN_TYPES.has(p.type)))
    .reduce((sum, p) => sum + p.amount, 0);
}

type PerAlatRow = {
  name: string;
  jumlahTransaksi: number;
  totalUnit: number;
  totalUnitHari: number;
  pendapatan: number;
  dendaKerusakan: number;
};

function buildPerAlatRows(bookingsExcludingCancelled: HistoryBooking[]): PerAlatRow[] {
  const map = new Map<string, PerAlatRow & { bookingIds: Set<string> }>();

  for (const b of bookingsExcludingCancelled) {
    const days = rentalDays(b.start_date, b.end_date, b.rental_day_mode);
    for (const item of b.items) {
      const key = item.item_id ?? item.name;
      const existing = map.get(key);
      const pendapatan = itemSubtotal(item, days);
      const dendaKerusakan = b.penalties
        .filter((p) => KERUSAKAN_TYPES.has(p.type) && p.item_id === item.item_id && item.item_id !== null)
        .reduce((sum, p) => sum + p.amount, 0);

      if (existing) {
        existing.totalUnit += item.quantity;
        existing.totalUnitHari += item.quantity * days;
        existing.pendapatan += pendapatan;
        existing.dendaKerusakan += dendaKerusakan;
        existing.bookingIds.add(b.id);
      } else {
        map.set(key, {
          name: item.name,
          jumlahTransaksi: 0,
          totalUnit: item.quantity,
          totalUnitHari: item.quantity * days,
          pendapatan,
          dendaKerusakan,
          bookingIds: new Set([b.id]),
        });
      }
    }
  }

  return [...map.values()]
    .map(({ bookingIds, ...rest }) => ({ ...rest, jumlahTransaksi: bookingIds.size }))
    .sort((a, b) => b.pendapatan - a.pendapatan);
}

// Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- lebih sederhana
// dari buildPerAlatRows: tidak ada konsep hari/keterpakaian untuk barang
// habis pakai, cuma jumlah terjual + pendapatan per barang.
type SaleItemRow = { name: string; jumlahTerjual: number; pendapatan: number };

function buildSaleItemRows(bookingsExcludingCancelled: HistoryBooking[]): SaleItemRow[] {
  const map = new Map<string, SaleItemRow>();
  for (const b of bookingsExcludingCancelled) {
    for (const s of b.saleItems) {
      const key = s.sale_item_id;
      const existing = map.get(key);
      if (existing) {
        existing.jumlahTerjual += s.quantity;
        existing.pendapatan += s.subtotal;
      } else {
        map.set(key, { name: s.name, jumlahTerjual: s.quantity, pendapatan: s.subtotal });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.pendapatan - a.pendapatan);
}

// new Date(Date.UTC(y, m-1, d)) BUKAN new Date(`${s}T00:00:00`) (waktu
// lokal) atau new Date(s) (diparse UTC tapi oleh exceljs dibaca lagi lewat
// getUTCFullYear/dst saat serialisasi ke tanggal Excel) — exceljs
// menyerialkan Date ke serial number Excel dari KOMPONEN UTC objeknya
// (dikonfirmasi lewat baca ulang file hasil generate, lihat verifikasi).
// Date.UTC(y,m-1,d) menghasilkan objek Date yang komponen UTC-nya PERSIS
// y/m/d yang diminta, apa pun timezone browser vendor — satu-satunya
// kombinasi yang terbukti tidak pernah bergeser.
export function excelDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export type HistoryExportFilters = {
  from: string;
  to: string;
  statusFilter: string;
  searchQuery: string;
};

const STATUS_LABEL_FOR_FILTER: Record<string, string> = {
  semua: 'Semua',
  dipesan: 'Siap Diambil',
  aktif: 'Sedang Disewa',
  telat: 'Terlambat',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

// Laporan (brief 16 Nov 2026) — 2 sheet baru dalam SATU file terpisah
// dari export Riwayat di atas (keputusan koordinator: tombol Unduh
// Excel di tab Laporan terpisah dari tombol Riwayat yang sudah ada).
// Nama sheet persis permintaan brief: "Laporan Bulanan" & "Laporan per
// Alat".
import type { MonthlyReportRow, PerAlatReportResult, BarangJualReportRow } from './reportAggregation';

export async function downloadLaporanExcel(args: {
  year: number;
  monthlyRows: MonthlyReportRow[];
  periodStart: string;
  periodEnd: string;
  perAlatResult: PerAlatReportResult;
  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- opsional, cuma
  // diisi kalau business punya barang jual sama sekali (rental tanpa
  // barang jual: tidak dikirim, sheet-sheet di bawah TIDAK berubah sama
  // sekali, regresi aman).
  barangJualRows?: BarangJualReportRow[];
}): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const MONTH_NAMES_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  const bulananSheet = workbook.addWorksheet('Laporan Bulanan');
  bulananSheet.columns = [
    { header: 'Bulan', key: 'month', width: 14 },
    { header: 'Pendapatan Sewa (Rp)', key: 'pendapatanSewa', width: 18 },
    { header: 'Penjualan Barang (Rp)', key: 'pendapatanBarangJual', width: 18 },
    { header: 'Denda Telat (Rp)', key: 'dendaTelat', width: 16 },
    { header: 'Denda Rusak/Hilang (Rp)', key: 'dendaKerusakan', width: 18 },
    { header: 'Total Pemasukan (Rp)', key: 'totalPemasukan', width: 18 },
    { header: 'Sudah Diterima (Rp)', key: 'sudahDiterima', width: 18 },
    { header: 'Belum Lunas (Rp)', key: 'piutang', width: 16 },
    { header: 'Uang Diterima (Rp)', key: 'uangDiterima', width: 18 },
    { header: 'Jumlah Transaksi', key: 'jumlahTransaksi', width: 16 },
    { header: 'Rata-rata per Transaksi (Rp)', key: 'rataRata', width: 20 },
    { header: 'Perubahan vs Bulan Lalu (%)', key: 'perubahan', width: 20 },
  ];
  bulananSheet.getRow(1).font = { bold: true };
  for (const row of args.monthlyRows) {
    const r = bulananSheet.addRow({
      month: MONTH_NAMES_ID[row.month - 1],
      pendapatanSewa: row.pendapatanSewa,
      pendapatanBarangJual: row.pendapatanBarangJual,
      dendaTelat: row.dendaTelat,
      dendaKerusakan: row.dendaKerusakan,
      totalPemasukan: row.totalPemasukan,
      sudahDiterima: row.sudahDiterima,
      piutang: row.piutang,
      uangDiterima: row.uangDiterima,
      jumlahTransaksi: row.jumlahTransaksi,
      rataRata: row.rataRata ?? 0,
      perubahan: row.perubahanPersenVsBulanLalu == null ? 'Tidak ada pembanding' : `${row.perubahanPersenVsBulanLalu.toFixed(1)}%`,
    });
    for (const key of ['pendapatanSewa', 'pendapatanBarangJual', 'dendaTelat', 'dendaKerusakan', 'totalPemasukan', 'sudahDiterima', 'piutang', 'uangDiterima', 'rataRata']) {
      r.getCell(key).numFmt = '#,##0';
    }
  }
  const note1 = bulananSheet.addRow([
    '"Sudah Diterima"/"Belum Lunas" mengikuti bulan transaksinya (tanggal ambil, termasuk denda) — Transaksi Dibatalkan tidak dihitung. "Uang Diterima" (brief Pelunasan 17 Nov 2026) mengikuti bulan pembayaran BENAR-BENAR dicatat (paid_at), dua basis ini tidak harus sama.',
  ]);
  note1.getCell(1).font = { italic: true, color: { argb: 'FFA65C2A' } };
  bulananSheet.mergeCells(note1.number, 1, note1.number, 12);

  const perAlatSheet = workbook.addWorksheet('Laporan per Alat');
  perAlatSheet.columns = [
    { header: 'Nama Alat', key: 'name', width: 28 },
    { header: 'Jumlah Sewa', key: 'jumlahTransaksi', width: 14 },
    { header: 'Total Unit-Hari', key: 'totalUnitHari', width: 16 },
    { header: 'Pendapatan (Rp)', key: 'pendapatan', width: 18 },
    { header: 'Keterpakaian (%)', key: 'keterpakaian', width: 16 },
  ];
  perAlatSheet.getRow(1).font = { bold: true };
  for (const row of args.perAlatResult.rows) {
    const r = perAlatSheet.addRow({
      name: row.name,
      jumlahTransaksi: row.jumlahTransaksi,
      totalUnitHari: row.totalUnitHari,
      pendapatan: row.pendapatan,
      keterpakaian: Number(row.keterpakaianPersen.toFixed(1)),
    });
    r.getCell('pendapatan').numFmt = '#,##0';
  }
  perAlatSheet.addRow([]);
  if (args.perAlatResult.itemsNeverRented.length > 0) {
    const headerRow = perAlatSheet.addRow(['Alat Tidak Pernah Disewa di Periode Ini']);
    headerRow.getCell(1).font = { bold: true };
    for (const item of args.perAlatResult.itemsNeverRented) perAlatSheet.addRow([item.name]);
    perAlatSheet.addRow([]);
  }
  if (args.perAlatResult.bundleSummary.length > 0) {
    const headerRow = perAlatSheet.addRow(['Ringkasan per Paket']);
    headerRow.getCell(1).font = { bold: true };
    const subHeaderRow = perAlatSheet.addRow(['Nama Paket', 'Jumlah Kali Dipilih', 'Pendapatan (Rp)']);
    subHeaderRow.font = { bold: true };
    for (const b of args.perAlatResult.bundleSummary) {
      const r = perAlatSheet.addRow([`Paket ${b.bundleName}`, b.jumlahKaliDipilih, b.pendapatan]);
      r.getCell(3).numFmt = '#,##0';
    }
  }
  const note2 = perAlatSheet.addRow(['Keterpakaian dihitung dari hari kalender ambil s/d kembali yang jatuh DI DALAM periode (dipotong kalau sewa melintasi batas periode), dibagi stok alat SAAT INI x jumlah hari periode. Pendapatan per alat dihitung dari rincian alat, bisa sedikit berbeda dari total transaksi bila totalnya diubah manual.']);
  note2.getCell(1).font = { italic: true, color: { argb: 'FFA65C2A' } };
  perAlatSheet.mergeCells(note2.number, 1, note2.number, 5);

  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- sheet TERPISAH,
  // cuma dibuat kalau ADA barang jual di periode ini (rental tanpa
  // barang jual sama sekali: args.barangJualRows kosong/undefined,
  // tidak ada sheet tambahan sama sekali -- regresi aman).
  if (args.barangJualRows && args.barangJualRows.length > 0) {
    const barangJualSheet = workbook.addWorksheet('Penjualan Barang');
    barangJualSheet.columns = [
      { header: 'Nama Barang', key: 'name', width: 28 },
      { header: 'Jumlah Transaksi', key: 'jumlahTransaksi', width: 16 },
      { header: 'Jumlah Terjual', key: 'jumlahTerjual', width: 16 },
      { header: 'Pendapatan (Rp)', key: 'pendapatan', width: 18 },
    ];
    barangJualSheet.getRow(1).font = { bold: true };
    for (const row of args.barangJualRows) {
      const r = barangJualSheet.addRow(row);
      r.getCell('pendapatan').numFmt = '#,##0';
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `laporan_${args.year}_${args.periodStart}_${args.periodEnd}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadHistoryExcel(allFiltered: HistoryBooking[], filters: HistoryExportFilters): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();

  const nonCancelledFiltered = allFiltered.filter((b) => b.status !== 'dibatalkan');
  const summary = computeHistorySummary(nonCancelledFiltered);
  const isFilterNarrowed = filters.statusFilter !== 'semua' || filters.searchQuery.trim() !== '';

  // --- Sheet "Transaksi" — SEMUA baris yang terlihat di daftar layar,
  // termasuk dibatalkan (riwayat lengkap, sama seperti tabel di layar).
  const transaksiSheet = workbook.addWorksheet('Transaksi');
  transaksiSheet.columns = [
    { header: 'No. Booking', key: 'booking_number', width: 16 },
    { header: 'Penyewa', key: 'customer_name', width: 22 },
    { header: 'WhatsApp', key: 'customer_phone', width: 16 },
    { header: 'Tanggal Ambil', key: 'start_date', width: 14 },
    { header: 'Tanggal Kembali', key: 'end_date', width: 14 },
    { header: 'Alat', key: 'items', width: 32 },
    { header: 'Barang Jual', key: 'sale_items', width: 24 },
    { header: 'Total Harga (Rp)', key: 'total_price', width: 16 },
    { header: 'Sudah Dibayar (Rp)', key: 'dp_paid', width: 16 },
    { header: 'Sisa Tagihan (Rp)', key: 'remaining', width: 16 },
    { header: 'Denda Telat (Rp)', key: 'denda_telat', width: 16 },
    { header: 'Denda Kerusakan/Hilang (Rp)', key: 'denda_kerusakan', width: 20 },
    { header: 'Status', key: 'status', width: 14 },
  ];
  transaksiSheet.getRow(1).font = { bold: true };

  for (const b of allFiltered) {
    const row = transaksiSheet.addRow({
      booking_number: b.booking_number ?? '',
      customer_name: b.customer?.name ?? '',
      customer_phone: b.customer?.phone ?? '',
      start_date: excelDate(b.start_date),
      end_date: excelDate(b.end_date),
      items: b.items.map((i) => `${i.name} (${i.quantity}x)`).join('; '),
      sale_items: b.saleItems.map((s) => `${s.name} (${s.quantity}x)`).join('; '),
      total_price: b.total_price,
      dp_paid: b.dp_paid,
      // Pelunasan (brief 17 Nov 2026) -- sisa tagihan termasuk denda.
      remaining: Math.max(
        0,
        computeRemainingBalance(b.total_price, b.penalties.reduce((sum, p) => sum + p.amount, 0), b.dp_paid),
      ),
      denda_telat: bookingPenaltyByType(b, 'keterlambatan'),
      denda_kerusakan: bookingPenaltyByType(b, 'kerusakan-kehilangan'),
      status: bookingStatusLabel(b.status),
    });
    // Format tampilan sel diseragamkan dd-mm-yyyy (keputusan Andi 10 Nov
    // 2026) — sel tetap bertipe tanggal Excel sungguhan (bisa diurutkan/
    // difilter), cuma numFmt-nya yang berubah dari dd/mm/yyyy.
    row.getCell('start_date').numFmt = 'dd-mm-yyyy';
    row.getCell('end_date').numFmt = 'dd-mm-yyyy';
    for (const key of ['total_price', 'dp_paid', 'remaining', 'denda_telat', 'denda_kerusakan']) {
      row.getCell(key).numFmt = '#,##0';
    }
  }

  // --- Sheet "Ringkasan" — nonCancelledFiltered, sama aturan StatCard
  // (computeHistorySummary dipakai juga di HistoryScreen.tsx).
  const ringkasanSheet = workbook.addWorksheet('Ringkasan');
  ringkasanSheet.columns = [
    { key: 'label', width: 28 },
    { key: 'value', width: 24 },
  ];
  const addLabelRow = (label: string, value: string | number, numFmt?: string) => {
    const row = ringkasanSheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (numFmt) row.getCell(2).numFmt = numFmt;
    return row;
  };

  addLabelRow('Periode (tanggal ambil)', `${formatDateIndo(filters.from, false)} – ${formatDateIndo(filters.to, false)}`);
  addLabelRow('Status', STATUS_LABEL_FOR_FILTER[filters.statusFilter] ?? filters.statusFilter);
  addLabelRow('Pencarian', filters.searchQuery.trim() || '(kosong)');
  if (isFilterNarrowed) {
    const noteRow = ringkasanSheet.addRow(['Angka ini hanya untuk transaksi yang cocok dengan filter, bukan seluruh usaha.']);
    noteRow.getCell(1).font = { italic: true, color: { argb: 'FFA65C2A' } };
    ringkasanSheet.mergeCells(noteRow.number, 1, noteRow.number, 2);
  }
  ringkasanSheet.addRow([]);
  addLabelRow('Jumlah Transaksi', summary.totalTransaksi);
  addLabelRow('Omset (Rp)', summary.omset, '#,##0');
  addLabelRow('Sudah Dibayar (Rp)', summary.sudahDiterima, '#,##0');
  addLabelRow('Piutang (Rp)', summary.piutang, '#,##0');
  addLabelRow('Total Denda Keterlambatan (Rp)', summary.totalDendaTelat, '#,##0');
  addLabelRow('Total Denda Kerusakan/Hilang (Rp)', summary.totalDendaKerusakan, '#,##0');
  addLabelRow('Penjualan Barang Jual (Rp)', summary.pendapatanBarangJual, '#,##0');

  // --- Sheet "Per Alat" — nonCancelledFiltered juga, dikelompokkan per
  // item_id (pola sama seperti "Peralatan Terlaris" di HistoryScreen.tsx).
  const perAlatSheet = workbook.addWorksheet('Per Alat');
  perAlatSheet.columns = [
    { header: 'Nama Alat', key: 'name', width: 28 },
    { header: 'Jumlah Transaksi', key: 'jumlahTransaksi', width: 16 },
    { header: 'Total Unit Disewa', key: 'totalUnit', width: 16 },
    { header: 'Total Unit-Hari', key: 'totalUnitHari', width: 16 },
    { header: 'Pendapatan (Rp)', key: 'pendapatan', width: 18 },
    { header: 'Denda Kerusakan/Hilang (Rp)', key: 'dendaKerusakan', width: 20 },
  ];
  perAlatSheet.getRow(1).font = { bold: true };
  for (const r of buildPerAlatRows(nonCancelledFiltered)) {
    const row = perAlatSheet.addRow(r);
    row.getCell('pendapatan').numFmt = '#,##0';
    row.getCell('dendaKerusakan').numFmt = '#,##0';
  }

  // --- Sheet "Penjualan Barang" (brief 16 Nov 2026) -- cuma dibuat kalau
  // ADA penjualan di periode ini, konsisten dengan sheet-sheet lain yang
  // tetap selalu dibuat tapi kosong kalau tidak relevan, kecuali barang
  // jual memang fitur opsional (rental tanpa barang jual sama sekali
  // tidak perlu sheet kosong di export-nya).
  const saleRows = buildSaleItemRows(nonCancelledFiltered);
  if (saleRows.length > 0) {
    const penjualanSheet = workbook.addWorksheet('Penjualan Barang');
    penjualanSheet.columns = [
      { header: 'Nama Barang', key: 'name', width: 28 },
      { header: 'Jumlah Terjual', key: 'jumlahTerjual', width: 16 },
      { header: 'Pendapatan (Rp)', key: 'pendapatan', width: 18 },
    ];
    penjualanSheet.getRow(1).font = { bold: true };
    for (const r of saleRows) {
      const row = penjualanSheet.addRow(r);
      row.getCell('pendapatan').numFmt = '#,##0';
    }
  }

  // --- Sheet "Pembayaran" (brief 17 Nov 2026, migration 067) -- riwayat
  // booking_payments APA ADANYA dari allFiltered (termasuk dibatalkan --
  // riwayat pembayaran tetap lengkap persis seperti sheet "Transaksi" di
  // atas), cuma dibuat kalau ada minimal satu baris pembayaran (rental
  // yang belum sempat mencatat apa pun: sheet kosong tidak perlu ada).
  const paymentRows = allFiltered.flatMap((b) =>
    b.payments.map((p) => ({
      booking_number: b.booking_number ?? '',
      customer_name: b.customer?.name ?? '',
      paid_at: excelDate(p.paid_at.slice(0, 10)),
      kind: p.kind,
      amount: p.amount,
    })),
  );
  if (paymentRows.length > 0) {
    const pembayaranSheet = workbook.addWorksheet('Pembayaran');
    pembayaranSheet.columns = [
      { header: 'No. Booking', key: 'booking_number', width: 16 },
      { header: 'Penyewa', key: 'customer_name', width: 22 },
      { header: 'Tanggal Bayar', key: 'paid_at', width: 14 },
      { header: 'Jenis', key: 'kind', width: 14 },
      { header: 'Nominal (Rp)', key: 'amount', width: 16 },
    ];
    pembayaranSheet.getRow(1).font = { bold: true };
    for (const r of paymentRows) {
      const row = pembayaranSheet.addRow(r);
      row.getCell('paid_at').numFmt = 'dd-mm-yyyy';
      row.getCell('amount').numFmt = '#,##0';
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `riwayat-transaksi_${filters.from}_${filters.to}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
