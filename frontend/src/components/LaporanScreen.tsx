import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Package, TrendingDown, TrendingUp } from 'lucide-react';
import { fetchHistoryBookings, fetchPaymentsInYear } from '../hooks/useHistory';
import type { HistoryBooking } from '../hooks/useHistory';
import { useItems } from '../hooks/useItems';
import { formatIDR } from '../utils/formatters';
import { buildMonthlyReport, buildCashReceivedByMonth, buildPerAlatReport, buildBarangJualReport, formatKeterpakaianPersen } from '../utils/reportAggregation';
import type { MonthlyReportRow, PerAlatReportResult } from '../utils/reportAggregation';
import { downloadLaporanExcel } from '../utils/historyExport';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Laporan (brief 16 Nov 2026) — tab baru di dalam Riwayat Transaksi,
// owner-only (seluruh HistoryScreen sudah digerbang role==='owner' di
// App.tsx, jadi tidak perlu gerbang tambahan di sini). Dua sub-laporan:
// A. Pemasukan per bulan (pilih tahun), B. Laporan per alat (pilih
// periode bulan/tahun/rentang). Data diambil langsung lewat
// fetchHistoryBookings() (pola sama useHistory.ts, paginasi paralel) —
// TIDAK ada backend/RPC baru, lihat rencana yang disetujui koordinator.
export function LaporanScreen({ businessId }: { businessId: string }) {
  const [reportTab, setReportTab] = useState<'bulanan' | 'per-alat'>('bulanan');
  const { items: activeItems } = useItems(businessId);

  // ---------------- A. Pemasukan per bulan ----------------
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [monthlyBookings, setMonthlyBookings] = useState<HistoryBooking[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(true);
  // "Uang Diterima" (revisi koordinator 17 Nov 2026) -- fetch TERPISAH
  // dari monthlyBookings, difilter paid_at dalam TAHUN yang dipilih
  // secara LANGSUNG (lihat catatan panjang di fetchPaymentsInYear/
  // buildCashReceivedByMonth) -- supaya DP yang dibayar di tahun ini
  // untuk booking tahun depan (kasus umum di akhir tahun) tetap terhitung.
  const [paymentsInYear, setPaymentsInYear] = useState<{ amount: number; paid_at: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setMonthlyLoading(true);
    Promise.all([
      fetchHistoryBookings(businessId, `${year}-01-01`, `${year}-12-31`, 'start_date'),
      fetchPaymentsInYear(businessId, year),
    ]).then(([bookingsRes, paymentsRes]) => {
      if (cancelled) return;
      setMonthlyBookings(bookingsRes.error ? [] : bookingsRes.rows);
      setPaymentsInYear(paymentsRes.error ? [] : paymentsRes.rows);
      setMonthlyLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, year]);

  const cashReceivedByMonth = useMemo(() => buildCashReceivedByMonth(paymentsInYear), [paymentsInYear]);

  const monthlyRows = useMemo(
    () => buildMonthlyReport(monthlyBookings.filter((b) => b.status !== 'dibatalkan'), cashReceivedByMonth),
    [monthlyBookings, cashReceivedByMonth],
  );
  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- kolom/kartu baru
  // HANYA tampil kalau business ini memang pernah menjual sesuatu di
  // tahun yang dipilih, supaya rental tanpa barang jual sama sekali
  // tampil PERSIS seperti sebelum fitur ini ada (regresi).
  const hasBarangJualDataMonthly = monthlyRows.some((r) => r.pendapatanBarangJual > 0);
  // Pelanggan + Member/Diskon (brief 23 Nov 2026) -- kolom HANYA tampil
  // kalau ada transaksi berdiskon di tahun ini (pola sama Barang Jual).
  const hasDiscountDataMonthly = monthlyRows.some((r) => r.diskon > 0);
  // Bebaskan denda telat (brief rencana-bayar-bebaskan-denda 24 Nov 2026)
  // -- kolom HANYA tampil kalau pernah ada pembebasan di tahun ini.
  const hasWaivedFeeDataMonthly = monthlyRows.some((r) => r.dendaDibebaskanJumlah > 0);
  const maxTotalPemasukan = Math.max(1, ...monthlyRows.map((r) => r.totalPemasukan));
  const defaultHighlightMonth = year === currentYear ? new Date().getMonth() + 1 : 12;
  const [highlightMonth, setHighlightMonth] = useState(defaultHighlightMonth);
  useEffect(() => setHighlightMonth(defaultHighlightMonth), [year]); // eslint-disable-line react-hooks/exhaustive-deps
  const highlightRow = monthlyRows.find((r) => r.month === highlightMonth);


  // ---------------- B. Laporan per alat ----------------
  type PeriodMode = 'bulan' | 'tahun' | 'rentang';
  const [periodMode, setPeriodMode] = useState<PeriodMode>('bulan');
  const now = new Date();
  const [perAlatYear, setPerAlatYear] = useState(now.getFullYear());
  const [perAlatMonth, setPerAlatMonth] = useState(now.getMonth() + 1);
  const [rangeFrom, setRangeFrom] = useState(`${now.getFullYear()}-01-01`);
  const [rangeTo, setRangeTo] = useState(`${now.getFullYear()}-12-31`);
  const [sortBy, setSortBy] = useState<'pendapatan' | 'keterpakaian' | 'jumlahSewa' | 'kategori'>('pendapatan');

  const { periodStart, periodEnd } = useMemo(() => {
    if (periodMode === 'bulan') {
      const start = `${perAlatYear}-${String(perAlatMonth).padStart(2, '0')}-01`;
      const end = `${perAlatYear}-${String(perAlatMonth).padStart(2, '0')}-${String(lastDayOfMonth(perAlatYear, perAlatMonth)).padStart(2, '0')}`;
      return { periodStart: start, periodEnd: end };
    }
    if (periodMode === 'tahun') {
      return { periodStart: `${perAlatYear}-01-01`, periodEnd: `${perAlatYear}-12-31` };
    }
    return { periodStart: rangeFrom, periodEnd: rangeTo };
  }, [periodMode, perAlatYear, perAlatMonth, rangeFrom, rangeTo]);

  const [perAlatBookings, setPerAlatBookings] = useState<HistoryBooking[]>([]);
  const [perAlatLoading, setPerAlatLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPerAlatLoading(true);
    // mode 'overlap' (bukan 'start_date') -- keterpakaian perlu tahu
    // booking yang melintasi batas periode (koordinator 16 Nov 2026),
    // lihat clipOccupiedDaysToPeriod() di reportAggregation.ts.
    fetchHistoryBookings(businessId, periodStart, periodEnd, 'overlap').then((res) => {
      if (cancelled) return;
      setPerAlatBookings(res.error ? [] : res.rows);
      setPerAlatLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, periodStart, periodEnd]);

  const perAlatResult: PerAlatReportResult = useMemo(() => {
    const activeItemRefs = activeItems.map((i) => ({ id: i.id, name: i.name, total_units: i.total_units, category: i.category }));
    return buildPerAlatReport(
      perAlatBookings.filter((b) => b.status !== 'dibatalkan'),
      activeItemRefs,
      periodStart,
      periodEnd,
    );
  }, [perAlatBookings, activeItems, periodStart, periodEnd]);

  // Barang Jual (habis pakai), v1 -- ringkasan terpisah (jumlah terjual +
  // pendapatan), TANPA konsep keterpakaian/okupansi (tidak relevan untuk
  // barang habis pakai, beda dari alat sewa di atas).
  const barangJualRows = useMemo(
    () => buildBarangJualReport(perAlatBookings.filter((b) => b.status !== 'dibatalkan'), periodStart, periodEnd),
    [perAlatBookings, periodStart, periodEnd],
  );

  const sortedRows = useMemo(() => {
    const rows = [...perAlatResult.rows];
    // Urutkan "Kategori" (brief 17 Nov 2026) -- urutan sekunder dalam
    // kategori yang sama pakai Pendapatan (sama seperti default).
    if (sortBy === 'kategori') rows.sort((a, b) => a.category.localeCompare(b.category, 'id') || b.pendapatan - a.pendapatan);
    else if (sortBy === 'pendapatan') rows.sort((a, b) => b.pendapatan - a.pendapatan);
    else if (sortBy === 'keterpakaian') rows.sort((a, b) => b.keterpakaianPersen - a.keterpakaianPersen);
    else rows.sort((a, b) => b.jumlahTransaksi - a.jumlahTransaksi);
    return rows;
  }, [perAlatResult.rows, sortBy]);

  // Satu tombol unduh untuk SELURUH tab Laporan (kedua sheet sekaligus,
  // koordinator 16 Nov 2026) -- kedua dataset (bulanan & per alat) SELALU
  // dimuat terlepas dari sub-tab yang sedang dilihat (lihat dua useEffect
  // di atas, keduanya tidak digerbang reportTab), jadi tidak perlu tombol
  // terpisah per sub-tab.
  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    try {
      await downloadLaporanExcel({ year, monthlyRows, periodStart, periodEnd, perAlatResult, barangJualRows });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['bulanan', 'per-alat'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setReportTab(tab)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              reportTab === tab ? 'bg-[#2B4739] text-[#FBFAF4] shadow-xs' : 'bg-[#F1EEE2] text-[#26302B] border border-[#DBD5C1] hover:bg-[#E6E1D2]'
            }`}
          >
            {tab === 'bulanan' ? 'Pemasukan per Bulan' : 'Laporan per Alat'}
          </button>
        ))}
      </div>

      {reportTab === 'bulanan' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1]">
            <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
              Tahun
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || currentYear)}
                className="w-28 px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs font-bold"
              />
            </label>
            {/* Dipindah dari header halaman (koordinator 17 Nov 2026) -- gaya
                sekunder (outline), posisi dekat pemilih periode/tahun, pola
                konsisten dengan tombol Unduh Excel di tab Transaksi Riwayat. */}
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || monthlyLoading || perAlatLoading}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white text-[#2B4739] border border-[#2B4739] hover:bg-[#E8EFEA] font-bold text-xs transition disabled:opacity-50 shrink-0 ml-auto"
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? 'Menyiapkan...' : 'Unduh Excel'}</span>
            </button>
          </div>

          {monthlyLoading ? (
            <p className="text-sm text-[#6E6853]">Memuat...</p>
          ) : (
            <>
              {/* Grafik batang SVG sederhana -- tanpa library chart baru. */}
              <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1]">
                <h3 className="text-sm font-bold text-[#26302B] flex items-center gap-2 mb-3">
                  <BarChart3 className="w-4 h-4 text-[#2B4739]" />
                  <span>Total Pemasukan per Bulan {year}</span>
                </h3>
                <div className="flex items-end gap-1.5 h-36">
                  {monthlyRows.map((row) => {
                    const heightPct = (row.totalPemasukan / maxTotalPemasukan) * 100;
                    const isHighlighted = row.month === highlightMonth;
                    return (
                      <button
                        key={row.month}
                        type="button"
                        onClick={() => setHighlightMonth(row.month)}
                        className="flex-1 flex flex-col items-center gap-1 group"
                        title={`${MONTH_NAMES[row.month - 1]}: ${formatIDR(row.totalPemasukan)}`}
                      >
                        <div className="w-full flex items-end h-28 rounded-t bg-[#F1EEE2]">
                          <div
                            className={`w-full rounded-t transition ${isHighlighted ? 'bg-[#2B4739]' : 'bg-[#2B4739]/40 group-hover:bg-[#2B4739]/70'}`}
                            style={{ height: `${Math.max(2, heightPct)}%` }}
                          />
                        </div>
                        <span className={`text-[9px] font-bold ${isHighlighted ? 'text-[#2B4739]' : 'text-[#6E6853]'}`}>{MONTH_NAMES[row.month - 1]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {highlightRow && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-[#FBFAF4] p-3 rounded-xl border border-[#DBD5C1]">
                    <p className="text-[10px] text-[#6E6853] font-semibold uppercase">Total Pemasukan — {MONTH_NAMES[highlightRow.month - 1]}</p>
                    <p className="text-sm font-bold text-[#26302B]">{formatIDR(highlightRow.totalPemasukan)}</p>
                    {highlightRow.perubahanPersenVsBulanLalu == null ? (
                      <p className="text-[10px] text-[#6E6853] italic">Tidak ada pembanding (Januari/tidak ada data bulan lalu)</p>
                    ) : (
                      <p className={`text-[10px] font-bold flex items-center gap-1 ${highlightRow.perubahanPersenVsBulanLalu >= 0 ? 'text-[#2B4739]' : 'text-[#A8412E]'}`}>
                        {highlightRow.perubahanPersenVsBulanLalu >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {highlightRow.perubahanPersenVsBulanLalu.toFixed(1)}% vs bulan lalu
                      </p>
                    )}
                  </div>
                  <div className="bg-[#FBFAF4] p-3 rounded-xl border border-[#DBD5C1]">
                    <p className="text-[10px] text-[#6E6853] font-semibold uppercase">Pendapatan Sewa</p>
                    <p className="text-sm font-bold text-[#26302B]">{formatIDR(highlightRow.pendapatanSewa)}</p>
                  </div>
                  {hasBarangJualDataMonthly && (
                    <div className="bg-[#FBFAF4] p-3 rounded-xl border border-[#DBD5C1]">
                      <p className="text-[10px] text-[#6E6853] font-semibold uppercase">Penjualan Barang</p>
                      <p className="text-sm font-bold text-[#26302B]">{formatIDR(highlightRow.pendapatanBarangJual)}</p>
                    </div>
                  )}
                  <div className="bg-[#FBFAF4] p-3 rounded-xl border border-[#DBD5C1]">
                    <p className="text-[10px] text-[#6E6853] font-semibold uppercase">Denda Telat + Rusak/Hilang</p>
                    <p className="text-sm font-bold text-[#26302B]">{formatIDR(highlightRow.dendaTelat + highlightRow.dendaKerusakan)}</p>
                  </div>
                  <div className="bg-[#FBFAF4] p-3 rounded-xl border border-[#DBD5C1]">
                    <p className="text-[10px] text-[#6E6853] font-semibold uppercase">Sudah Diterima / Belum Lunas</p>
                    <p className="text-sm font-bold text-[#26302B]">{formatIDR(highlightRow.sudahDiterima)} / {formatIDR(highlightRow.piutang)}</p>
                  </div>
                  <div className="bg-[#FBFAF4] p-3 rounded-xl border border-[#DBD5C1]">
                    <p className="text-[10px] text-[#6E6853] font-semibold uppercase">Uang Diterima (kas)</p>
                    <p className="text-sm font-bold text-[#26302B]">{formatIDR(highlightRow.uangDiterima)}</p>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-[#6E6853] italic">
                Dua basis berbeda: "Sudah Diterima"/"Belum Lunas" mengikuti bulan transaksinya (tanggal ambil, bisa
                termasuk denda) — sedangkan "Uang Diterima" (brief Pelunasan 17 Nov 2026) mengikuti bulan
                PEMBAYARAN BENAR-BENAR DICATAT (tanggal bayar sungguhan, lewat Catat Pembayaran/pelunasan), jadi
                dua angka ini TIDAK HARUS SAMA per bulan — satu booking boleh membayar DP di bulan berbeda dari
                bulan ia mulai disewa. Transaksi berstatus Dibatalkan tidak dihitung di "Sudah Diterima"/"Belum
                Lunas"/nilai transaksi, tapi pembayarannya tetap muncul di "Uang Diterima" kecuali sudah dicatat
                pengembalian dananya (koreksi/refund) lewat dialog Batalkan.
              </p>

              <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] overflow-x-auto">
                <table className="w-full text-xs min-w-[800px]">
                  <thead>
                    <tr className="border-b border-[#DBD5C1] text-left text-[#6E6853]">
                      <th className="p-2.5 font-semibold">Bulan</th>
                      <th className="p-2.5 font-semibold text-right">Pendapatan Sewa</th>
                      {hasBarangJualDataMonthly && <th className="p-2.5 font-semibold text-right">Penjualan Barang</th>}
                      {hasDiscountDataMonthly && <th className="p-2.5 font-semibold text-right">Diskon</th>}
                      <th className="p-2.5 font-semibold text-right">Denda Telat</th>
                      <th className="p-2.5 font-semibold text-right">Denda Rusak/Hilang</th>
                      {hasWaivedFeeDataMonthly && <th className="p-2.5 font-semibold text-right">Denda Dibebaskan</th>}
                      <th className="p-2.5 font-semibold text-right">Total Pemasukan</th>
                      <th className="p-2.5 font-semibold text-right">Sudah Diterima</th>
                      <th className="p-2.5 font-semibold text-right">Belum Lunas</th>
                      <th className="p-2.5 font-semibold text-right">Uang Diterima</th>
                      <th className="p-2.5 font-semibold text-right">Jumlah Transaksi</th>
                      <th className="p-2.5 font-semibold text-right">Rata-rata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRows.map((row: MonthlyReportRow) => (
                      <tr key={row.month} className={`border-b border-[#E6E1D2] last:border-0 ${row.month === highlightMonth ? 'bg-[#E8EFEA]' : ''}`}>
                        <td className="p-2.5 font-bold text-[#26302B]">{MONTH_NAMES[row.month - 1]}</td>
                        <td className="p-2.5 text-right">{formatIDR(row.pendapatanSewa)}</td>
                        {hasBarangJualDataMonthly && <td className="p-2.5 text-right">{formatIDR(row.pendapatanBarangJual)}</td>}
                        {hasDiscountDataMonthly && <td className="p-2.5 text-right text-[#A65C2A]">{formatIDR(row.diskon)}</td>}
                        <td className="p-2.5 text-right">{formatIDR(row.dendaTelat)}</td>
                        <td className="p-2.5 text-right">{formatIDR(row.dendaKerusakan)}</td>
                        {hasWaivedFeeDataMonthly && (
                          <td className="p-2.5 text-right text-[#A65C2A]">
                            {row.dendaDibebaskanJumlah > 0
                              ? `${row.dendaDibebaskanJumlah}x (${formatIDR(row.dendaDibebaskanNilai)})`
                              : '-'}
                          </td>
                        )}
                        <td className="p-2.5 text-right font-bold text-[#26302B]">{formatIDR(row.totalPemasukan)}</td>
                        <td className="p-2.5 text-right">{formatIDR(row.sudahDiterima)}</td>
                        <td className="p-2.5 text-right">{formatIDR(row.piutang)}</td>
                        <td className="p-2.5 text-right font-bold text-[#2B4739]">{formatIDR(row.uangDiterima)}</td>
                        <td className="p-2.5 text-right">{row.jumlahTransaksi}</td>
                        <td className="p-2.5 text-right">{row.rataRata == null ? '-' : formatIDR(row.rataRata)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1]">
            <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
              Periode
              <select
                value={periodMode}
                onChange={(e) => setPeriodMode(e.target.value as PeriodMode)}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
              >
                <option value="bulan">Bulan</option>
                <option value="tahun">Tahun</option>
                <option value="rentang">Rentang Tanggal</option>
              </select>
            </label>
            {periodMode === 'bulan' && (
              <>
                <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
                  Bulan
                  <select
                    value={perAlatMonth}
                    onChange={(e) => setPerAlatMonth(Number(e.target.value))}
                    className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
                  >
                    {MONTH_NAMES.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
                  Tahun
                  <input
                    type="number"
                    value={perAlatYear}
                    onChange={(e) => setPerAlatYear(Number(e.target.value) || now.getFullYear())}
                    className="w-24 px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
                  />
                </label>
              </>
            )}
            {periodMode === 'tahun' && (
              <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
                Tahun
                <input
                  type="number"
                  value={perAlatYear}
                  onChange={(e) => setPerAlatYear(Number(e.target.value) || now.getFullYear())}
                  className="w-24 px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
                />
              </label>
            )}
            {periodMode === 'rentang' && (
              <>
                <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
                  Dari
                  <input
                    type="date"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
                  Sampai
                  <input
                    type="date"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
                  />
                </label>
              </>
            )}
            <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
              Urutkan
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
              >
                <option value="pendapatan">Pendapatan</option>
                <option value="keterpakaian">Keterpakaian</option>
                <option value="jumlahSewa">Jumlah Sewa</option>
                <option value="kategori">Kategori</option>
              </select>
            </label>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || monthlyLoading || perAlatLoading}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white text-[#2B4739] border border-[#2B4739] hover:bg-[#E8EFEA] font-bold text-xs transition disabled:opacity-50 shrink-0 ml-auto"
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? 'Menyiapkan...' : 'Unduh Excel'}</span>
            </button>
          </div>

          <p className="text-[10px] text-[#6E6853] italic">
            Keterpakaian dihitung dari hari kalender ambil s/d kembali yang jatuh DI DALAM periode ini (bukan seluruh
            durasi sewa kalau sewanya melintasi batas periode), dibagi stok alat SAAT INI × jumlah hari periode —
            perubahan stok di tengah periode tidak dihitung ulang. Pendapatan per alat dihitung dari rincian alat;
            bisa sedikit berbeda dari total transaksi di tab Pemasukan per Bulan bila totalnya diubah manual oleh
            vendor.
          </p>

          {perAlatLoading ? (
            <p className="text-sm text-[#6E6853]">Memuat...</p>
          ) : (
            <>
              <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] overflow-x-auto">
                <table className="w-full text-xs min-w-[740px]">
                  <thead>
                    <tr className="border-b border-[#DBD5C1] text-left text-[#6E6853]">
                      <th className="p-2.5 font-semibold">Kategori</th>
                      <th className="p-2.5 font-semibold">Nama Alat</th>
                      <th className="p-2.5 font-semibold text-right">Jumlah Sewa</th>
                      <th className="p-2.5 font-semibold text-right">Total Unit-Hari</th>
                      <th className="p-2.5 font-semibold text-right">Pendapatan</th>
                      <th className="p-2.5 font-semibold text-right">Keterpakaian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => (
                      <tr key={row.itemId} className="border-b border-[#E6E1D2] last:border-0">
                        <td className="p-2.5 text-[#6E6853]">{row.category}</td>
                        <td className="p-2.5 font-semibold text-[#26302B]">{row.name}</td>
                        <td className="p-2.5 text-right">{row.jumlahTransaksi}</td>
                        <td className="p-2.5 text-right">{row.totalUnitHari}</td>
                        <td className="p-2.5 text-right font-bold text-[#26302B]">{formatIDR(row.pendapatan)}</td>
                        <td className="p-2.5 text-right">{formatKeterpakaianPersen(row.keterpakaianPersen)}</td>
                      </tr>
                    ))}
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-[#6E6853] italic">
                          Tidak ada transaksi pada periode ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {perAlatResult.itemsNeverRented.length > 0 && (
                <div className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1]">
                  <h3 className="text-sm font-bold text-[#26302B] mb-2">Alat Tidak Pernah Disewa di Periode Ini</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {perAlatResult.itemsNeverRented.map((i) => (
                      <span key={i.id} className="px-2 py-1 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-[10px] font-semibold text-[#6E6853]">
                        {i.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {perAlatResult.bundleSummary.length > 0 && (
                <div className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1]">
                  <h3 className="text-sm font-bold text-[#26302B] flex items-center gap-2 mb-2">
                    <Package className="w-4 h-4 text-[#2B4739]" />
                    <span>Ringkasan per Paket</span>
                  </h3>
                  <div className="space-y-1.5">
                    {perAlatResult.bundleSummary.map((b) => (
                      <div key={b.bundleName} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#26302B]">Paket {b.bundleName}</span>
                        <span className="text-[#6E6853]">
                          {b.jumlahKaliDipilih}x dipilih — <strong className="text-[#26302B]">{formatIDR(b.pendapatan)}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Barang Jual (habis pakai), v1 (brief 16 Nov 2026) --
                  ringkasan sederhana, TANPA keterpakaian (tidak ada
                  konsep okupansi untuk barang habis pakai). Cuma tampil
                  kalau ada penjualan di periode ini -- regresi aman
                  untuk rental tanpa barang jual sama sekali. */}
              {barangJualRows.length > 0 && (
                <div className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1]">
                  <h3 className="text-sm font-bold text-[#26302B] mb-2">Penjualan Barang</h3>
                  <div className="space-y-1.5">
                    {barangJualRows.map((r) => (
                      <div key={r.saleItemId} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#26302B]">{r.name}</span>
                        <span className="text-[#6E6853]">
                          {r.jumlahTerjual}x terjual — <strong className="text-[#26302B]">{formatIDR(r.pendapatan)}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
