import type { Request } from 'express';

// Dipindah dari routes/etalase.ts (12 Nov 2026, brief pindah URL halaman
// status pesanan) supaya dipakai bareng routes/trackings.ts tanpa
// duplikasi logika env TOKO_PUBLIC_HOST.
//
// TOKO_PUBLIC_HOST = hostname custom domain (mis. "toko.sewalog.com") yang
// dihubungkan ke Web Service backend ini di Render, KHUSUS buat Etalase
// Online — supaya link yang dibagikan vendor ke pelanggannya berbentuk
// "toko.sewalog.com/{slug}", bukan "api.sewalog.com/toko/{slug}". SATU Web
// Service Express yang sama tetap menjawab kedua domain, dibedakan lewat
// host, bukan proses/deploy terpisah.
export const TOKO_PUBLIC_HOST = process.env.TOKO_PUBLIC_HOST;

// Canonical/og:url SENGAJA selalu mengarah ke SATU bentuk URL (bukan ikut
// persis bagaimana request ini datang). Kalau TOKO_PUBLIC_HOST sudah
// di-set (production), selalu pakai bentuk toko.sewalog.com/{slug} apapun
// jalur yang benar-benar dipakai pengunjung. Kalau belum (dev lokal,
// custom domain belum disambungkan), fallback ke bentuk /toko/{slug} di
// host request saat ini.
export function resolveTokoPageUrl(req: Request, slug: string): string {
  if (TOKO_PUBLIC_HOST) {
    return `https://${TOKO_PUBLIC_HOST}/${slug}`;
  }
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${baseUrl}/toko/${slug}`;
}

// Halaman status pesanan sekarang satu jalur DI BAWAH halaman Etalase
// rental itu sendiri (brief 12 Nov 2026: toko.sewalog.com/{slug}/pesanan/
// {token}, bukan lagi di root domain backend) -- pakai gerbang host yang
// SAMA PERSIS dengan resolveTokoPageUrl supaya dua-duanya selalu sepakat.
export function resolveStatusPageUrl(req: Request, slug: string, token: string): string {
  return `${resolveTokoPageUrl(req, slug)}/pesanan/${token}`;
}
