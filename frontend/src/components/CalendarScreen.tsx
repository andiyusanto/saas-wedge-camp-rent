import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Search, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Package } from 'lucide-react';
import { useAvailability } from '../hooks/useAvailability';
import { formatIDR, todayStr } from '../utils/formatters';

const CATEGORIES = [
  'Semua',
  'Tenda',
  'Carrier & Bag',
  'Sleeping Gear',
  'Cooking Set',
  'Penerangan',
  'Matras & Layalas',
  'Aksesoris Outdoor',
  'Lainnya',
];

function shortDate(dateStr: string) {
  const [, m, d] = dateStr.split('-').map(Number);
  const weekday = new Date(`${dateStr}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short' });
  return `${weekday}, ${d}/${m}`;
}

export function CalendarScreen({
  session,
  onSelectBookItem,
}: {
  session: Session;
  onSelectBookItem: (itemId: string, startDate: string) => void;
}) {
  const [baseDate, setBaseDate] = useState(todayStr());
  const [numDays, setNumDays] = useState(7);
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, loading, error } = useAvailability(session, numDays, baseDate);

  function shiftDates(days: number) {
    const d = new Date(`${baseDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setBaseDate(`${y}-${m}-${day}`);
  }

  const filteredItems = (data?.items ?? []).filter((item) => {
    const matchesCategory = selectedCategory === 'Semua' || item.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch = item.name.toLowerCase().includes(q) || (item.code ?? '').toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div className="bg-[#FBFAF4] rounded-2xl p-4 sm:p-5 border border-[#DBD5C1] shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#26302B] flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-[#2B4739]" />
              <span>Kalender Ketersediaan Alat</span>
            </h2>
            <p className="text-xs text-[#8A8368]">Perhitungan stok dihitung realtime dari transaksi aktif.</p>
          </div>

          <div className="flex items-center space-x-2 bg-[#F1EEE2] p-1.5 rounded-xl border border-[#DBD5C1]">
            <button onClick={() => shiftDates(-1)} className="p-1.5 rounded-lg hover:bg-[#FBFAF4] text-[#26302B] transition">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={baseDate}
              onChange={(e) => setBaseDate(e.target.value)}
              className="bg-[#FBFAF4] border border-[#DBD5C1] text-[#26302B] text-xs font-semibold rounded-lg px-2.5 py-1 text-center focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
            <button
              onClick={() => setBaseDate(todayStr())}
              className="px-2 py-1 text-[11px] font-bold rounded-lg bg-[#2B4739] text-[#FBFAF4] hover:bg-[#1E3429] transition"
            >
              Hari Ini
            </button>
            <button onClick={() => shiftDates(1)} className="p-1.5 rounded-lg hover:bg-[#FBFAF4] text-[#26302B] transition">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-[#E6E1D2]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8368]" />
            <input
              type="text"
              placeholder="Cari alat (contoh: Tenda, 60L)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:border-[#2B4739] focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>
          <div className="flex items-center space-x-1 text-xs font-medium text-[#8A8368]">
            <span className="hidden sm:inline">Tampilan:</span>
            {[5, 7].map((n) => (
              <button
                key={n}
                onClick={() => setNumDays(n)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  numDays === n ? 'bg-[#2B4739] text-white' : 'bg-[#F1EEE2] text-[#26302B] hover:bg-[#E6E1D2]'
                }`}
              >
                {n} Hari
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition shrink-0 ${
                selectedCategory === cat
                  ? 'bg-[#2B4739] text-[#FBFAF4] shadow-xs'
                  : 'bg-[#F1EEE2] text-[#26302B] hover:bg-[#E6E1D2] border border-[#DBD5C1]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between text-xs text-[#8A8368] px-1 gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-[#26302B]">Status:</span>
          <span className="flex items-center gap-1 text-[#2B4739] font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-[#2B4739]" /> Tersedia
          </span>
          <span className="flex items-center gap-1 text-[#B5652E] font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-[#B5652E]" /> Sisa Sedikit
          </span>
          <span className="flex items-center gap-1 text-[#A8412E] font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-[#A8412E]" /> Penuh
          </span>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[#8A8368]">Memuat kalender...</p>
      ) : error ? (
        <p className="text-sm text-[#A8412E]">Gagal memuat kalender: {error}</p>
      ) : filteredItems.length === 0 ? (
        <div className="bg-[#FBFAF4] rounded-2xl p-8 border border-[#DBD5C1] text-center text-[#8A8368] text-sm">
          {data?.items.length === 0
            ? 'Belum ada alat. Tambahkan dulu di tab "Katalog & Stok Alat".'
            : 'Peralatan tidak ditemukan dengan kata kunci atau kategori tersebut.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="bg-[#FBFAF4] rounded-2xl p-4 border border-[#DBD5C1] shadow-xs hover:border-[#2B4739]/50 transition"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start space-x-3 min-w-[240px]">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="w-14 h-14 rounded-xl object-cover border border-[#DBD5C1] shrink-0 bg-[#F1EEE2]" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl border border-[#DBD5C1] shrink-0 bg-[#F1EEE2] flex items-center justify-center text-[#8A8368]">
                      <Package className="w-5 h-5" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center space-x-2">
                      {item.code && (
                        <span className="px-2 py-0.5 rounded-md bg-[#2B4739]/10 text-[#2B4739] font-mono text-[11px] font-bold border border-[#2B4739]/20">
                          {item.code}
                        </span>
                      )}
                      {item.category && <span className="text-[11px] font-medium text-[#8A8368]">{item.category}</span>}
                    </div>
                    <h3 className="font-bold text-sm text-[#26302B] mt-0.5">{item.name}</h3>
                    <div className="flex items-center space-x-3 text-xs mt-1">
                      <span className="font-semibold text-[#2B4739]">
                        {formatIDR(item.price_per_day)} <span className="text-[10px] font-normal text-[#8A8368]">/hari</span>
                      </span>
                      <span className="text-[#DBD5C1]">|</span>
                      <span className="text-[#8A8368]">
                        Stok: <strong className="text-[#26302B]">{item.total_units}</strong> unit
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-x-auto pb-1 scrollbar-none">
                  <div className="flex items-center gap-2 min-w-max">
                    {(data?.days ?? []).map((dateStr, i) => {
                      const remaining = item.remaining[i];
                      const status = item.status[i];
                      const styles =
                        status === 'penuh'
                          ? 'bg-[#FAF0EE] text-[#A8412E] border-[#A8412E]/30'
                          : status === 'sisa_sedikit'
                            ? 'bg-[#F9EFE7] text-[#B5652E] border-[#B5652E]/30'
                            : 'bg-[#E8EFEA] text-[#2B4739] border-[#2B4739]/30';
                      const countBg =
                        status === 'penuh' ? 'bg-[#A8412E] text-white' : status === 'sisa_sedikit' ? 'bg-[#B5652E] text-white' : 'bg-[#2B4739] text-[#FBFAF4]';

                      return (
                        <div key={dateStr} className={`flex flex-col items-center p-2 rounded-xl border min-w-[64px] text-center ${styles}`}>
                          <span className="text-[10px] font-medium opacity-80">{shortDate(dateStr)}</span>
                          <div className={`mt-1 w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${countBg}`}>
                            {remaining}
                          </div>
                          <span className="text-[9px] mt-1 font-semibold opacity-90">
                            {status === 'penuh' ? 'HABIS' : `Sisa ${remaining}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-end shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#E6E1D2]">
                  <button
                    onClick={() => onSelectBookItem(item.id, baseDate)}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-[#FBFAF4] text-xs font-semibold shadow-xs transition active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Sewa Alat Ini</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
