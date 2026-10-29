import dns from 'node:dns/promises';
import net from 'node:net';

// Dipakai HANYA oleh impor data alat (routes/items.ts) — satu-satunya jalur
// di backend ini yang fetch URL dari isian user (Link foto di file Excel/
// CSV), jadi satu-satunya titik yang butuh proteksi SSRF. Link upload foto
// manual (routes/uploads.ts) tidak lewat sini sama sekali — browser yang
// fetch, bukan server.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // sebelum resize; dikecilkan lagi di imageResize sisi server
const FETCH_TIMEOUT_MS = 10_000;

export class ImageFetchError extends Error {}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, termasuk metadata cloud (169.254.169.254)
    if (a === 0) return true;
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice('::ffff:'.length)); // IPv4-mapped
  return false;
}

async function assertHostIsPublic(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new ImageFetchError('URL foto mengarah ke alamat jaringan privat, ditolak.');
    return;
  }
  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ImageFetchError('Tidak bisa resolve domain URL foto.');
  }
  if (records.length === 0) throw new ImageFetchError('Tidak bisa resolve domain URL foto.');
  for (const { address } of records) {
    if (isPrivateIp(address)) throw new ImageFetchError('URL foto mengarah ke alamat jaringan privat, ditolak.');
  }
}

function isGoogleDriveHost(hostname: string): boolean {
  return hostname === 'drive.google.com' || hostname === 'drive.usercontent.google.com';
}

// Google Drive share link "file/d/<id>/view" (atau "open?id=<id>") tidak
// langsung berupa file gambar — dikonversi ke endpoint unduhan langsungnya.
// Dulu pakai "drive.google.com/uc?export=download" (lihat git blame), tapi
// itu sendiri cuma REDIRECT ke "drive.usercontent.google.com/download" di
// belakang layar (dikonfirmasi lewat riset eksternal, bukan asumsi) — jadi
// langsung ke situ, skip satu hop redirect. `confirm=t` ditambahkan supaya
// Drive tidak membalas halaman HTML "Download anyway" (muncul untuk file
// yang tidak bisa di-scan virus otomatis, umumnya file besar atau kadang
// request dari IP server) alih-alih bytes gambar — tanpa parameter ini,
// kasus itu lolos validasi status 200 tapi isinya HTML, bukan gambar.
export function normalizeImageUrl(rawUrl: string): string {
  const driveFileMatch = rawUrl.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveFileMatch) {
    return `https://drive.usercontent.google.com/download?id=${driveFileMatch[1]}&export=download&confirm=t`;
  }
  const driveOpenMatch = rawUrl.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (driveOpenMatch) {
    return `https://drive.usercontent.google.com/download?id=${driveOpenMatch[1]}&export=download&confirm=t`;
  }
  return rawUrl;
}

const REJECTED_HOSTS = ['instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com', 'fb.watch'];

// Semua pesan di sini sengaja bahasa vendor non-teknis dan actionable
// (permintaan Andi) — detail teknis asli (status HTTP, nama error Node,
// dsb) TIDAK pernah dikirim ke vendor, cuma dicatat lewat console.error
// di pemanggilnya (routes/items.ts).
export async function fetchImageFromUrl(rawUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const normalized = normalizeImageUrl(rawUrl.trim());

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new ImageFetchError('Link foto tidak valid.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageFetchError('Link foto tidak valid.');
  }
  if (REJECTED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
    throw new ImageFetchError('Link Instagram/Facebook tidak bisa dipakai — unggah fotonya manual lewat form alat.');
  }

  await assertHostIsPublic(url.hostname);

  // Satu redirect manual ditelusuri sendiri (bukan fetch redirect:'follow')
  // supaya host tujuan redirect ikut dicek lagi — tanpa ini, URL publik
  // yang sengaja redirect ke alamat privat akan melewati pengecekan di atas.
  let currentUrl = url;
  let response: Response;
  try {
    for (let hop = 0; hop < 3; hop++) {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'SewalogImportBot/1.0' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new ImageFetchError('Link tidak bisa dibuka.');
        currentUrl = new URL(location, currentUrl);
        if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
          throw new ImageFetchError('Link tidak bisa dibuka.');
        }
        await assertHostIsPublic(currentUrl.hostname);
        continue;
      }
      break;
    }
  } catch (err) {
    if (err instanceof ImageFetchError) throw err;
    // AbortSignal.timeout() melempar DOMException name 'TimeoutError'; error
    // jaringan lain (DNS/koneksi ditolak dsb) juga ditangkap di sini — semua
    // disamakan jadi satu pesan generik, bukan dibedakan per jenis error Node.
    const isTimeout = (err as { name?: string }).name === 'TimeoutError' || (err as { name?: string }).name === 'AbortError';
    throw new ImageFetchError(isTimeout ? 'Link tidak bisa dibuka (waktu habis).' : 'Link tidak bisa dibuka.');
  }

  const finalResponse = response!;
  if (!finalResponse.ok) {
    throw new ImageFetchError('Link tidak bisa dibuka.');
  }

  const contentType = finalResponse.headers.get('content-type') ?? '';
  if (!/^image\/(jpeg|png|webp)/i.test(contentType)) {
    if (isGoogleDriveHost(currentUrl.hostname) && /^text\/html/i.test(contentType)) {
      throw new ImageFetchError(
        'Link Google Drive belum dibagikan ke "Siapa saja yang memiliki link", atau filenya butuh konfirmasi tambahan dari Google.',
      );
    }
    throw new ImageFetchError('Link bukan gambar.');
  }

  const contentLength = Number(finalResponse.headers.get('content-length') ?? '0');
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new ImageFetchError('Foto terlalu besar.');
  }

  const arrayBuffer = await finalResponse.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageFetchError('Foto terlalu besar.');
  }

  return { buffer: Buffer.from(arrayBuffer), contentType };
}
