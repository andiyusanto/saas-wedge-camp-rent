// Fungsi murni (tanpa import.meta.env) supaya bisa dipakai dua tempat:
// src/lib/whatsapp.ts (landing React) dan vite.config.ts (isi nomor asli ke
// public/blog/*.html saat build). Satu sumber format nomor untuk keduanya.

// Boleh format lokal (08xx) atau internasional (62xx) di .env — wa.me cuma
// menerima format internasional tanpa "+"/"0" di depan.
export function normalizePhone(phone: string): string {
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('0')) clean = '62' + clean.slice(1);
  return clean;
}

// "+62 858-1573-4091" — cuma dipakai buat ditampilkan sebagai teks (bukan
// link). Fallback ke digit polos kalau panjangnya tidak sesuai pola nomor HP
// Indonesia biasa (11 digit setelah "62"), supaya tidak salah bentuk kalau
// suatu saat diisi nomor kantor/format lain.
export function formatDisplay(normalized: string): string {
  const rest = normalized.startsWith('62') ? normalized.slice(2) : normalized;
  if (rest.length !== 11) return `+${normalized}`;
  return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
}
