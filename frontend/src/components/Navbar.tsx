import { Calendar, ShieldAlert, Package, Plus, LogOut } from 'lucide-react';

export type Tab = 'kalender' | 'tracking' | 'alat';

const TABS: { id: Tab; label: string; icon: typeof Calendar }[] = [
  { id: 'kalender', label: 'Kalender Ketersediaan', icon: Calendar },
  { id: 'tracking', label: 'Jaminan & Denda', icon: ShieldAlert },
  { id: 'alat', label: 'Katalog & Stok Alat', icon: Package },
];

export function Navbar({
  activeTab,
  setActiveTab,
  onOpenNewBooking,
  businessName,
  onLogout,
}: {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  onOpenNewBooking: () => void;
  businessName: string;
  onLogout: () => void;
}) {
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
                <span className="hidden sm:inline text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#B5652E]/30 text-[#FBFAF4] border border-[#B5652E]/50">
                  UKM Outdoor
                </span>
              </div>
              <p className="text-xs text-[#E6E1D2]/80 font-medium truncate">{businessName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onOpenNewBooking}
              className="flex items-center gap-1.5 px-3 py-2 sm:px-4 rounded-xl bg-[#B5652E] hover:bg-[#9E5524] text-white font-semibold text-xs sm:text-sm shadow-sm transition active:scale-95"
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
        <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
          <nav className="flex items-center gap-2 sm:gap-3 py-2 overflow-x-auto scrollbar-none">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition ${
                  activeTab === id
                    ? 'bg-[#FBFAF4] text-[#2B4739] shadow-xs font-bold'
                    : 'text-[#DBD5C1] hover:text-white hover:bg-[#2B4739]/80'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
