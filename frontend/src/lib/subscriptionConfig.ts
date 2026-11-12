// Satu titik konfigurasi untuk info pembayaran langganan Sewalog sendiri
// (PT MARKABAM NOTODESUN DIGITAL sebagai merchant langganannya sendiri —
// BUKAN dana penyewa, lihat docs/legalitas-pembayaran.md, konteks beda
// dari cara bayar vendor-ke-pelanggan di Pesanan Online). Review -c1
// (31 Okt 2026): jangan disebar ke banyak file — satu tempat.
export const SUBSCRIPTION_CONFIG = {
  // Nomor WA RESMI Sewalog (dikonfirmasi Andi, 31 Okt 2026) — teks ke
  // vendor TIDAK BOLEH menyebut nama "Andi" sama sekali (review -c1),
  // selalu "Hubungi Sewalog".
  supportWhatsApp: '089649454000',
  // Rekening PT MARKABAM NOTODESUN DIGITAL MASIH DALAM PROSES PENGAJUAN
  // (dikonfirmasi Andi, 31 Okt 2026, lihat research/subscription-brief-
  // 2026-10.md) — SENGAJA null, BUKAN diisi placeholder seperti "Bank
  // XXX 000" yang kelihatan seperti rekening sungguhan. Halaman
  // Langganan HARUS menampilkan kalimat "Info rekening pembayaran
  // segera diumumkan — hubungi Sewalog lewat WA" kalau nilai ini masih
  // null, bukan menyembunyikan field atau menampilkan data kosong yang
  // terlihat seperti bug.
  bankName: null as string | null,
  bankAccountNumber: null as string | null,
  bankAccountHolder: 'PT MARKABAM NOTODESUN DIGITAL',
  qrisImageUrl: null as string | null,
} as const;

export type BillingPeriod = 'monthly' | 'yearly';

// Harga final satu tier (semua fitur) — keputusan Andi via -c1, 2 Nov
// 2026. Pendiri = vendor yang daftar sebelum cutoff, berlaku SEPANJANG
// 2027 saja (lihat isFounderPricing di bawah) — bukan "selamanya".
export const PRICING: Record<'normal' | 'founder', Record<BillingPeriod, number>> = {
  normal: { monthly: 49_000, yearly: 490_000 },
  founder: { monthly: 39_000, yearly: 390_000 },
};

export const PERIOD_DAYS: Record<BillingPeriod, number> = {
  monthly: 30,
  yearly: 365,
};

// Batas eligibility OTOMATIS pendiri (keputusan Andi 12 Nov 2026) —
// vendor yang daftar sebelum tanggal ini LANGSUNG eligible pendiri,
// tanpa perlu ditandai admin. Peserta wawancara yang baru daftar
// SETELAH tanggal ini (mis. Januari 2027) tidak otomatis eligible —
// admin menandainya manual lewat Alat Admin (`founder_override`,
// migration 060), ditolak kalau penandaan BARU dilakukan setelah 31 Jan
// 2027 23:59 WIB (lihat `set_founder_override` di migration itu).
export const FOUNDER_CUTOFF_ISO = '2027-01-01T00:00:00+07:00';

// Sebelum tanggal ini, app belum boleh menampilkan angka harga ATAU
// status Pendiri sama sekali (review -c1: bisa membocorkan rencana
// harga/skema Pendiri sebelum pengumuman resmi). Tetap tampilkan
// kalimat "harga diumumkan sebelum 31 Desember" yang sudah ada.
// Dibandingkan lewat Date lokal browser biasa (bukan helper
// WIB-eksplisit) — disetujui -c1 2 Nov 2026: angka yang tampil di app
// cuma display/saran, jam tangan browser yang salah tidak bisa membuat
// pembayaran sungguhan lebih murah karena satu-satunya jalur tulis
// (record_subscription_payment) selalu diisi admin setelah verifikasi
// manual transfer. Tanggal diupdate 12 Nov 2026 ke embargo final 4 Des
// 2026 (sebelumnya 9 Des, placeholder lama).
export const PRICING_ANNOUNCE_AT_ISO = '2026-12-04T00:00:00+07:00';

export function pricingAnnounced(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(PRICING_ANNOUNCE_AT_ISO).getTime();
}

// Eligibility pendiri: `founderOverride` non-null (ditandai/dibatalkan
// manual admin, migration 060) SELALU menang atas aturan otomatis.
// `founderOverride === null` (belum pernah disentuh admin) jatuh balik
// ke aturan otomatis: `createdAt` (businesses.created_at) sebelum
// FOUNDER_CUTOFF_ISO.
export function isFounderEligible(createdAt: string, founderOverride: boolean | null): boolean {
  if (founderOverride !== null) return founderOverride;
  return new Date(createdAt).getTime() < new Date(FOUNDER_CUTOFF_ISO).getTime();
}

// Masa berlaku harga pendiri: `founderPriceUntil` (subscriptions.
// founder_price_until, migration 060) diisi OTOMATIS oleh
// record_subscription_payment() saat pembayaran PERTAMA (12 bulan dari
// tanggal mulai periode itu) — null berarti belum pernah bayar sama
// sekali, tetap tampilkan harga pendiri sebagai SARAN pembayaran
// pertama. `periodStart` = tanggal mulai masa aktif yang SEDANG
// dibayar/disarankan (YYYY-MM-DD), bukan hari ini.
export function isFounderPricing(eligible: boolean, founderPriceUntil: string | null, periodStart: string): boolean {
  if (!eligible) return false;
  if (founderPriceUntil === null) return true;
  return periodStart <= founderPriceUntil;
}
