import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

// Tombol "Pasang Aplikasi" di Navbar.tsx -- research/brief-panduan-sinkron-dan-pasang-aplikasi-2026-11.md.
// Android/desktop: beforeinstallprompt bawaan browser. iPhone/iPad Safari
// non-standalone: tidak ada API instal, jadi tombol ini membuka popover
// petunjuk manual saja (gaya sama seperti Note di Panduan). Sembunyi total
// kalau sudah standalone atau browser tidak mendukung instal sama sekali.
export function InstallAppButton() {
  const { canInstall, isStandalone, isIos, promptInstall } = useInstallPrompt();
  const [showIosHint, setShowIosHint] = useState(false);

  if (isStandalone) return null;
  if (!canInstall && !isIos) return null;

  return (
    <div className="relative">
      <button
        onClick={() => (canInstall ? promptInstall() : setShowIosHint((v) => !v))}
        title="Pasang Aplikasi"
        className="p-2 rounded-xl bg-[#1E3429] hover:bg-[#15251D] border border-[#3A5C4A] text-[#DBD5C1] transition"
      >
        <Download className="w-4 h-4" />
      </button>
      {showIosHint && (
        <div className="absolute right-0 top-full mt-2 w-60 z-40 bg-[#FBF3EA] border-l-4 border-[#A65C2A] rounded-r-lg rounded-tl-lg shadow-lg p-3 text-xs text-[#26302B] leading-relaxed">
          <button
            onClick={() => setShowIosHint(false)}
            className="absolute top-1.5 right-1.5 text-[#6E6853] hover:text-[#26302B]"
            title="Tutup"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          Ketuk tombol <span className="font-semibold">Bagikan</span> di Safari, lalu pilih{' '}
          <span className="font-semibold">Tambah ke Layar Utama</span>.
        </div>
      )}
    </div>
  );
}
