import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { History, Receipt, Wallet, AlertCircle, CalendarClock, Download, Search, Package, ChevronDown, ChevronUp, X, MoreVertical } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { useHistory } from '../hooks/useHistory';
import { StatCard } from './StatCard';
import { formatDateIndo, formatIDR, bookingStatusLabel, computeRemainingBalance } from '../utils/formatters';
import type { ReceiptData } from '../utils/formatters';
import { computeHistorySummary, downloadHistoryExcel } from '../utils/historyExport';
import { LaporanScreen } from './LaporanScreen';
import { PaymentModal } from './PaymentModal';
import { InvoiceModal } from './InvoiceModal';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabaseClient';
import type { HistoryBooking } from '../hooks/useHistory';

function firstDayOfMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayStrLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_BADGE: Record<string, string> = {
  dipesan: 'bg-[#F9EFE7] text-[#A65C2A] border-[#A65C2A]/30',
  aktif: 'bg-[#E8EFEA] text-[#2B4739] border-[#2B4739]/30',
  telat: 'bg-[#A8412E] text-white border-[#A8412E]',
  selesai: 'bg-[#F1EEE2] text-[#6E6853] border-[#DBD5C1]',
  dibatalkan: 'bg-white text-[#6E6853] border-[#DBD5C1] line-through',
};

// Pelunasan + Nota Cetak Ulang + Batalkan/Void (brief 17 Nov 2026) --
// data tambahan (deposits/pembayaran/batas jam kembali) yang TIDAK ikut
// query paginasi utama useHistory (supaya tidak membengkakkan fetch yang
// bisa jadi ribuan baris) -- diambil on-demand cuma saat tombol Nota
// ditekan, langsung lewat supabase (RLS member-select, bukan Express).
async function fetchReceiptExtras(bookingId: string): Promise<{
  deposits: { type: string; note: string | null; status: string }[];
  payments: { amount: number; method: string | null; kind: string; note: string | null; paid_at: string }[];
  returnDeadlineTime: string | null;
  returnDeadlineNextDay: boolean | null;
} | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'return_deadline_time, return_deadline_next_day, deposits(type, note, status), booking_payments(amount, method, kind, note, paid_at)',
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    deposits: (data.deposits ?? []) as { type: string; note: string | null; status: string }[],
    payments: (data.booking_payments ?? []) as { amount: number; method: string | null; kind: string; note: string | null; paid_at: string }[],
    returnDeadlineTime: data.return_deadline_time ?? null,
    returnDeadlineNextDay: data.return_deadline_next_day ?? null,
  };
}

export function HistoryScreen({
  businessId,
  session,
  businessName,
  businessAddress,
  businessLogoUrl,
}: {
  businessId: string;
  session: Session;
  businessName: string;
  businessAddress?: string | null;
  businessLogoUrl?: string | null;
}) {
  // Sub-tab "Laporan" (brief 16 Nov 2026) -- pemasukan per bulan + per
  // alat, cuma memakai data yang sudah tersimpan. Owner-only otomatis
  // (seluruh HistoryScreen sudah digerbang role==='owner' di App.tsx),
  // tidak perlu gerbang tambahan di sini.
  const [screenTab, setScreenTab] = useState<'transaksi' | 'laporan'>('transaksi');
  const [from, setFrom] = useState(firstDayOfMonthStr);
  const [to, setTo] = useState(todayStrLocal);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('semua');
  // Batalkan/Void (brief 17 Nov 2026) -- Riwayat SEKARANG default
  // menyembunyikan transaksi dibatalkan (sebelumnya "Semua" menampilkan
  // semuanya termasuk dibatalkan) -- checkbox ini membatalkan
  // penyembunyian itu, TERPISAH dari dropdown Status yang tetap bisa
  // memilih "Dibatalkan" secara eksplisit kapan saja.
  const [showCancelled, setShowCancelled] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<HistoryBooking | null>(null);
  const [voidTarget, setVoidTarget] = useState<HistoryBooking | null>(null);
  // "Batalkan" dipindah ke menu "⋯" per baris (koordinator 17 Nov 2026) --
  // tombol merah di tiap baris rawan tertekan, termasuk pada transaksi
  // Selesai. Cuma satu baris bisa buka menunya sekaligus.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [invoiceData, setInvoiceData] = useState<ReceiptData | null>(null);
  const [notaLoadingId, setNotaLoadingId] = useState<string | null>(null);

  const { bookings, dueTodayCount, loading, error, refresh } = useHistory(businessId, from, to);

  const filtered = bookings.filter((b) => {
    const matchesStatus = statusFilter === 'semua' || b.status === statusFilter;
    const matchesCancelledVisibility = showCancelled || statusFilter === 'dibatalkan' || b.status !== 'dibatalkan';
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (b.customer?.name ?? '').toLowerCase().includes(q) || (b.booking_number ?? '').toLowerCase().includes(q);
    return matchesStatus && matchesCancelledVisibility && matchesSearch;
  });

  async function openNota(b: HistoryBooking) {
    setNotaLoadingId(b.id);
    const extras = await fetchReceiptExtras(b.id);
    setNotaLoadingId(null);
    const activeDeposit = extras?.deposits.find((d) => d.status === 'ditahan') ?? extras?.deposits[0];
    setInvoiceData({
      bookingNumber: b.booking_number ?? '-',
      customerName: b.customer?.name ?? '-',
      customerPhone: b.customer?.phone ?? '',
      startDate: b.start_date,
      endDate: b.end_date,
      items: b.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        price_per_day: i.price_at_booking,
        subtotal: i.subtotal,
        bundle_instance_id: i.bundle_instance_id,
        bundle_name: i.bundle_name,
      })),
      saleItems: b.saleItems.map((s) => ({ name: s.name, quantity: s.quantity, unitPrice: s.price_at_booking, subtotal: s.subtotal })),
      totalPrice: b.total_price,
      dpPaid: b.dp_paid,
      depositType: activeDeposit?.type ?? null,
      depositNote: activeDeposit?.note ?? null,
      depositStatus: (activeDeposit?.status as 'ditahan' | 'dikembalikan' | null) ?? null,
      status: b.status,
      fines: b.penalties.map((p) => ({ type: p.type, amount: p.amount })),
      businessName,
      businessAddress,
      businessLogoUrl,
      rentalDayMode: b.rental_day_mode,
      returnDeadlineTime: extras?.returnDeadlineTime ?? null,
      returnDeadlineNextDay: extras?.returnDeadlineNextDay ?? null,
      payments: (extras?.payments ?? []).map((p) => ({ amount: p.amount, method: p.method, kind: p.kind, note: p.note, paidAt: p.paid_at })),
      isReprint: true,
      reprintedAt: todayStrLocal(),
    });
  }

  // Transaksi dibatalkan sengaja dikecualikan dari KPI ini — batal artinya
  // transaksinya tidak pernah benar-benar terjadi, jadi tidak boleh ikut
  // dihitung sebagai volume/omset/piutang. Daftar di bawah tetap
  // menampilkan status dibatalkan (riwayat tetap lengkap), cuma angka
  // ringkasan di atas yang menyaringnya. computeHistorySummary() dipakai
  // juga oleh export Excel (utils/historyExport.ts) — fungsi yang sama,
  // supaya kalau filter status/pencarian lagi "semua"/kosong, angka di
  // sheet Ringkasan dijamin identik dengan StatCard di sini (bukan dua
  // salinan rumus yang bisa diam-diam beda).
  const nonCancelled = bookings.filter((b) => b.status !== 'dibatalkan');
  const { totalTransaksi, sudahDiterima, piutang } = computeHistorySummary(nonCancelled);

  // Peralatan terlaris — dijumlah dari transaksi non-batal pada rentang
  // yang sama dengan KPI di atas, bukan flat sepanjang waktu. Dikelompokkan
  // per item_id dulu (bukan cuma nama, supaya tidak salah gabung kalau ada
  // dua alat kebetulan senama), lalu dikelompokkan lagi per kategori.
  const itemsMap = new Map<
    string,
    { name: string; category: string; variant: string | null; size: string | null; color: string | null; totalQuantity: number }
  >();
  for (const b of nonCancelled) {
    for (const item of b.items) {
      const key = item.item_id ?? item.name;
      const existing = itemsMap.get(key);
      if (existing) {
        existing.totalQuantity += item.quantity;
      } else {
        itemsMap.set(key, {
          name: item.name,
          category: item.category ?? 'Lainnya',
          variant: item.variant,
          size: item.size,
          color: item.color,
          totalQuantity: item.quantity,
        });
      }
    }
  }

  const categoryMap = new Map<
    string,
    { category: string; totalQuantity: number; items: { key: string; name: string; variant: string | null; size: string | null; color: string | null; totalQuantity: number }[] }
  >();
  for (const [key, item] of itemsMap) {
    const group = categoryMap.get(item.category);
    const entry = { key, name: item.name, variant: item.variant, size: item.size, color: item.color, totalQuantity: item.totalQuantity };
    if (group) {
      group.totalQuantity += item.totalQuantity;
      group.items.push(entry);
    } else {
      categoryMap.set(item.category, { category: item.category, totalQuantity: item.totalQuantity, items: [entry] });
    }
  }
  const categoryGroups = [...categoryMap.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => b.totalQuantity - a.totalQuantity) }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

  // Nama variabel "expanded" (bukan "collapsed") supaya default state
  // (Set kosong) berarti "semua tertutup" — dibuka sekali per kategori
  // pas pertama kali halaman ini dibuka, bukan otomatis semua terbuka.
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  function toggleCategory(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await downloadHistoryExcel(filtered, { from, to, statusFilter, searchQuery });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
              <History className="w-5 h-5 text-[#2B4739]" />
              <span>Riwayat Transaksi</span>
            </h2>
            <p className="text-xs text-[#6E6853]">Rekap semua transaksi, termasuk yang sudah selesai atau dibatalkan.</p>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-[#E6E1D2]">
          {(['transaksi', 'laporan'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setScreenTab(tab)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                screenTab === tab ? 'bg-[#2B4739] text-[#FBFAF4] shadow-xs' : 'bg-[#F1EEE2] text-[#26302B] border border-[#DBD5C1] hover:bg-[#E6E1D2]'
              }`}
            >
              {tab === 'transaksi' ? 'Transaksi' : 'Laporan'}
            </button>
          ))}
        </div>

        {screenTab === 'transaksi' && (
        <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-[#E6E1D2]">
          <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
            Dari
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
            />
            {from && <span className="text-[10px] text-[#6E6853]">{formatDateIndo(from, true)}</span>}
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
            Sampai
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
            />
            {to && <span className="text-[10px] text-[#6E6853]">{formatDateIndo(to, true)}</span>}
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
            >
              <option value="semua">Semua</option>
              <option value="dipesan">Siap Diambil</option>
              <option value="aktif">Sedang Disewa</option>
              <option value="telat">Terlambat</option>
              <option value="selesai">Selesai</option>
              <option value="dibatalkan">Dibatalkan</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[#6E6853] pt-5">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            Tampilkan dibatalkan
          </label>
          <div className="relative flex-1 min-w-[180px]">
            <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
              Cari
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6E6853]" />
                <input
                  type="text"
                  placeholder="Nama / kode booking..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
                />
              </div>
            </label>
          </div>
          <div className="flex flex-col sm:items-end gap-1 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleExport}
              disabled={filtered.length === 0 || exporting}
              className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-xs border transition shrink-0 w-full sm:w-auto ${
                filtered.length === 0 || exporting
                  ? 'bg-[#F1EEE2] text-[#6E6853] border-[#DBD5C1] cursor-not-allowed'
                  : 'bg-white text-[#2B4739] border-[#2B4739] hover:bg-[#E8EFEA]'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? 'Menyiapkan...' : 'Unduh Excel'}</span>
            </button>
            <span className="text-[10px] text-[#6E6853]">{filtered.length} transaksi sesuai filter</span>
          </div>
        </div>
        )}
      </div>

      {screenTab === 'laporan' ? (
        <LaporanScreen businessId={businessId} />
      ) : (
      <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Transaksi" value={totalTransaksi} color="primary" icon={Receipt} sub={`${from} s/d ${to}`} />
        <StatCard label="Sudah Diterima" value={formatIDR(sudahDiterima)} color="primary" icon={Wallet} sub="Total DP/pembayaran" isText />
        <StatCard label="Piutang" value={formatIDR(piutang)} color="warning" icon={AlertCircle} sub="Belum lunas" isText />
        <StatCard label="Jatuh Tempo Hari Ini" value={dueTodayCount} color="danger" icon={CalendarClock} sub="Harus kembali hari ini" />
      </div>

      {!loading && categoryGroups.length > 0 && (
        <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-xs p-4 sm:p-5">
          <h3 className="text-sm font-bold text-[#26302B] flex items-center gap-2 mb-3">
            <Package className="w-4 h-4 text-[#2B4739]" />
            <span>Peralatan Terlaris Disewa</span>
          </h3>
          <div className="space-y-2">
            {categoryGroups.map((group, gi) => {
              const isCollapsed = !expandedCategories.has(group.category);
              return (
                <div key={group.category} className="rounded-xl border border-[#DBD5C1] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCategory(group.category)}
                    className="w-full flex items-center justify-between gap-3 p-2.5 bg-[#F1EEE2] hover:bg-[#E6E1D2] transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-[#2B4739] text-white font-bold text-[10px] flex items-center justify-center">
                        {String(gi + 1).padStart(2, '0')}
                      </span>
                      <span className="text-xs font-bold text-[#26302B] uppercase tracking-wide truncate">{group.category}</span>
                      {isCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-[#6E6853] shrink-0" /> : <ChevronUp className="w-3.5 h-3.5 text-[#6E6853] shrink-0" />}
                    </div>
                    <span className="shrink-0 px-2.5 py-1 rounded-lg bg-white border border-[#DBD5C1] text-xs font-bold text-[#2B4739]">
                      {group.totalQuantity} unit
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y divide-[#E6E1D2] bg-white">
                      {group.items.map((item) => {
                        const attrLine = [
                          item.variant && `Varian: ${item.variant}`,
                          item.size && `Ukuran: ${item.size}`,
                          item.color && `Warna: ${item.color}`,
                        ]
                          .filter(Boolean)
                          .join('   •   ');
                        return (
                          <div key={item.key} className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[#26302B] truncate">{item.name}</p>
                              {attrLine && <p className="text-[10px] text-[#6E6853] truncate">{attrLine}</p>}
                            </div>
                            <span className="shrink-0 text-xs font-bold text-[#6E6853]">{item.totalQuantity} unit</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[#6E6853]">Memuat...</p>
      ) : error ? (
        <p className="text-sm text-[#A8412E]">Gagal memuat: {error}</p>
      ) : filtered.length === 0 ? (
        <div className="bg-[#FBFAF4] rounded-2xl p-8 border border-[#DBD5C1] text-center text-[#6E6853] text-sm">
          Tidak ada transaksi pada rentang/filter ini.
        </div>
      ) : (
        <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-xs overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-[#DBD5C1] text-left text-[#6E6853]">
                <th className="p-3 font-semibold">Booking</th>
                <th className="p-3 font-semibold">Penyewa</th>
                <th className="p-3 font-semibold">Tanggal</th>
                <th className="p-3 font-semibold">Alat</th>
                <th className="p-3 font-semibold text-right">Total Tagihan</th>
                <th className="p-3 font-semibold text-right">Sisa Tagihan</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const totalFines = b.penalties.reduce((sum, p) => sum + p.amount, 0);
                const remaining = computeRemainingBalance(b.total_price, totalFines, b.dp_paid);
                // "Total Tagihan" (koordinator 17 Nov 2026) = Total Harga + semua
                // denda -- sumber SAMA dengan computeRemainingBalance()/Nota
                // (bukan rumus baru), supaya tidak membingungkan saat ada denda
                // (sebelumnya kolom "Total" cuma total_price, beda jauh dari
                // Sisa Tagihan yang sudah termasuk denda).
                const totalTagihan = b.total_price + totalFines;
                return (
                  <tr key={b.id} className="border-b border-[#E6E1D2] last:border-0 align-top">
                    <td className="p-3 font-mono font-bold text-[#2B4739]">{b.booking_number ?? '-'}</td>
                    <td className="p-3">
                      <p className="font-semibold text-[#26302B]">{b.customer?.name ?? '-'}</p>
                      {b.customer?.phone && <p className="text-[#6E6853]">{b.customer.phone}</p>}
                    </td>
                    <td className="p-3 text-[#6E6853] whitespace-nowrap">
                      {formatDateIndo(b.start_date, false)} – {formatDateIndo(b.end_date, false)}
                    </td>
                    <td className="p-3 text-[#6E6853]">{b.items.map((i) => `${i.name} (${i.quantity}x)`).join(', ')}</td>
                    <td className="p-3 text-right font-bold text-[#26302B] whitespace-nowrap">
                      {formatIDR(totalTagihan)}
                      {totalFines > 0 && <p className="text-[10px] font-normal text-[#6E6853]">termasuk denda {formatIDR(totalFines)}</p>}
                    </td>
                    <td
                      className={`p-3 text-right font-bold whitespace-nowrap ${
                        remaining > 0 ? 'text-[#A8412E]' : remaining < 0 ? 'text-[#A65C2A]' : 'text-[#2B4739]'
                      }`}
                    >
                      {remaining > 0 ? formatIDR(remaining) : remaining < 0 ? `Lebih ${formatIDR(Math.abs(remaining))}` : 'LUNAS'}
                    </td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${STATUS_BADGE[b.status] ?? ''}`}>
                        {bookingStatusLabel(b.status)}
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openNota(b)}
                          disabled={notaLoadingId === b.id}
                          className="text-[11px] font-bold text-[#2B4739] underline disabled:opacity-50"
                        >
                          {notaLoadingId === b.id ? '...' : 'Nota'}
                        </button>
                        {/* Perbaikan koordinator 17 Nov 2026: "Bayar" cuma
                            relevan kalau masih ada sisa (remaining>0) --
                            Lebih Bayar (remaining<0) ditawari "Pengembalian"
                            (koreksi/refund), bukan "Bayar", karena tidak ada
                            yang perlu dibayar lagi. */}
                        {remaining > 0 && b.status !== 'dibatalkan' && (
                          <button
                            type="button"
                            onClick={() => setPaymentTarget(b)}
                            className="text-[11px] font-bold text-[#2B4739] underline"
                          >
                            Bayar
                          </button>
                        )}
                        {remaining < 0 && b.status !== 'dibatalkan' && (
                          <button
                            type="button"
                            onClick={() => setPaymentTarget(b)}
                            className="text-[11px] font-bold text-[#A65C2A] underline"
                          >
                            Pengembalian
                          </button>
                        )}
                        {/* "Batalkan" dipindah ke menu "⋯" (koordinator 17 Nov
                            2026) -- tombol merah di tiap baris rawan tertekan,
                            termasuk pada transaksi Selesai. Menu cuma muncul
                            untuk yang berhak membatalkan (status belum
                            dibatalkan -- RLS/Express tetap penegak aturan
                            owner-untuk-status-tertutup yang sebenarnya). */}
                        {b.status !== 'dibatalkan' && (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setOpenMenuId(openMenuId === b.id ? null : b.id)}
                              aria-label="Menu lainnya"
                              className="w-10 h-10 -m-1 flex items-center justify-center rounded-lg text-[#6E6853] hover:bg-[#F1EEE2] transition"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {openMenuId === b.id && (
                              <>
                                <button
                                  type="button"
                                  aria-label="Tutup menu"
                                  onClick={() => setOpenMenuId(null)}
                                  className="fixed inset-0 z-10 cursor-default"
                                />
                                <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-white rounded-xl border border-[#DBD5C1] shadow-lg py-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      setVoidTarget(b);
                                    }}
                                    className="w-full text-left px-3 py-2.5 text-xs font-bold text-[#A8412E] hover:bg-[#FAF0EE]"
                                  >
                                    Batalkan transaksi…
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}

      <PaymentModal
        isOpen={paymentTarget !== null}
        onClose={() => setPaymentTarget(null)}
        remaining={
          paymentTarget
            ? computeRemainingBalance(
                paymentTarget.total_price,
                paymentTarget.penalties.reduce((sum, p) => sum + p.amount, 0),
                paymentTarget.dp_paid,
              )
            : 0
        }
        mode={
          paymentTarget &&
          computeRemainingBalance(
            paymentTarget.total_price,
            paymentTarget.penalties.reduce((sum, p) => sum + p.amount, 0),
            paymentTarget.dp_paid,
          ) < 0
            ? 'refund'
            : 'bayar'
        }
        onSubmit={async (body) => {
          try {
            await apiFetch(session, `/api/bookings/${paymentTarget!.id}/payments`, {
              method: 'POST',
              body: JSON.stringify(body),
            });
            await refresh();
            return { error: null };
          } catch (err) {
            return { error: (err as Error).message };
          }
        }}
      />

      <InvoiceModal isOpen={invoiceData !== null} onClose={() => setInvoiceData(null)} data={invoiceData} />

      <VoidModal
        booking={voidTarget}
        session={session}
        onClose={() => setVoidTarget(null)}
        onDone={() => {
          setVoidTarget(null);
          refresh();
        }}
      />
    </div>
  );
}

// Batalkan/Void (brief 17 Nov 2026) — HistoryScreen SUDAH digerbang
// role==='owner' di App.tsx, jadi tidak perlu cek owner lagi di sini;
// alasan WAJIB cuma kalau status transaksi sudah selesai/telat (backend
// menegakkan ulang, ini cuma UX) — status dipesan/aktif tetap perilaku
// lama (alasan opsional). Kalau ada pembayaran tercatat, tawarkan
// "Catat pengembalian dana" (kind='koreksi', boleh pada booking
// dibatalkan sejak revisi migration 067) sebagai langkah terpisah
// SETELAH cancel sukses -- supaya "Uang diterima" di Laporan tetap jujur.
function VoidModal({
  booking,
  session,
  onClose,
  onDone,
}: {
  booking: HistoryBooking | null;
  session: Session;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  if (!booking) return null;
  const reasonRequired = booking.status === 'selesai' || booking.status === 'telat';
  const hasPayments = booking.dp_paid > 0;

  async function handleCancel() {
    if (reasonRequired && !reason.trim()) {
      setError('Alasan wajib diisi untuk membatalkan transaksi yang sudah selesai/terlambat');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(session, `/api/bookings/${booking!.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      setCancelled(true);
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  async function handleRefund() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(session, `/api/bookings/${booking!.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: -booking!.dp_paid,
          kind: 'koreksi',
          note: `Refund pembatalan${reason.trim() ? `: ${reason.trim()}` : ''}`,
        }),
      });
      handleClose();
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  function handleClose() {
    setReason('');
    setRefund(true);
    setCancelled(false);
    setError(null);
    onDone();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-white w-full max-w-sm rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden">
        <div className="bg-[#A8412E] px-5 py-4 text-white flex items-center justify-between">
          <h2 className="text-lg font-bold">Batalkan Transaksi</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          {!cancelled ? (
            <>
              <p className="text-[#26302B]">
                Transaksi <strong>{booking.booking_number ?? booking.customer?.name}</strong> (status{' '}
                <strong>{bookingStatusLabel(booking.status)}</strong>) akan dibatalkan. Tidak bisa dibatalkan ulang/dihapus permanen.
              </p>
              {hasPayments && (
                <p className="text-[#A65C2A] text-xs font-bold">
                  Ada pembayaran {formatIDR(booking.dp_paid)} tercatat — pastikan sudah dikembalikan ke pelanggan. Pembayaran TIDAK
                  dihapus otomatis.
                </p>
              )}
              <div>
                <label className="block text-xs font-bold text-[#6E6853] mb-1">
                  Alasan {reasonRequired ? '(wajib)' : '(opsional)'}
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-[#DBD5C1] text-sm"
                />
              </div>
              {error && <p className="text-xs text-[#A8412E] font-bold">{error}</p>}
              <button
                type="button"
                disabled={saving}
                onClick={handleCancel}
                className="w-full py-2.5 rounded-xl bg-[#A8412E] text-white font-bold text-sm disabled:opacity-50"
              >
                {saving ? 'Membatalkan...' : 'Batalkan Transaksi'}
              </button>
            </>
          ) : (
            <>
              <p className="text-[#2B4739] font-bold">Transaksi sudah dibatalkan.</p>
              {hasPayments && (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-[#6E6853]">
                    <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
                    Catat pengembalian dana {formatIDR(booking.dp_paid)} ke pelanggan sekarang
                  </label>
                  {error && <p className="text-xs text-[#A8412E] font-bold">{error}</p>}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={refund ? handleRefund : handleClose}
                    className="w-full py-2.5 rounded-xl bg-[#2B4739] text-white font-bold text-sm disabled:opacity-50"
                  >
                    {saving ? 'Menyimpan...' : refund ? 'Catat Pengembalian & Selesai' : 'Selesai'}
                  </button>
                </>
              )}
              {!hasPayments && (
                <button type="button" onClick={handleClose} className="w-full py-2.5 rounded-xl bg-[#2B4739] text-white font-bold text-sm">
                  Selesai
                </button>
              )}
            </>
          )}
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
