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

// Vendor yang daftar sebelum tanggal ini berhak harga Pendiri — tapi
// HANYA untuk masa aktif yang MULAI di tahun 2027 (lihat isFounderPricing).
export const FOUNDER_CUTOFF_ISO = '2027-01-01T00:00:00+07:00';

// Sebelum tanggal ini, app belum boleh menampilkan angka harga ATAU
// status Pendiri sama sekali (review -c1: bisa membocorkan rencana
// harga/skema Pendiri sebelum pengumuman resmi 9 Des 2026) — tetap
// tampilkan kalimat "harga diumumkan sebelum 31 Desember" yang sudah
// ada. Dibandingkan lewat Date lokal browser biasa (bukan helper
// WIB-eksplisit) — disetujui -c1 2 Nov 2026: angka yang tampil di app
// cuma display/saran, jam tangan browser yang salah tidak bisa membuat
// pembayaran sungguhan lebih murah karena satu-satunya jalur tulis
// (record_subscription_payment) selalu diisi admin setelah verifikasi
// manual transfer.
export const PRICING_ANNOUNCE_AT_ISO = '2026-12-09T00:00:00+07:00';

export function pricingAnnounced(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(PRICING_ANNOUNCE_AT_ISO).getTime();
}

// `createdAt` = businesses.created_at (kapan vendor daftar). `periodStart`
// = tanggal (YYYY-MM-DD) mulai masa aktif yang SEDANG dibayar, bukan hari
// ini — review -c1: eligibility ditentukan oleh kapan masa aktifnya
// MULAI, bukan kapan transaksi dicatat. Vendor Pendiri yang bayar
// tahunan di Jan 2027 tetap dapat harga Pendiri meski masa aktifnya
// nyambung sampai 2028.
export function isFounderPricing(createdAt: string, periodStart: string): boolean {
  const createdBeforeCutoff = new Date(createdAt).getTime() < new Date(FOUNDER_CUTOFF_ISO).getTime();
  const periodStartYear = new Date(`${periodStart}T00:00:00+07:00`).getFullYear();
  return createdBeforeCutoff && periodStartYear === 2027;
}
