import { useEffect, useRef } from 'react';
import { Calendar, ShieldAlert, Package, Plus, LogOut, Users, BookOpen, Store, History, Globe, ShieldCheck, CreditCard } from 'lucide-react';
import { ScrollableRow } from './ScrollableRow';
import { InstallAppButton } from './InstallAppButton';
import type { MemberRole } from '../hooks/useBusiness';

export type Tab = 'kalender' | 'tracking' | 'alat' | 'tim' | 'riwayat' | 'etalase-online' | 'toko-online' | 'panduan' | 'admin' | 'langganan';

// Disembunyikan dari Navbar sejak 2 Nov 2026 (permintaan Andi) — maknanya
// sudah tumpang-tindih dengan Pesanan Online (bagian 6/8b CLAUDE.md), dan
// pemrosesan pembayaran online TETAP non-goal terlepas dari ini (lihat
// CLAUDE.md bagian 8). Komponennya sendiri (OnlineStoreScreen.tsx)
// SENGAJA tidak dihapus — satu flag ini saja yang perlu diubah balik ke
// `true` kalau fitur ini mau ditampilkan lagi nanti.
export const SHOW_TOKO_ONLINE_TAB = false;

const TABS: { id: Tab; label: string; icon: typeof Calendar; ownerOnly?: boolean; adminOnly?: boolean }[] = [
  { id: 'kalender', label: 'Kalender Ketersediaan', icon: Calendar },
  { id: 'tracking', label: 'Transaksi Aktif', icon: ShieldAlert },
  { id: 'alat', label: 'Katalog & Stok Alat', icon: Package },
  { id: 'riwayat', label: 'Riwayat Transaksi', icon: History, ownerOnly: true },
  { id: 'tim', label: 'Kelola Usaha', icon: Users, ownerOnly: true },
  // Dua tab ini SENGAJA dipisah, bukan digabung — "Etalase" (lihat-lihat,
  // sudah bisa dipakai sekarang, gratis) vs "Toko" (transaksi sungguhan,
  // masih rencana masa depan yang dievaluasi) — lihat komentar di
  // OnlineStoreScreen.tsx & EtalaseOnlineScreen.tsx. Ditaruh berdekatan
  // di navbar (urutan ditukar ke setelah Kelola Usaha, permintaan Andi
  // 10 Nov 2026) supaya hubungannya tetap terasa tanpa disatukan.
  //
  // Label tab ini sengaja "Etalase & Pesanan Online" (direvisi Andi 2
  // Nov 2026 dari "Etalase & Pesanan", permintaan asli 31 Okt 2026
  // setelah fitur Pesanan Online dari Etalase tahap 4 dibangun) — beda
  // dari judul layar/kartu di dalamnya ("Etalase Online"/"Pesanan
  // Online" tetap dipakai di situ, cuma label tab navbar ini yang
  // berubah) supaya vendor yang belum pernah buka tab ini tahu dari
  // navbar sendiri bahwa ada fitur pesanan di dalamnya, bukan cuma
  // etalase pasif. Diverifikasi tetap muat satu baris di scroller tab
  // HP pada lebar 390px.
  { id: 'etalase-online', label: 'Etalase & Pesanan Online', icon: Store, ownerOnly: true },
  { id: 'toko-online', label: 'Toko Online', icon: Globe, ownerOnly: true },
  { id: 'langganan', label: 'Langganan', icon: CreditCard, ownerOnly: true },
  { id: 'panduan', label: 'Panduan', icon: BookOpen },
  // Alat admin internal (rencana langganan) — adminOnly terpisah dari
  // ownerOnly: tidak ada hubungan dengan role pemilik/karyawan business
  // manapun, cuma tampil untuk akun di app_admins (migration 044), dicek
  // via is_app_admin() di App.tsx/useIsAppAdmin.ts.
  { id: 'admin', label: 'Alat Admin', icon: ShieldCheck, adminOnly: true },
];

export function Navbar({
  activeTab,
  setActiveTab,
  onOpenNewBooking,
  businessName,
  role,
  onLogout,
  pendingRequestCount = 0,
  writable = true,
  isAppAdmin = false,
}: {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  onOpenNewBooking: () => void;
  businessName: string;
  role: MemberRole | null;
  onLogout: () => void;
  // Rencana tahap 4, bagian B+C: jumlah booking_requests 'menunggu'
  // (sudah difilter belum kedaluwarsa, lihat useBookingRequests.ts) —
  // badge di tab "Transaksi Aktif", bukan tab terpisah (keputusan Andi
  // 30 Okt, lihat research/etalase-online-ordering-plan-2026-10.md 2.4).
  pendingRequestCount?: number;
  // Rencana langganan — review -c1: tombol "+" ini dipakai sebelum
  // vendor sempat tahu statusnya, jadi WAJIB sudah menunjukkan peringatan
  // DI SINI (disabled+tooltip), bukan baru ketahuan setelah mengisi
  // seluruh form Catat Transaksi di depan pelanggan yang menunggu.
  writable?: boolean;
  // Rencana langganan: Alat Admin — true hanya untuk akun di app_admins
  // (migration 044), independen dari role owner/karyawan mana pun.
  isAppAdmin?: boolean;
}) {
  const visibleTabs = TABS.filter(
    (t) => (!t.ownerOnly || role === 'owner') && (!t.adminOnly || isAppAdmin) && (t.id !== 'toko-online' || SHOW_TOKO_ONLINE_TAB),
  );

  // Bug lanjutan dari tab-persist (lib/tabStorage.ts, dilaporkan Andi 12 Nov
  // 2026): sorotan activeTab sudah benar tapi baris tab bisa tergulir di
  // posisi lama (mis. paling kiri/Kalender) kalau tab yang dipulihkan ada di
  // sebelah kanan (Panduan, Riwayat, dst) -- pengguna tidak melihat tombol
  // aktifnya sama sekali. Digulir manual lewat scrollContainerRef.scrollTo
  // (BUKAN scrollIntoView) supaya tidak ikut menggulir window secara
  // vertikal -- cuma kontainer horizontal ScrollableRow yang bergerak.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<Tab, HTMLButtonElement>());
  // Tab SEBELUMNYA (bukan cuma flag "pertama kali") -- role/isAppAdmin
  // (dan karenanya visibleTabs) baru selesai dimuat SETELAH mount, jadi
  // efek ini bisa jalan beberapa kali untuk activeTab yang SAMA begitu
  // daftar tab owner-only muncul belakangan dan posisi tombol bergeser.
  // Kalau activeTab-nya sama dengan run sebelumnya (bukan user mengklik
  // tab baru), itu cuma koreksi posisi akibat layout yang baru stabil --
  // tetap 'auto' supaya tidak kelihatan "meloncat" sendiri tanpa sebab.
  const prevActiveTabRef = useRef<Tab | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const button = buttonRefs.current.get(activeTab);
    if (!container || !button) return;
    // getBoundingClientRect(), BUKAN button.offsetLeft -- header (Navbar.tsx)
    // punya `sticky top-0` yang membuatnya jadi offsetParent tombol ini
    // (posisinya jadi dihitung relatif ke seluruh header, bukan ke
    // kontainer gulir ini), bikin perhitungan target salah total (ditemukan
    // lewat Playwright: tombol aktif tetap tidak terlihat penuh meski target
    // dihitung, lihat knowladge/review-tab-refresh-2026-11/).
    const containerRect = container.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const buttonOffsetWithinContainer = buttonRect.left - containerRect.left + container.scrollLeft;
    const target = buttonOffsetWithinContainer - (container.clientWidth - button.clientWidth) / 2;
    const clamped = Math.max(0, Math.min(target, container.scrollWidth - container.clientWidth));
    const isTabChangedByUser = prevActiveTabRef.current !== null && prevActiveTabRef.current !== activeTab;
    container.scrollTo({ left: clamped, behavior: isTabChangedByUser ? 'smooth' : 'auto' });
    prevActiveTabRef.current = activeTab;
    // visibleTabs.length sengaja ikut dipantau -- role/isAppAdmin baru
    // final belakangan (lihat komentar di atas), membuat tombol owner-
    // only muncul/hilang dan menggeser posisi tombol yang lain.
  }, [activeTab, role, isAppAdmin, visibleTabs.length]);

  return (
    <header className="sticky top-0 z-30 bg-[#2B4739] text-white shadow-md border-b border-[#1E3429]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#F1EEE2] flex items-center justify-center p-1.5 shadow-sm border border-[#DBD5C1] shrink-0">
              <img src="/logo.svg" alt="" className="w-full h-full" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-xl font-bold tracking-tight text-[#F1EEE2]">Sewalog</span>
                <span className="hidden sm:inline text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#A65C2A]/30 text-[#FBFAF4] border border-[#A65C2A]/50">
                  UKM Outdoor
                </span>
              </div>
              <p className="text-xs text-[#E6E1D2]/80 font-medium truncate">{businessName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E3429] border border-[#3A5C4A] max-w-[14rem]">
              <Store className="w-4 h-4 text-[#A65C2A] shrink-0" />
              <span className="text-xs font-bold text-[#F1EEE2] truncate" title={businessName}>
                {businessName}
              </span>
            </div>
            <button
              onClick={onOpenNewBooking}
              disabled={!writable}
              title={!writable ? 'Masa aktif langganan sudah habis — hubungi Sewalog untuk memperpanjang.' : undefined}
              className="flex items-center gap-1.5 px-3 py-2 sm:px-4 rounded-xl bg-[#A65C2A] hover:bg-[#9E5524] text-white font-semibold text-xs sm:text-sm shadow-sm transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#A65C2A]"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Catat Transaksi</span>
            </button>
            <InstallAppButton />
            <button
              onClick={onLogout}
              title="Keluar"
              className="p-2 rounded-xl bg-[#1E3429] hover:bg-[#15251D] border border-[#3A5C4A] text-[#DBD5C1] transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-[#1E3429] border-t border-[#3A5C4A]/50">
        <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-2">
          <ScrollableRow variant="dark" ref={scrollContainerRef}>
            {visibleTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                ref={(el) => {
                  if (el) buttonRefs.current.set(id, el);
                  else buttonRefs.current.delete(id);
                }}
                onClick={() => setActiveTab(id)}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition ${
                  activeTab === id
                    ? 'bg-[#FBFAF4] text-[#2B4739] shadow-xs font-bold'
                    : 'text-[#DBD5C1] hover:text-white hover:bg-[#2B4739]/80'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
                {id === 'tracking' && pendingRequestCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#A65C2A] text-white text-[9px] font-bold flex items-center justify-center border border-[#1E3429]">
                    {pendingRequestCount > 9 ? '9+' : pendingRequestCount}
                  </span>
                )}
              </button>
            ))}
          </ScrollableRow>
        </div>
      </div>
    </header>
  );
}
