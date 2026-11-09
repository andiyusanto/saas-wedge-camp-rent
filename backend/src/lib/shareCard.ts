import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp, { type OverlayOptions } from 'sharp';
import { getFromR2, uploadToR2 } from './r2.js';

// Gambar pratinjau link (og:image) Etalase, 1200x630 PNG.
//
// Kenapa tidak langsung pakai logo_url: logo & foto alat disimpan sebagai
// WebP ~512px. Hasilnya WA/Telegram cuma menampilkan thumbnail kecil (bukan
// kartu besar), dan beberapa aplikasi (TikTok, sebagian versi IG) tidak
// merender WebP sama sekali.
//
// - Ada logo: logo vendor dikonversi ke PNG, di tengah latar putih
//   (permintaan Andi 9 Nov 2026, seperti contoh Sewascale).
// - Belum ada logo: kartu teks (nama rental + kota). Font Roboto (assets/
//   fonts, OFL) = font yang tampil di sewalog.com di HP Android (landing
//   pakai system-ui/Roboto, permintaan Andi) — dibawa sendiri supaya tidak
//   bergantung font yang terpasang di server.
//
// Disimpan di R2 dengan key = hash isi (logo/nama/kota), jadi cuma dibuat
// sekali per perubahan; URL di og:image ikut membawa hash (?v=) supaya
// cache WA/Telegram/FB ikut ganti begitu logo/nama berubah.

const WIDTH = 1200;
const HEIGHT = 630;
const CARD_VERSION = 'v1';
const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
const FETCH_TIMEOUT_MS = 8000;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export type ShareCardInput = {
  businessName: string;
  logoUrl: string | null;
  location: string;
};

export function shareCardHash(input: ShareCardInput): string {
  return createHash('sha1')
    .update([CARD_VERSION, input.businessName, input.logoUrl ?? '', input.location].join('\u0000'))
    .digest('hex')
    .slice(0, 16);
}

// Cuma logo dari bucket publik kita sendiri yang di-fetch (bukan URL bebas)
// — tidak ada jalur SSRF dari isian vendor.
function isOwnImageUrl(url: string): boolean {
  const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  return base.length > 0 && url.startsWith(`${base}/`);
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 && buf.length <= MAX_LOGO_BYTES ? buf : null;
  } catch {
    return null;
  }
}

function escapePango(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const WEIGHT_NAME = { 400: 'Regular', 700: 'Bold' } as const;

async function textImage(text: string, weight: 400 | 700, sizePt: number, color: string, width: number) {
  return sharp({
    text: {
      text: `<span foreground="${color}">${escapePango(text)}</span>`,
      font: `Roboto ${WEIGHT_NAME[weight]} ${sizePt}`,
      fontfile: `${FONT_DIR}Roboto-${weight}.ttf`,
      width,
      align: 'centre',
      wrap: 'word',
      rgba: true,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}

async function renderLogoCard(logo: Buffer): Promise<Buffer> {
  // Logo "contain" di kotak 1080x560 (margin aman 60/35px) — tidak
  // terpotong walau logo persegi, potret, atau lebar.
  const fitted = await sharp(logo)
    .resize(1080, 560, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: '#FFFFFF' } })
    .composite([{ input: fitted, gravity: 'centre' }])
    .flatten({ background: '#FFFFFF' })
    .png()
    .toBuffer();
}

async function renderTextCard(input: ShareCardInput): Promise<Buffer> {
  // Dipotong di batas kata (bukan tengah kata) kalau terlalu panjang.
  const raw = input.businessName.trim();
  const name = raw.length > 60 ? `${raw.slice(0, 58).replace(/\s+\S*$/, '')}…` : raw;
  const nameSize = name.length > 32 ? 54 : 68;
  const [label, title, loc, brand] = await Promise.all([
    textImage('SEWA ALAT CAMPING', 700, 24, '#A65C2A', 1000),
    textImage(name, 700, nameSize, '#26302B', 1000),
    input.location ? textImage(input.location, 400, 28, '#6E6853', 1000) : Promise.resolve(null),
    textImage('sewalog.com', 700, 20, '#2B4739', 600),
  ]);

  const gap = 24;
  const blockH = label.info.height + gap + title.info.height + (loc ? gap + loc.info.height : 0);
  let y = Math.max(40, Math.round((HEIGHT - blockH) / 2) - 20);
  const center = (w: number) => Math.round((WIDTH - w) / 2);
  const layers: OverlayOptions[] = [];
  layers.push({ input: label.data, left: center(label.info.width), top: y });
  y += label.info.height + gap;
  layers.push({ input: title.data, left: center(title.info.width), top: y });
  y += title.info.height + gap;
  if (loc) layers.push({ input: loc.data, left: center(loc.info.width), top: y });
  layers.push({ input: brand.data, left: center(brand.info.width), top: HEIGHT - 40 - brand.info.height });

  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: '#F1EEE2' } })
    .composite([
      // Strip hijau pinus di atas — identitas visual, tetap token UI (CLAUDE.md bagian 5).
      { input: { create: { width: WIDTH, height: 14, channels: 4, background: '#2B4739' } }, left: 0, top: 0 },
      ...layers,
    ])
    .flatten({ background: '#F1EEE2' })
    .png()
    .toBuffer();
}

export async function renderShareCard(input: ShareCardInput): Promise<Buffer> {
  if (input.logoUrl && isOwnImageUrl(input.logoUrl)) {
    const logo = await fetchBuffer(input.logoUrl);
    if (logo) {
      try {
        return await renderLogoCard(logo);
      } catch {
        // logo rusak/format aneh — jatuh ke kartu teks
      }
    }
  }
  return renderTextCard(input);
}

// Cache dua lapis: memori proses (jawab cepat) + R2 (bertahan antar deploy/
// restart). Key R2 = hash isi, bukan slug — isi berbeda = objek berbeda,
// tidak pernah menimpa.
const memoryCache = new Map<string, Buffer>();
const MEMORY_MAX = 200;

export async function getShareCard(input: ShareCardInput): Promise<Buffer> {
  const hash = shareCardHash(input);
  const cached = memoryCache.get(hash);
  if (cached) return cached;

  const key = `og-cards/${CARD_VERSION}/${hash}.png`;
  let png = await getFromR2(key);

  if (!png) {
    png = await renderShareCard(input);
    // Gagal simpan ke R2 (mis. env R2 belum diisi di dev) tidak boleh
    // menggagalkan respons — gambar tetap dikirim, cuma tidak di-cache.
    await uploadToR2(key, png, 'image/png').catch(() => undefined);
  }

  if (memoryCache.size >= MEMORY_MAX) {
    const oldest = memoryCache.keys().next().value;
    if (oldest) memoryCache.delete(oldest);
  }
  memoryCache.set(hash, png);
  return png;
}

// Render teks pertama di proses baru bisa sangat lambat (puluhan detik —
// sistem font menyiapkan cache-nya). Dipanggil sekali saat server menyala
// (index.ts) supaya bukan pengunjung/crawler WA pertama yang menunggu.
export function warmUpShareCard(): void {
  renderTextCard({ businessName: 'Sewalog', logoUrl: null, location: 'Indonesia' }).catch(() => undefined);
}
