import { useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Search, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Package, ChevronDown, ChevronUp, X, Clock } from 'lucide-react';
import { useAvailability } from '../hooks/useAvailability';
import { useBundles } from '../hooks/useBundles';
import { computeBundleAvailability, computeBundleDayOnePrice, resolveBundleImageUrl } from '../utils/bundleAvailability';
import { formatIDR, formatDateIndo, todayStr, formatOverdueLabel } from '../utils/formatters';
import { ScrollableRow } from './ScrollableRow';
import { ImagePreviewModal } from './ImagePreviewModal';

const PAKET_COLLAPSE_KEY = 'sewalog_kalender_paket_collapsed_v1';

function readPaketCollapsed(): boolean {
  try {
    return localStorage.getItem(PAKET_COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePaketCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(PAKET_COLLAPSE_KEY, '1');
    else localStorage.removeItem(PAKET_COLLAPSE_KEY);
  } catch {
    // localStorage bisa gagal (private window, dll) -- aman diabaikan, cuma
    // berarti status lipat tidak diingat lintas sesi di perangkat itu.
  }
}

// Pemberitahuan sekali tampil Opsi B (brief 17 Nov 2026) -- ditutup sekali,
// tidak muncul lagi di perangkat itu (localStorage, key BERVERSI supaya
// bisa ditampilkan ulang lagi nanti kalau isinya berubah signifikan).
const STOK_AKTIF_NOTICE_KEY = 'sewalog_notice_stok_aktif_v1';

function readStokAktifNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(STOK_AKTIF_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissStokAktifNotice() {
  try {
    localStorage.setItem(STOK_AKTIF_NOTICE_KEY, '1');
  } catch {
    // localStorage bisa gagal -- aman diabaikan, cuma berarti notice ini
    // muncul lagi di reload berikutnya di perangkat itu.
  }
}

// Format tanggal diseragamkan dd-mm-yyyy (keputusan Andi 10 Nov 2026) —
// pakai formatDateIndo() terpusat (rakit manual, bukan Intl/
// toLocaleDateString), bukan lagi "Sel, 10/11" ad-hoc di sini.
function shortDate(dateStr: string) {
  return formatDateIndo(dateStr, true);
}

// Chip kategori "📦 Paket" (17 Nov 2026) -- pola SAMA PERSIS dengan Etalase
// Online (routes/etalase.ts, PAKET_SENTINEL): kalau vendor kebetulan punya
// kategori ALAT literal bernama "Paket" (case-insensitive), dilebur ke chip
// sentinel yang sama, bukan dua chip terpisah berlabel sama.
const PAKET_SENTINEL = '__paket__';

export function CalendarScreen({
  session,
  businessId,
  onSelectBookItem,
  onSelectBookBundle,
  pendingRequestCount = 0,
  onViewPendingRequests,
  onViewOverdue,
  onNavigateToGuide,
  writable = true,
}: {
  session: Session;
  businessId: string;
  onSelectBookItem: (itemId: string, startDate: string) => void;
  // Grup "Paket" (17 Nov 2026) -- jalur TERPISAH dari onSelectBookItem,
  // sama pola, bundle bukan item.
  onSelectBookBundle: (bundleId: string, startDate: string) => void;
  // Rencana langganan: "Sewa Alat Ini" membuka Catat Transaksi baru —
  // dikunci kalau hanya-baca (RLS bookings INSERT tetap penegak
  // sebenarnya, migration 044).
  writable?: boolean;
  // Rencana tahap 4 bagian C: banner di layar pertama setelah login,
  // membawa ke bagian "Pesanan masuk" (tab Transaksi Aktif).
  pendingRequestCount?: number;
  onViewPendingRequests?: () => void;
  // Label "Telat, N unit terkunci..." (koordinator 17 Nov 2026) -- JALUR
  // TERPISAH dari onViewPendingRequests: membuka Transaksi Aktif dengan
  // filter Terlambat SUDAH aktif, bukan cuma membuka tab-nya apa adanya.
  onViewOverdue?: () => void;
  // Opsi B Tahap 2 (brief 17 Nov 2026) -- link "Pelajari" di notice + label
  // "Telat" membawa ke Panduan bagian Kalender (pola sama TrackingScreen.tsx
  // -> onNavigateToGuide).
  onNavigateToGuide?: (sectionId: string) => void;
}) {
  const [baseDate, setBaseDate] = useState(todayStr());
  const [numDays, setNumDays] = useState(7);
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [paketCollapsed, setPaketCollapsed] = useState(readPaketCollapsed);
  const [expandedBundleId, setExpandedBundleId] = useState<string | null>(null);
  const [stokAktifNoticeDismissed, setStokAktifNoticeDismissed] = useState(readStokAktifNoticeDismissed);

  const { data, loading, error } = useAvailability(session, numDays, baseDate);
  const { bundles } = useBundles(businessId);

  const bundleAvailabilities = useMemo(() => {
    if (!data?.items) return [];
    return bundles
      .map((bundle) => ({ bundle, availability: computeBundleAvailability(bundle, data.items) }))
      .filter((b) => b.availability.allComponentsActive);
  }, [bundles, data?.items]);

  function togglePaketCollapsed() {
    setPaketCollapsed((prev) => {
      const next = !prev;
      writePaketCollapsed(next);
      return next;
    });
  }

  const hasBundles = bundleAvailabilities.length > 0;
  // Kategori alat literal "Paket" (case-insensitive) dilebur ke chip sentinel
  // yang sama -- lihat PAKET_SENTINEL di atas, pola persis Etalase.
  const hasLiteralPaketCategoryCollision =
    hasBundles && (data?.items ?? []).some((i) => (i.category ?? '').trim().toLowerCase() === 'paket');
  function categoryOf(item: { category: string | null }): string {
    if (hasLiteralPaketCategoryCollision && (item.category ?? '').trim().toLowerCase() === 'paket') return PAKET_SENTINEL;
    return item.category ?? '';
  }

  // Diturunkan live dari katalog sendiri (sama seperti ItemsScreen.tsx) —
  // tiap vendor punya kategori sendiri, bukan daftar tetap satu untuk semua.
  const categories = useMemo(() => {
    const values = new Set(
      (data?.items ?? [])
        .map((i) => i.category)
        .filter((v): v is string => !!v)
        .filter((c) => !(hasLiteralPaketCategoryCollision && c.trim().toLowerCase() === 'paket')),
    );
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [data?.items, hasLiteralPaketCategoryCollision]);

  function shiftDates(days: number) {
    const d = new Date(`${baseDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setBaseDate(`${y}-${m}-${day}`);
  }

  const isPaketFilterActive = selectedCategory === PAKET_SENTINEL;
  // Grup "Paket" tampil di "Semua" (ikut status lipat tersimpan) DAN di chip
  // "📦 Paket" sendiri (dipaksa terbuka, TANPA mengubah status lipat
  // tersimpan) -- disembunyikan total di chip kategori alat lain.
  const showPaketGroup = hasBundles && (selectedCategory === 'Semua' || isPaketFilterActive);
  const paketGroupForcedOpen = isPaketFilterActive;

  const filteredItems = isPaketFilterActive
    ? []
    : (data?.items ?? []).filter((item) => {
        const matchesCategory = selectedCategory === 'Semua' || categoryOf(item) === selectedCategory;
        const q = searchQuery.toLowerCase();
        const matchesSearch = item.name.toLowerCase().includes(q) || (item.code ?? '').toLowerCase().includes(q);
        return matchesCategory && matchesSearch;
      });

  // Kotak "Cari alat" juga mencari nama paket (brief 17 Nov 2026).
  const filteredBundleAvailabilities = showPaketGroup
    ? bundleAvailabilities.filter(({ bundle }) => bundle.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  return (
    <div className="space-y-6">
      {pendingRequestCount > 0 && (
        <button
          onClick={onViewPendingRequests}
          className="w-full text-left bg-[#A65C2A]/12 border border-[#A65C2A]/40 rounded-2xl px-4 py-3 flex items-center justify-between gap-2 hover:bg-[#A65C2A]/20 transition"
        >
          <span className="text-sm font-bold text-[#A65C2A]">
            🔔 {pendingRequestCount} pesanan online menunggu konfirmasi
          </span>
          <span className="text-sm font-bold text-[#A65C2A]">&rarr;</span>
        </button>
      )}
      <div className="bg-[#FBFAF4] rounded-2xl p-4 sm:p-5 border border-[#DBD5C1] shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#26302B] flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-[#2B4739]" />
              <span>Kalender Ketersediaan Alat</span>
            </h2>
            <p className="text-xs text-[#6E6853]">Perhitungan stok dihitung realtime dari transaksi aktif.</p>
          </div>

          <div className="flex items-center space-x-2 bg-[#F1EEE2] p-1.5 rounded-xl border border-[#DBD5C1]">
            <button onClick={() => shiftDates(-1)} className="p-1.5 rounded-lg hover:bg-[#FBFAF4] text-[#26302B] transition">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center">
              <input
                type="date"
                value={baseDate}
                onChange={(e) => setBaseDate(e.target.value)}
                className="bg-[#FBFAF4] border border-[#DBD5C1] text-[#26302B] text-xs font-semibold rounded-lg px-2.5 py-1 text-center focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
              {/* Teks konfirmasi dd-mm-yyyy (keputusan Andi 10 Nov 2026) --
                  input type="date" bawaan formatnya ikut bahasa perangkat,
                  ambigu (mis. en-US: 11/10/2026 untuk 10 Nov). */}
              {baseDate && <span className="text-[10px] text-[#6E6853] mt-0.5">{formatDateIndo(baseDate, true)}</span>}
            </div>
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
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6E6853]" />
            <input
              type="text"
              placeholder={hasBundles ? 'Cari alat atau paket...' : 'Cari alat (contoh: Tenda, 60L)...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:border-[#2B4739] focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>
          <div className="flex items-center space-x-1 text-xs font-medium text-[#6E6853]">
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

        <div className="pt-1">
          <ScrollableRow>
            {['Semua', ...(hasBundles ? [PAKET_SENTINEL] : []), ...categories].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition shrink-0 ${
                  selectedCategory === cat
                    ? 'bg-[#2B4739] text-[#FBFAF4] shadow-xs'
                    : 'bg-[#F1EEE2] text-[#26302B] hover:bg-[#E6E1D2] border border-[#DBD5C1]'
                }`}
              >
                {cat === PAKET_SENTINEL ? '📦 Paket' : cat}
              </button>
            ))}
          </ScrollableRow>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between text-xs text-[#6E6853] px-1 gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-[#26302B]">Status:</span>
          <span className="flex items-center gap-1 text-[#2B4739] font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-[#2B4739]" /> Tersedia
          </span>
          <span className="flex items-center gap-1 text-[#A65C2A] font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-[#A65C2A]" /> Sisa Sedikit
          </span>
          <span className="flex items-center gap-1 text-[#A8412E] font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-[#A8412E]" /> Penuh
          </span>
        </div>
      </div>

      {!stokAktifNoticeDismissed && (
        <div className="flex items-start gap-2.5 bg-[#FBFAF4] border border-[#DBD5C1] rounded-2xl p-3">
          <Clock className="w-4 h-4 text-[#6E6853] shrink-0 mt-0.5" />
          <p className="flex-1 text-xs text-[#26302B] leading-relaxed">
            <strong>Baru:</strong> alat yang sedang disewa kini bisa dibooking untuk tanggal setelah jadwal
            kembalinya. Kalau telat dikembalikan, alat terkunci sampai Proses Pengembalian.{' '}
            <button
              type="button"
              onClick={() => onNavigateToGuide?.('g-kalender')}
              className="font-bold underline hover:text-[#1E3429]"
            >
              Pelajari
            </button>
          </p>
          <button
            type="button"
            onClick={() => {
              dismissStokAktifNotice();
              setStokAktifNoticeDismissed(true);
            }}
            aria-label="Tutup"
            className="shrink-0 p-0.5 rounded hover:bg-[#F1EEE2] text-[#6E6853]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {!loading && !error && showPaketGroup && filteredBundleAvailabilities.length > 0 && (
        <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-xs">
          <button
            type="button"
            onClick={togglePaketCollapsed}
            disabled={paketGroupForcedOpen}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left disabled:cursor-default"
          >
            <span className="font-bold text-sm text-[#26302B] flex items-center gap-2">
              <Package className="w-4 h-4" /> Paket
            </span>
            {!paketGroupForcedOpen &&
              (paketCollapsed ? <ChevronDown className="w-4 h-4 text-[#6E6853]" /> : <ChevronUp className="w-4 h-4 text-[#6E6853]" />)}
          </button>
          {(paketGroupForcedOpen || !paketCollapsed) && (
            <div className="px-4 pb-4 space-y-3">
              {filteredBundleAvailabilities.map(({ bundle, availability }) => {
                const isExpanded = expandedBundleId === bundle.id;
                // Indeks hari yang cocok dengan baseDate -- data.days[0]
                // selalu = baseDate (param start_date useAvailability),
                // dipakai utk gerbang tombol pesan (pola "Sewa Alat Ini").
                const remainingAtBaseDate = availability.days[0]?.remaining ?? 0;
                const bundleFull = remainingAtBaseDate <= 0;
                const imageUrl = resolveBundleImageUrl(bundle, data?.items ?? []);
                const dayOnePrice = computeBundleDayOnePrice(bundle, data?.items ?? []);
                return (
                  <div
                    key={bundle.id}
                    className="bg-[#FBFAF4] rounded-2xl p-4 border border-[#DBD5C1] shadow-xs hover:border-[#2B4739]/50 transition"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => setExpandedBundleId(isExpanded ? null : bundle.id)}
                        className="flex items-start space-x-3 min-w-[240px] text-left"
                      >
                        {imageUrl ? (
                          <img src={imageUrl} alt={bundle.name} className="w-14 h-14 rounded-xl object-cover border border-[#DBD5C1] bg-[#F1EEE2]" />
                        ) : (
                          <div className="w-14 h-14 rounded-xl border border-[#DBD5C1] shrink-0 bg-[#F1EEE2] flex items-center justify-center text-[#6E6853]">
                            <Package className="w-5 h-5" />
                          </div>
                        )}
                        <div>
                          <h3 className="font-bold text-sm text-[#26302B] flex items-center gap-1">
                            {bundle.name}
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-[#6E6853]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#6E6853]" />}
                          </h3>
                          {dayOnePrice > 0 && (
                            <div className="text-xs mt-1">
                              <span className="font-semibold text-[#2B4739]">
                                Mulai {formatIDR(dayOnePrice)} <span className="text-[10px] font-normal text-[#6E6853]">/hari</span>
                              </span>
                            </div>
                          )}
                          {/* Baris sendiri di bawah harga, bukan sebaris (koordinator
                              17 Nov 2026) -- di layar lebar sebelumnya sesak
                              bersama "Mulai Rp X /hari", pola sama kartu alat
                              (nama -> harga -> info stok di baris terpisah). */}
                          <p className="text-[10px] text-[#6E6853] mt-0.5">{bundle.bundle_items.length} alat dalam paket</p>
                        </div>
                      </button>

                      <div className="flex-1 overflow-x-auto pb-1 scrollbar-none">
                        <div className="flex items-center gap-2 min-w-max">
                          {(data?.days ?? []).map((dateStr, i) => {
                            const day = availability.days[i];
                            const remaining = day?.remaining ?? 0;
                            const status = day?.status ?? 'penuh';
                            const styles =
                              status === 'penuh'
                                ? 'bg-[#FAF0EE] text-[#A8412E] border-[#A8412E]/30'
                                : status === 'sisa_sedikit'
                                  ? 'bg-[#F9EFE7] text-[#A65C2A] border-[#A65C2A]/30'
                                  : 'bg-[#E8EFEA] text-[#2B4739] border-[#2B4739]/30';
                            const countBg =
                              status === 'penuh' ? 'bg-[#A8412E] text-white' : status === 'sisa_sedikit' ? 'bg-[#A65C2A] text-white' : 'bg-[#2B4739] text-[#FBFAF4]';
                            return (
                              <div
                                key={dateStr}
                                title={
                                  day?.limitingComponentName
                                    ? `Terbatas: ${day.limitingComponentName}${day.limitingComponentOverdue ? ' (telat)' : ''}`
                                    : undefined
                                }
                                className={`flex flex-col items-center p-2 rounded-xl border min-w-[72px] text-center ${styles}`}
                              >
                                <span className="text-[10px] font-medium opacity-80">{shortDate(dateStr)}</span>
                                <div className={`mt-1 w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${countBg}`}>{remaining}</div>
                                <span className="text-[9px] mt-1 font-semibold opacity-90">{status === 'penuh' ? 'HABIS' : `Sisa ${remaining}`}</span>
                                {day?.limitingComponentName && status !== 'tersedia' && (
                                  <span className="text-[8px] mt-0.5 opacity-80 leading-tight">
                                    Terbatas: {day.limitingComponentName}
                                    {day.limitingComponentOverdue ? ' (telat)' : ''}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center justify-end shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#E6E1D2]">
                        <button
                          type="button"
                          onClick={() => onSelectBookBundle(bundle.id, baseDate)}
                          disabled={!writable || bundleFull}
                          title={
                            !writable
                              ? 'Masa aktif langganan sudah habis — hubungi Sewalog untuk memperpanjang.'
                              : bundleFull
                                ? 'Paket ini penuh di tanggal yang dipilih.'
                                : undefined
                          }
                          className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-[#FBFAF4] text-xs font-semibold shadow-xs transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#2B4739]"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Sewa Paket Ini</span>
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-[#E6E1D2]">
                        <p className="text-[11px] font-semibold text-[#6E6853] mb-1">Isi paket:</p>
                        <ul className="text-xs text-[#26302B] space-y-0.5">
                          {bundle.bundle_items.map((c) => {
                            const item = data?.items.find((i) => i.id === c.item_id);
                            return (
                              <li key={c.id}>
                                {c.quantity}× {item?.name ?? c.item_id}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!loading && !error && isPaketFilterActive && filteredBundleAvailabilities.length === 0 && (
        <div className="bg-[#FBFAF4] rounded-2xl p-8 border border-[#DBD5C1] text-center text-[#6E6853] text-sm">
          Paket tidak ditemukan dengan kata kunci tersebut.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[#6E6853]">Memuat kalender...</p>
      ) : error ? (
        <p className="text-sm text-[#A8412E]">Gagal memuat kalender: {error}</p>
      ) : isPaketFilterActive ? null : filteredItems.length === 0 ? (
        <div className="bg-[#FBFAF4] rounded-2xl p-8 border border-[#DBD5C1] text-center text-[#6E6853] text-sm">
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
                    <button type="button" onClick={() => setPreviewImageUrl(item.image_url)} className="shrink-0">
                      <img src={item.image_url} alt={item.name} className="w-14 h-14 rounded-xl object-cover border border-[#DBD5C1] bg-[#F1EEE2]" />
                    </button>
                  ) : (
                    <div className="w-14 h-14 rounded-xl border border-[#DBD5C1] shrink-0 bg-[#F1EEE2] flex items-center justify-center text-[#6E6853]">
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
                      {item.category && <span className="text-[11px] font-medium text-[#6E6853]">{item.category}</span>}
                    </div>
                    <h3 className="font-bold text-sm text-[#26302B] mt-0.5">{item.name}</h3>
                    <div className="flex items-center space-x-3 text-xs mt-1">
                      <span className="font-semibold text-[#2B4739]">
                        {formatIDR(item.price_per_day)} <span className="text-[10px] font-normal text-[#6E6853]">/hari</span>
                      </span>
                      <span className="text-[#DBD5C1]">|</span>
                      <span className="text-[#6E6853]">
                        Stok: <strong className="text-[#26302B]">{item.total_units}</strong> unit
                      </span>
                    </div>
                    {/* Opsi B Tahap 2 (brief 17 Nov 2026) -- tanda alat
                        terkunci oleh transaksi aktif yang SUDAH TELAT.
                        Ditekan -> Transaksi Aktif (sama tujuan dengan
                        banner "Pesanan masuk" di atas). */}
                    {item.overdue_bookings.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onViewOverdue?.()}
                        className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg px-2 py-1 hover:bg-[#A8412E]/10 transition text-left"
                        title={item.overdue_bookings
                          .map((b) => `${b.customer_name?.trim() || b.booking_number || 'Tanpa nama'} (${b.quantity} unit)`)
                          .join(', ')}
                      >
                        <Clock className="w-3 h-3 shrink-0" />
                        <span>{formatOverdueLabel(item.overdue_bookings)}</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-x-auto pb-1 scrollbar-none">
                  <div className="flex items-center gap-2 min-w-max">
                    {(data?.days ?? []).map((dateStr, i) => {
                      // Bisa negatif kalau jendela jeda persiapan (readiness_hours)
                      // beberapa booking yang sudah ditutup tumpang tindih di
                      // tanggal yang sama (lihat usedUnitsOn di lib/availability.ts)
                      // — tampilkan 0, bukan angka negatif mentah, status di
                      // bawahnya tetap "HABIS" seperti biasa (computeAvailabilityStatus
                      // sudah memperlakukan remaining<=0 sebagai 'penuh').
                      const remaining = Math.max(0, item.remaining[i]);
                      const status = item.status[i];
                      const styles =
                        status === 'penuh'
                          ? 'bg-[#FAF0EE] text-[#A8412E] border-[#A8412E]/30'
                          : status === 'sisa_sedikit'
                            ? 'bg-[#F9EFE7] text-[#A65C2A] border-[#A65C2A]/30'
                            : 'bg-[#E8EFEA] text-[#2B4739] border-[#2B4739]/30';
                      const countBg =
                        status === 'penuh' ? 'bg-[#A8412E] text-white' : status === 'sisa_sedikit' ? 'bg-[#A65C2A] text-white' : 'bg-[#2B4739] text-[#FBFAF4]';

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
                    disabled={!writable}
                    title={!writable ? 'Masa aktif langganan sudah habis — hubungi Sewalog untuk memperpanjang.' : undefined}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-[#FBFAF4] text-xs font-semibold shadow-xs transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#2B4739]"
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

      {previewImageUrl && (
        <ImagePreviewModal url={previewImageUrl} alt="Pratinjau foto alat" onClose={() => setPreviewImageUrl(null)} />
      )}
    </div>
  );
}
