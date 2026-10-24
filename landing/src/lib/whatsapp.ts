import { normalizePhone, formatDisplay } from './phone';

// Nomor dari VITE_SUPPORT_WHATSAPP_NUMBER (lihat landing/.env.example) — nomor
// yang sama dipakai di frontend/src/components/OnlineStoreScreen.tsx dan
// GuideScreen.tsx (satu nomor support Sewalog, tiga workspace terpisah jadi
// tiga env var terpisah, tapi harus diisi nilai yang sama).
const RAW_WHATSAPP_NUMBER = import.meta.env.VITE_SUPPORT_WHATSAPP_NUMBER ?? '62xxxxxxxxxx';

const WHATSAPP_NUMBER = normalizePhone(RAW_WHATSAPP_NUMBER);

export const WHATSAPP_DISPLAY = formatDisplay(WHATSAPP_NUMBER);

export function waLink(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
