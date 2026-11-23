// Jalur eksekusi cetak thermal -- browser (window.print(), untuk USB/AirPrint/
// simpan PDF) dan RawBT (Android, Bluetooth Classic). Lihat
// research/brief-cetak-printer-thermal-2026-11.md.
import type { ThermalReceiptDoc, PaperWidth } from './thermalReceipt';
import { buildEscposBytes, bytesToBase64 } from './escpos';

export function isAndroidDevice(): boolean {
  return typeof window !== 'undefined' && /android/i.test(window.navigator.userAgent);
}

export function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  );
}

const MM_PER_WIDTH: Record<PaperWidth, string> = { 58: '58mm', 80: '80mm' };

// Cetak lewat dialog print browser, discoping @page ke ukuran kertas
// thermal TANPA mengubah @page Nota A4/struk langganan lain (index.css)
// -- style dan elemen pratinjau disuntik sekali pakai, dibersihkan lagi
// setelah dialog print selesai (event afterprint + fallback timeout).
// #print-thermal-root SENGAJA di-append LANGSUNG ke document.body
// (bukan dinest di mana pun di dalam #root) -- aturan sembunyikan-
// selain-print-root yang SAMA di index.css (`body > *:not(...)`,
// perbaikan bug halaman-ganda 24 Nov 2026) mengenali elemen ini lewat
// id-nya, jadi visibility/positioning tidak perlu diulang di sini lagi
// -- cuma @page ukuran kertas yang masih perlu disuntik per pemanggilan
// (beda vendor bisa beda paperWidth).
export function printThermalInBrowser(doc: ThermalReceiptDoc, paperWidth: PaperWidth) {
  const root = document.createElement('div');
  root.id = 'print-thermal-root';
  root.style.fontFamily = "'Courier New', monospace";
  root.style.fontSize = '11px';
  root.style.whiteSpace = 'pre';
  root.style.lineHeight = '1.35';
  root.textContent = doc.textLines.join('\n');
  document.body.appendChild(root);

  const style = document.createElement('style');
  style.id = 'thermal-print-style';
  style.textContent = `
    @media print {
      @page { size: ${MM_PER_WIDTH[paperWidth]} auto; margin: 0; }
      #print-thermal-root { padding: 2mm; }
    }
  `;
  document.head.appendChild(style);

  const cleanup = () => {
    root.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Jaring pengaman: beberapa browser mobile tidak selalu memicu afterprint
  // secara konsisten lewat window.print() terprogram.
  setTimeout(cleanup, 15000);

  window.print();
}

export type RawBtResult = 'sent' | 'unsupported';

// rawbt: scheme -- bytes ESC/POS dikirim sebagai base64. Browser tidak
// memberi sinyal pasti berhasil/gagal membuka custom scheme, jadi ini
// best-effort: kalau halaman tidak kehilangan fokus (app RawBT tidak
// terbuka) dalam waktu singkat, dianggap RawBT belum terpasang.
export function printViaRawBt(doc: ThermalReceiptDoc): Promise<RawBtResult> {
  return new Promise((resolve) => {
    const bytes = buildEscposBytes(doc.lines);
    const b64 = bytesToBase64(bytes);
    let settled = false;
    const onVisibilityChange = () => {
      if (document.hidden && !settled) {
        settled = true;
        cleanup();
        resolve('sent');
      }
    };
    const cleanup = () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve('unsupported');
      }
    }, 1500);
    window.location.href = `rawbt:base64,${b64}`;
  });
}

export type PrinterConnectionForPrint = 'bluetooth' | 'usb';

// Satu jalur cetak dipakai baik oleh tombol "Cetak Struk" sungguhan maupun
// tombol "Cetak Tes" di wizard -- catatan koordinator 16 Nov 2026 (jangan
// ada jalur terpisah untuk uji coba).
export async function printThermalReceipt(
  doc: ThermalReceiptDoc,
  paperWidth: PaperWidth,
  connection: PrinterConnectionForPrint,
): Promise<RawBtResult | 'browser'> {
  if (connection === 'bluetooth' && isAndroidDevice()) {
    return printViaRawBt(doc);
  }
  printThermalInBrowser(doc, paperWidth);
  return 'browser';
}
