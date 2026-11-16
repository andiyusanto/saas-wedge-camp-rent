// Encoder ESC/POS minimal untuk struk thermal (research/brief-cetak-printer-thermal-2026-11.md).
// Hanya perintah yang dibutuhkan v1 -- tanpa library, tidak ada kebutuhan
// parser/builder umum untuk cakupan sekecil ini.

const ESC = 0x1b;
const GS = 0x1d;

// Karakter non-ASCII diganti supaya tidak muncul huruf aneh di printer
// (encoding default printer murah sering bukan UTF-8) -- brief eksplisit
// minta "×" -> "x" dkk, bukan dihapus begitu saja.
const ASCII_REPLACEMENTS: Record<string, string> = {
  '×': 'x',
  '–': '-',
  '—': '-',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '•': '-',
  '✓': 'OK',
  '✅': 'OK',
  '❌': 'X',
  '⚙': '',
  ' ': ' ', // NBSP -- Intl.NumberFormat('id-ID', ...) menyisipkannya sebagai pemisah
};

export function sanitizeAscii(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    out += ASCII_REPLACEMENTS[ch] ?? '?';
  }
  return out;
}

export type ThermalLine =
  | { kind: 'text'; text: string; bold?: boolean; align?: 'left' | 'center' | 'right'; doubleHeight?: boolean }
  | { kind: 'rule'; char?: string; width: number }
  | { kind: 'feed'; lines: number };

function pushBytes(out: number[], bytes: number[]) {
  out.push(...bytes);
}

function textToBytes(text: string): number[] {
  const sanitized = sanitizeAscii(text);
  return Array.from(sanitized).map((ch) => ch.charCodeAt(0));
}

// Bangun bytes ESC/POS dari baris terstruktur. Feed tambahan sebelum cut
// (printer murah seperti Blueprint ECO 58D tidak punya pisau otomatis,
// kertas disobek manual -- tanpa feed ini struk tersobek di tengah teks)
// -- catatan koordinator 16 Nov 2026.
export function buildEscposBytes(lines: ThermalLine[]): Uint8Array {
  const out: number[] = [];
  pushBytes(out, [ESC, 0x40]); // init

  let currentAlign: 'left' | 'center' | 'right' | null = null;
  const setAlign = (align: 'left' | 'center' | 'right') => {
    if (currentAlign === align) return;
    currentAlign = align;
    const code = align === 'left' ? 0 : align === 'center' ? 1 : 2;
    pushBytes(out, [ESC, 0x61, code]);
  };

  for (const line of lines) {
    if (line.kind === 'feed') {
      pushBytes(out, [ESC, 0x64, Math.max(0, Math.min(255, line.lines))]); // feed n lines
      continue;
    }
    if (line.kind === 'rule') {
      setAlign('left');
      pushBytes(out, textToBytes((line.char ?? '-').repeat(line.width)));
      pushBytes(out, [0x0a]);
      continue;
    }
    setAlign(line.align ?? 'left');
    pushBytes(out, [ESC, 0x45, line.bold ? 1 : 0]); // bold on/off
    pushBytes(out, [GS, 0x21, line.doubleHeight ? 0x01 : 0x00]); // double height
    pushBytes(out, textToBytes(line.text));
    pushBytes(out, [0x0a]);
  }

  // Jaring pengaman sobek kertas manual: feed ±4 baris sebelum cut.
  pushBytes(out, [ESC, 0x64, 4]);
  // Full cut -- printer tanpa pisau mengabaikan perintah ini.
  pushBytes(out, [GS, 0x56, 0x01]);

  return new Uint8Array(out);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
