import { useCallback, useState } from 'react';
import type { PaperWidth } from '../utils/thermalReceipt';

// Pengaturan printer struk thermal -- PER PERANGKAT di localStorage, bukan
// DB (tiap HP bisa pakai printer berbeda). Boleh dipakai karyawan, bukan
// owner-only (research/brief-cetak-printer-thermal-2026-11.md).
export type PrinterConnection = 'bluetooth' | 'usb' | 'none';

export type PrinterSettings = {
  connection: PrinterConnection;
  paperWidth: PaperWidth;
  configuredAt: string;
};

const STORAGE_KEY = 'sewalog_printer_settings_v1';

function readSettings(): PrinterSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.connection === 'bluetooth' || parsed.connection === 'usb' || parsed.connection === 'none')) {
      return parsed as PrinterSettings;
    }
    return null;
  } catch {
    return null;
  }
}

function writeSettings(settings: PrinterSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage tidak tersedia (mode privat dsb) -- pengaturan cuma
    // berlaku untuk sesi ini, wizard akan muncul lagi lain kali.
  }
}

export function usePrinterSettings() {
  const [settings, setSettings] = useState<PrinterSettings | null>(() => readSettings());

  const saveSettings = useCallback((next: PrinterSettings) => {
    writeSettings(next);
    setSettings(next);
  }, []);

  return { settings, saveSettings };
}
