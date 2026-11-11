import { useCallback, useEffect, useState } from 'react';

// Tombol "Pasang Aplikasi" (Navbar.tsx) -- research/brief-panduan-sinkron-dan-pasang-aplikasi-2026-11.md.
// Android/desktop pakai beforeinstallprompt bawaan browser; iOS/iPadOS tidak
// punya API instal sama sekali, jadi cuma dideteksi untuk menampilkan
// petunjuk manual (Bagikan -> Tambah ke Layar Utama) di komponen pemanggil.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandaloneDisplay(): boolean {
  return (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(isStandaloneDisplay());

  const isIos = typeof window !== 'undefined' && /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  useEffect(() => {
    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }
    function handleAppInstalled() {
      setDeferredEvent(null);
      setIsStandalone(true);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;
    if (outcome === 'accepted') setIsStandalone(true);
    setDeferredEvent(null);
  }, [deferredEvent]);

  return {
    canInstall: deferredEvent !== null,
    isStandalone,
    isIos,
    promptInstall,
  };
}
