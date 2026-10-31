import { Calendar, ShieldAlert, Package, Plus, LogOut, Users, BookOpen, Store, History, Globe, ShieldCheck, CreditCard } from 'lucide-react';
import { ScrollableRow } from './ScrollableRow';
import type { MemberRole } from '../hooks/useBusiness';

export type Tab = 'kalender' | 'tracking' | 'alat' | 'tim' | 'riwayat' | 'etalase-online' | 'toko-online' | 'panduan' | 'admin' | 'langganan';

const TABS: { id: Tab; label: string; icon: typeof Calendar; ownerOnly?: boolean; adminOnly?: boolean }[] = [
  { id: 'kalender', label: 'Kalender Ketersediaan', icon: Calendar },
  { id: 'tracking', label: 'Transaksi Aktif', icon: ShieldAlert },
  { id: 'alat', label: 'Katalog & Stok Alat', icon: Package },
  { id: 'riwayat', label: 'Riwayat Transaksi', icon: History, ownerOnly: true },
  // Dua tab ini SENGAJA dipisah, bukan digabung — "Etalase" (lihat-lihat,
  // sudah bisa dipakai sekarang, gratis) vs "Toko" (transaksi sungguhan,
  // masih rencana masa depan yang dievaluasi) — lihat komentar di
  // OnlineStoreScreen.tsx & EtalaseOnlineScreen.tsx. Ditaruh berdekatan
  // di navbar supaya hubungannya tetap terasa tanpa disatukan.
  //
  // Label tab ini sengaja "Etalase & Pesanan" (permintaan Andi 31 Okt
  // 2026, setelah fitur Pesanan Online dari Etalase tahap 4 dibangun) —
  // beda dari judul layar/kartu di dalamnya ("Etalase Online"/"Pesanan
  // Online" tetap dipakai di situ, cuma label tab navbar ini yang
  // berubah) supaya vendor yang belum pernah buka tab ini tahu dari
  // navbar sendiri bahwa ada fitur pesanan di dalamnya, bukan cuma
  // etalase pasif — dipersingkat dari draf awal "Etalase dan Pemesanan
  // Online" supaya tetap muat rapi di scroller tab HP.
  { id: 'etalase-online', label: 'Etalase & Pesanan', icon: Store, ownerOnly: true },
  { id: 'tim', label: 'Kelola Usaha', icon: Users, ownerOnly: true },
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
  const visibleTabs = TABS.filter((t) => (!t.ownerOnly || role === 'owner') && (!t.adminOnly || isAppAdmin));
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
          <ScrollableRow variant="dark">
            {visibleTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
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
