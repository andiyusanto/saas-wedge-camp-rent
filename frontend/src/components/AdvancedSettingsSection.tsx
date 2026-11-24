import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react';

// "Pengaturan Lanjutan" (brief Pilih Skema Sewa 24 Nov 2026) -- bungkus
// pengaturan yang jarang disentuh (batas ubah jadwal, toleransi telat,
// batas jam kembali, cara hitung denda detail, maksimal hari) supaya
// tidak membingungkan pemula saat pertama kali buka Kelola Usaha.
// Default TERTUTUP, status buka/tutup diingat PER PERANGKAT lewat
// localStorage (pola sama usePrinterSettings.ts) -- try/catch supaya
// private browsing/storage diblokir tidak menggagalkan render, cuma
// kembali ke default tertutup.
const STORAGE_KEY = 'sewalog_advanced_settings_open_v1';

function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredOpen(open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    // tidak fatal -- cuma housekeeping, status buka/tutup kembali ke
    // default tertutup di sesi berikutnya kalau storage tidak tersedia.
  }
}

export function AdvancedSettingsSection({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(readStoredOpen);

  function toggle() {
    const next = !open;
    setOpen(next);
    writeStoredOpen(next);
  }

  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E1D2]">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center justify-between gap-2 text-sm font-semibold text-[#26302B] hover:text-[#2B4739] transition"
      >
        <span className="flex items-center gap-1.5">
          <Settings2 className="w-4 h-4" />
          Pengaturan Lanjutan
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {!open && (
        <p className="text-[11px] text-[#6E6853]">
          Pengaturan yang jarang perlu diubah — toleransi telat, batas jam kembali, cara hitung denda detail, batas
          ubah jadwal, dan batas paket hari.
        </p>
      )}
      {open && <div className="flex flex-col gap-4">{children}</div>}
    </div>
  );
}
