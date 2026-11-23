// Kanonikalisasi nomor WA ke bentuk "628xxxxxxxxx" (tanpa '+', tanpa '0'
// depan) — 08xx dan +62xx/62xx yang merujuk nomor fisik yang sama harus
// dianggap SATU nomor yang sama. Diekstrak dari routes/bookingRequests.ts
// (migration 037, dipakai di sana untuk booking_requests.customer_phone +
// batas pesanan 'menunggu' per nomor) supaya dipakai ulang satu tempat di
// backend -- TIDAK diduplikasi lagi, beda dari pola "3 runtime" yang
// dipakai untuk rumus harga (yang memang harus ada salinan per
// frontend/backend/Etalase).
//
// Dipakai sekarang juga oleh POST /bookings (brief 23 Nov 2026 -- cocokkan
// pelanggan existing via nomor WA, supaya Member/Mitra/Waspada tidak
// ketinggalan di baris customers duplikat kalau staf ketik manual tanpa
// memilih saran). customers.phone TIDAK dinormalisasi saat disimpan (apa
// adanya dari staf ketik) -- jadi pencocokan dua nomor yang sama secara
// makna tapi beda format harus dilakukan di APLIKASI (normalisasi dulu,
// baru bandingkan), bukan `.eq()` SQL langsung ke kolom mentah.
//
// Salinan frontend: frontend/src/utils/formatters.ts normalizePhoneClient()
// -- dipakai NewBookingModal.tsx untuk saran "Pelanggan terdaftar" SEBELUM
// submit, runtime terpisah (pola sama endDateForDaysClient).
export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s-]/g, '').replace(/^\+/, '');
  if (stripped.startsWith('0')) return `62${stripped.slice(1)}`;
  return stripped;
}
