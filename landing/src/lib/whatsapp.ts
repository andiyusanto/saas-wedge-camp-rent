// Nomor dari VITE_SUPPORT_WHATSAPP_NUMBER (lihat landing/.env.example) — nomor
// yang sama dipakai di frontend/src/components/OnlineStoreScreen.tsx dan
// GuideScreen.tsx (satu nomor support Sewalog, tiga workspace terpisah jadi
// tiga env var terpisah, tapi harus diisi nilai yang sama).
const RAW_WHATSAPP_NUMBER = import.meta.env.VITE_SUPPORT_WHATSAPP_NUMBER ?? '62xxxxxxxxxx';

// Boleh format lokal (08xx) atau internasional (62xx) di .env — wa.me cuma
// menerima format internasional tanpa "+"/"0" di depan.
function normalizePhone(phone: string): string {
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('0')) clean = '62' + clean.slice(1);
  return clean;
}

const WHATSAPP_NUMBER = normalizePhone(RAW_WHATSAPP_NUMBER);

// "+62 858-1573-4091" — cuma dipakai buat ditampilkan sebagai teks (bukan
// link), lihat LandingPage.tsx. Fallback ke digit polos kalau panjangnya
// tidak sesuai pola nomor HP Indonesia biasa (11 digit setelah "62"), supaya
// tidak salah bentuk kalau suatu saat diisi nomor kantor/format lain.
function formatDisplay(normalized: string): string {
  const rest = normalized.startsWith('62') ? normalized.slice(2) : normalized;
  if (rest.length !== 11) return `+${normalized}`;
  return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
}

export const WHATSAPP_DISPLAY = formatDisplay(WHATSAPP_NUMBER);

export function waLink(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
