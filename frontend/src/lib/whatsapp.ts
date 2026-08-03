// TODO: ganti dengan nomor WhatsApp asli Sewalog sebelum landing page ini di-deploy.
const WHATSAPP_NUMBER = '62xxxxxxxxxx';

export const WHATSAPP_DISPLAY = '+62 xxx-xxxx-xxxx';

export function waLink(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
