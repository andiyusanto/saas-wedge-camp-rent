// Rencana 2.8: satu titik kunci untuk penguncian fitur pesanan online ke
// paket berbayar nanti. Untuk versi pertama (sebelum sistem paket live),
// SELALU true untuk semua business — ditulis sekarang (bukan ditunda)
// supaya titik kuncinya sudah ada sebelum sistem paket datang, ganti isi
// SATU fungsi ini saat itu (mis. jadi `business.plan === 'pro'`) daripada
// mencari-cari semua tempat yang perlu dicek ulang.
export function businessCanAcceptOnlineOrders(_businessId: string): boolean {
  return true;
}
