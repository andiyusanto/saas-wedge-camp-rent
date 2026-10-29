import type { HistoryBooking } from '../hooks/useHistory';
import { rentalDays, formatDateIndo, bookingStatusLabel } from './formatters';

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
};

const KERUSAKAN_TYPES = new Set(['kerusakan', 'kehilangan']);

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

  for (const b of bookingsExcludingCancelled) {
    omset += b.total_price;
    sudahDiterima += b.dp_paid;
    piutang += Math.max(0, b.total_price - b.dp_paid);
    for (const p of b.penalties) {
      if (p.type === 'keterlambatan') totalDendaTelat += p.amount;
      else if (KERUSAKAN_TYPES.has(p.type)) totalDendaKerusakan += p.amount;
    }
  }

  return {
    totalTransaksi: bookingsExcludingCancelled.length,
    omset,
    sudahDiterima,
    piutang,
    totalDendaTelat,
    totalDendaKerusakan,
  };
}

function itemSubtotal(item: HistoryBooking['items'][number], days: number): number {
  return item.subtotal ?? item.price_at_booking * item.quantity * days;
}

function bookingPenaltyByType(b: HistoryBooking, type: 'keterlambatan' | 'kerusakan-kehilangan'): number {
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
    const days = rentalDays(b.start_date, b.end_date);
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

// new Date(Date.UTC(y, m-1, d)) BUKAN new Date(`${s}T00:00:00`) (waktu
// lokal) atau new Date(s) (diparse UTC tapi oleh exceljs dibaca lagi lewat
// getUTCFullYear/dst saat serialisasi ke tanggal Excel) — exceljs
// menyerialkan Date ke serial number Excel dari KOMPONEN UTC objeknya
// (dikonfirmasi lewat baca ulang file hasil generate, lihat verifikasi).
// Date.UTC(y,m-1,d) menghasilkan objek Date yang komponen UTC-nya PERSIS
// y/m/d yang diminta, apa pun timezone browser vendor — satu-satunya
// kombinasi yang terbukti tidak pernah bergeser.
function excelDate(dateStr: string): Date {
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
      total_price: b.total_price,
      dp_paid: b.dp_paid,
      remaining: Math.max(0, b.total_price - b.dp_paid),
      denda_telat: bookingPenaltyByType(b, 'keterlambatan'),
      denda_kerusakan: bookingPenaltyByType(b, 'kerusakan-kehilangan'),
      status: bookingStatusLabel(b.status),
    });
    row.getCell('start_date').numFmt = 'dd/mm/yyyy';
    row.getCell('end_date').numFmt = 'dd/mm/yyyy';
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
