// Sama persis logikanya dengan getWhatsAppShareUrl() di
// frontend/src/utils/formatters.ts — tidak bisa di-share langsung karena
// frontend dan backend workspace terpisah, jadi disalin di sini. Kalau
// salah satu diubah (mis. dukung format nomor baru), ubah juga yang satunya.
export function buildWhatsAppUrl(phone: string, text: string): string {
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '62' + cleanPhone.slice(1);
  }
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}
