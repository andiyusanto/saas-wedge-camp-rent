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
