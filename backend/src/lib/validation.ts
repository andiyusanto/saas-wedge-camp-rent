// Validasi input umum dipakai lintas route — dipisah dari routes/trackings.ts
// (Tahap 2, migration 055) supaya bisa diuji unit tanpa menarik masuk
// supabaseClient.ts (yang melempar error kalau SUPABASE_URL/KEY belum di
// .env, tidak relevan untuk test murni logika seperti ini).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateStr(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Mengembalikan pesan error kalau tidak valid, null kalau lolos (termasuk
// kalau field-nya memang tidak dikirim sama sekali -- total_price/reason
// opsional). Dipakai PATCH /bookings/:id/reschedule dan /extend (review
// -c1 10 Nov 2026) -- sebelumnya `Number(x) || 0` diam-diam mengubah NaN
// jadi 0 dan menerima nilai minus.
export function validateOptionalTotalPriceAndReason(total_price: unknown, reason: unknown): string | null {
  if (total_price !== undefined && total_price !== null) {
    const n = Number(total_price);
    if (!Number.isFinite(n) || n < 0) {
      return 'Total harga harus angka 0 atau lebih.';
    }
  }
  if (reason !== undefined && reason !== null && String(reason).length > 500) {
    return 'Alasan perubahan maksimal 500 karakter.';
  }
  return null;
}

// Celah ditemukan koordinator 17 Nov 2026 (investigasi "Lebih Rp" di
// Riwayat, brief Pelunasan): POST /bookings sebelumnya percaya mentah
// dp_paid dari client tanpa batas atas sama sekali -- bisa membuat
// booking BARU langsung "lebih bayar" sejak lahir, kasus yang tidak
// pernah masuk akal (beda dari "lebih bayar" SETELAH Ubah Alat/Ubah
// Jadwal mengurangi total setelah sudah dibayar, yang memang dibiarkan
// terjadi by design -- lihat computeRemainingBalance, TIDAK di-clamp).
export function validateDpPaid(dp_paid: unknown, total_price: unknown): string | null {
  const dpPaid = Number(dp_paid) || 0;
  const totalPrice = Number(total_price) || 0;
  if (dpPaid < 0) return 'DP tidak boleh negatif';
  if (dpPaid > totalPrice) return 'DP tidak boleh melebihi Total Harga';
  return null;
}
