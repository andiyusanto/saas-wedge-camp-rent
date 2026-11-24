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
export type PriceTier = 'founder' | 'perkenalan' | 'normal';
export type PricingTable = Record<PriceTier, Record<BillingPeriod, number>>;

// Tiga tingkat harga (keputusan Andi 24 Nov 2026, menggantikan skema 2
// tingkat sebelumnya — lihat research/brief-langganan-harga-referral-
// ulasan-2026-12.md dan memory project_pricing_decision_49k). Pendiri =
// vendor yang daftar/ikut wawancara sampai batas 2026, Perkenalan =
// lantai tengah untuk pendaftar sampai akhir 2027 (atau Pendiri yang
// sudah lewat 12 bulan tapi SEDANG putus-comeback, lihat
// resolvePriceTier di bawah), Normal = selain itu.
//
// ANGKA RUPIAH-nya SENGAJA TIDAK ada di sini (review koordinator 24 Nov
// 2026) — konstanta di bundle JS frontend kebaca siapa pun lewat
// DevTools/view-source bahkan SEBELUM login/sebelum embargo
// PRICING_ANNOUNCE_AT_ISO, yang berarti membocorkan skema harga lebih
// awal dari pengumuman resmi. Angkanya SEKARANG diambil lewat
// `GET /api/pricing` (backend/src/lib/pricingConfig.ts, backend/src/
// routes/pricing.ts) via hook `usePricing()` (hooks/usePricing.ts) --
// endpoint itu sendiri yang memutuskan kapan angka boleh dikirim
// (announced OR is_app_admin), bukan lagi diputuskan di sini. Fungsi di
// bawah (resolvePriceTier dkk) TETAP murni/testable -- cuma MENENTUKAN
// tingkat (label), bukan ANGKANYA, jadi tidak perlu tahu rupiah sama
// sekali.

export const PERIOD_DAYS: Record<BillingPeriod, number> = {
  monthly: 30,
  yearly: 365,
};

// Batas eligibility OTOMATIS Pendiri (nilainya TIDAK berubah dari
// migration 060 — brief 24 Nov 2026 cuma menegaskan ulang syarat yang
// sama persis: "daftar ATAU ikut wawancara paling lambat 31 Des 2026",
// TIDAK diperpanjang) — `< 2027-01-01 00:00 WIB` berarti "sampai dengan
// akhir 31 Des 2026 WIB inklusif". Vendor yang daftar sebelum tanggal
// ini LANGSUNG eligible Pendiri, tanpa perlu ditandai admin. Peserta
// wawancara yang baru daftar SETELAH tanggal ini (mis. Januari 2027)
// tidak otomatis eligible — admin menandainya manual lewat Alat Admin
// (`founder_override`, migration 060/074, dipakai SEKALIGUS sebagai
// flag "ikut wawancara" — TIDAK ada kolom terpisah). NOTE: literal
// cutoff di sini HARUS disamakan manual dengan yang ada di
// record_subscription_payment() (migration 074) kalau tanggalnya
// diubah — dua sumber kebenaran, tidak ada satu tempat yang otomatis
// sinkron (fungsi SQL tidak bisa import konstanta TS).
export const FOUNDER_CUTOFF_ISO = '2027-01-01T00:00:00+07:00';

// Batas eligibility Perkenalan (brief: "mulai berlangganan paling
// lambat 31 Des 2027") — dibandingkan ke period_start pembayaran
// (tanggal MULAI periode yang dibayar/disarankan), bukan tanggal daftar
// business.
export const PERKENALAN_CUTOFF_ISO = '2027-12-31T23:59:59+07:00';

// Sebelum tanggal ini, app belum boleh menampilkan angka harga ATAU
// status tingkat apa pun sama sekali (review -c1: bisa membocorkan
// rencana harga sebelum pengumuman resmi). Tetap tampilkan kalimat
// "harga diumumkan sebelum 20 Desember" yang sudah ada. Dibandingkan
// lewat Date lokal browser biasa (bukan helper WIB-eksplisit) —
// disetujui -c1 2 Nov 2026: angka yang tampil di app cuma
// display/saran, jam tangan browser yang salah tidak bisa membuat
// pembayaran sungguhan lebih murah karena satu-satunya jalur tulis
// (record_subscription_payment) selalu diisi admin setelah verifikasi
// manual transfer. Tanggal diupdate 24 Nov 2026 ke 20 Des 2026 (brief
// Post 31, pengumuman resmi), sebelumnya 4 Des 2026 placeholder lama.
export const PRICING_ANNOUNCE_AT_ISO = '2026-12-20T00:00:00+07:00';

export function pricingAnnounced(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(PRICING_ANNOUNCE_AT_ISO).getTime();
}

// Eligibility pendiri: `founderOverride` non-null (ditandai/dibatalkan
// manual admin, migration 060 — SEKALIGUS flag "ikut wawancara", lihat
// komentar FOUNDER_CUTOFF_ISO) SELALU menang atas aturan otomatis.
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

// Tiga tingkat harga -- Opsi B (keputusan Andi 24 Nov 2026, lihat
// migration 074): setelah masa Pendiri (founder_price_until) lewat,
// business mendapat Perkenalan 49rb SELAMANYA selama langganannya tidak
// pernah putus (`perkenalanLockedForever`, disimpan sebagai DATA oleh
// record_subscription_payment() -- BUKAN dihitung ulang dari tanggal di
// sini, cuma dibaca apa adanya). Kalau putus, kunci itu dicabut (oleh
// backend) dan perkenalan_price_until di-reset -- business comeback
// dievaluasi lagi dari awal via perkenalanPriceUntil (jendela 12 bulan
// baru dari comeback) atau langsung Normal kalau sudah lewat batas 31
// Des 2027.
//
// `periodStart` = tanggal yang sedang dievaluasi (biasanya HARI INI
// untuk tampilan status berjalan, atau tanggal mulai periode berikutnya
// untuk saran pembayaran) -- format YYYY-MM-DD.
export function resolvePriceTier(params: {
  founderEligible: boolean;
  founderPriceUntil: string | null;
  perkenalanLockedForever: boolean;
  perkenalanPriceUntil: string | null;
  periodStart: string;
}): PriceTier {
  const { founderEligible, founderPriceUntil, perkenalanLockedForever, perkenalanPriceUntil, periodStart } = params;

  if (isFounderPricing(founderEligible, founderPriceUntil, periodStart)) {
    return 'founder';
  }
  if (perkenalanLockedForever) {
    return 'perkenalan';
  }
  if (perkenalanPriceUntil !== null) {
    return periodStart <= perkenalanPriceUntil ? 'perkenalan' : 'normal';
  }
  // Belum pernah bayar SAMA SEKALI (perkenalanPriceUntil null) DAN bukan
  // (lagi) Pendiri -- saran Perkenalan untuk pembayaran pertama selama
  // masih sebelum batas eligibility-nya, pola sama isFounderPricing()
  // untuk founderPriceUntil null.
  if (founderPriceUntil === null) {
    return periodStart <= PERKENALAN_CUTOFF_ISO.slice(0, 10) ? 'perkenalan' : 'normal';
  }
  return 'normal';
}
