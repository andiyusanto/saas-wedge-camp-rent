// Satu titik kebenaran untuk ANGKA RUPIAH harga langganan Sewalog
// sendiri (BUKAN dana penyewa) -- salinan backend dari konsep yang sama
// di frontend/src/lib/subscriptionConfig.ts, TAPI angkanya SENGAJA cuma
// ada di sini (bukan di frontend) -- review koordinator 24 Nov 2026:
// konstanta harga di bundle JS publik (dimuat bahkan di layar login,
// sebelum login) bisa dibaca siapa pun lewat DevTools/view-source,
// membocorkan skema harga sebelum embargo PRICING_ANNOUNCE_AT_ISO (20
// Des 2026) -- padahal UI-nya sendiri sudah digerbang pricingAnnounced().
// Frontend SEKARANG mengambil tabel harga lewat GET /api/pricing
// (routes/pricing.ts), bukan import konstanta langsung.
//
// Tanggal cutoff (FOUNDER_CUTOFF_ISO dkk, frontend/src/lib/
// subscriptionConfig.ts) TIDAK dipindah ke sini -- tanggal bukan rahasia
// yang sama sensitifnya dengan ANGKA RUPIAH, dan tetap dibutuhkan
// client-side untuk resolvePriceTier() murni (date math, tanpa angka).
export const PRICING = {
  founder: { monthly: 39_000, yearly: 390_000 },
  perkenalan: { monthly: 49_000, yearly: 490_000 },
  normal: { monthly: 69_000, yearly: 690_000 },
} as const;

// HARUS disamakan manual dengan PRICING_ANNOUNCE_AT_ISO di
// frontend/src/lib/subscriptionConfig.ts kalau tanggalnya diubah -- dua
// salinan, tidak ada satu tempat yang otomatis sinkron (dua package TS
// terpisah, backend tidak bisa import dari frontend).
export const PRICING_ANNOUNCE_AT_ISO = '2026-12-20T00:00:00+07:00';

export function pricingAnnounced(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(PRICING_ANNOUNCE_AT_ISO).getTime();
}
