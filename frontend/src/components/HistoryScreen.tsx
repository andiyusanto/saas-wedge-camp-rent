import { useState } from 'react';
import { History, Receipt, Wallet, AlertCircle, CalendarClock, Download, Search, Package, ChevronDown, ChevronUp } from 'lucide-react';
import { useHistory } from '../hooks/useHistory';
import { StatCard } from './StatCard';
import { formatDateIndo, formatIDR, bookingStatusLabel } from '../utils/formatters';
import { computeHistorySummary, downloadHistoryExcel } from '../utils/historyExport';

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

export function HistoryScreen({ businessId }: { businessId: string }) {
  const [from, setFrom] = useState(firstDayOfMonthStr);
  const [to, setTo] = useState(todayStrLocal);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('semua');

  const { bookings, dueTodayCount, loading, error } = useHistory(businessId, from, to);

  const filtered = bookings.filter((b) => {
    const matchesStatus = statusFilter === 'semua' || b.status === statusFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (b.customer?.name ?? '').toLowerCase().includes(q) || (b.booking_number ?? '').toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

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
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0 || exporting}
            className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-xs shadow-sm transition shrink-0 ${
              filtered.length === 0 || exporting
                ? 'bg-[#F1EEE2] text-[#6E6853] cursor-not-allowed'
                : 'bg-[#2B4739] hover:bg-[#1E3429] text-white'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>{exporting ? 'Menyiapkan...' : 'Unduh Excel'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-[#E6E1D2]">
          <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
            Dari
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#6E6853]">
            Sampai
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs"
            />
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
        </div>
      </div>

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
                <th className="p-3 font-semibold text-right">Total</th>
                <th className="p-3 font-semibold text-right">Sisa Tagihan</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const remaining = Math.max(0, b.total_price - b.dp_paid);
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
                    <td className="p-3 text-right font-bold text-[#26302B] whitespace-nowrap">{formatIDR(b.total_price)}</td>
                    <td className={`p-3 text-right font-bold whitespace-nowrap ${remaining > 0 ? 'text-[#A8412E]' : 'text-[#2B4739]'}`}>
                      {remaining > 0 ? formatIDR(remaining) : 'LUNAS'}
                    </td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${STATUS_BADGE[b.status] ?? ''}`}>
                        {bookingStatusLabel(b.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
