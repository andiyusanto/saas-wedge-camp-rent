export function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDateIndo(dateStr: string, withDay: boolean = true): string {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime())) return dateStr;

  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withDay) options.weekday = 'short';

  return new Intl.DateTimeFormat('id-ID', options).format(date);
}

export function formatDateTimeIndo(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// Dipakai buat auto-generate slug Etalase Online dari nama usaha
// (EtalaseOnlineScreen.tsx) — vendor tetap bisa edit manual sesudahnya.
// Keunikan slug-nya sendiri dijaga di level database (unique constraint,
// migration 019), bukan di sini.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // lepas diakritik (mis. "é" -> "e")
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Durasi sewa inklusif hari ambil & kembali (ambil & kembali hari yang
// sama = 1 hari sewa). Pakai Date lokal browser (perangkat vendor sudah
// WIB), bukan toISOString/UTC — lihat catatan di backend/src/lib/dates.ts
// soal jebakan pergeseran tanggal serupa.
export function rentalDays(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

// Harga bertingkat per-hari (migration 034, diadaptasi dari Bilbo-Outdoors
// src/pricing.ts — TAPI semantik beda sengaja, lihat komentar migrasinya:
// ini TARIF PER HARI itu sendiri, bukan total kumulatif ala Bilbo).
// price_per_day = tarif hari ke-1, day2Rate..day5Rate = tarif hari ke-2..5,
// extraDayRate = tarif tiap hari ke-6 dst. Total sewa N hari = jumlah
// tarif hari 1..min(N,5) + maks(0,N-5) x extraDayRate. Alat flat (semua
// tingkat sama dengan price_per_day) otomatis jadi N x harga flat.
//
// Sengaja TIDAK dipakai untuk denda keterlambatan (lihat
// backend/src/lib/penalty.ts — dailyRate di sana berasal dari
// price_at_booking, snapshot tarif hari-1 saja, tidak pernah tahu soal
// tingkat ini).
export type ItemDayRates = {
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
};

function dailyRateForDay(rates: ItemDayRates, day: number): number {
  switch (day) {
    case 1:
      return rates.price_per_day;
    case 2:
      return rates.day2_rate;
    case 3:
      return rates.day3_rate;
    case 4:
      return rates.day4_rate;
    case 5:
      return rates.day5_rate;
    default:
      return rates.extra_day_rate;
  }
}

export function computeItemRentalPrice(rates: ItemDayRates, days: number): number {
  if (days <= 0) return 0;
  let total = 0;
  for (let day = 1; day <= Math.min(days, 5); day++) total += dailyRateForDay(rates, day);
  if (days > 5) total += (days - 5) * rates.extra_day_rate;
  return total;
}

const DEPOSIT_LABEL: Record<string, string> = {
  ktp: 'KTP Asli',
  sim: 'SIM Asli',
  stnk: 'STNK Motor/Mobil',
  paspor: 'Paspor',
  uang: 'Deposit Uang Cash',
  lainnya: 'Jaminan Lainnya',
};

export function depositLabel(type: string): string {
  return DEPOSIT_LABEL[type] ?? type;
}

const FINE_LABEL: Record<string, string> = {
  keterlambatan: 'Denda Keterlambatan',
  kerusakan: 'Denda Kerusakan',
  kehilangan: 'Denda Kehilangan',
};

export function fineLabel(type: string): string {
  return FINE_LABEL[type] ?? type;
}

// subtotal = snapshot booking_items.subtotal (migration 034), dihitung
// SEKALI saat transaksi dibuat lewat computeItemRentalPrice() — bukan
// dihitung ulang dari price_per_day di sini, supaya struk tidak diam-diam
// berubah kalau harga katalog alat ini diedit belakangan. null = baris
// booking_items lama dari SEBELUM migration 034 (tidak di-backfill),
// fallback ke price_per_day * quantity * hari (perilaku lama).
export type ReceiptItem = { name: string; quantity: number; price_per_day: number; subtotal?: number | null };
export type ReceiptFine = {
  type: string;
  amount: number;
  description?: string | null;
  item_name?: string | null;
};

export type ReceiptData = {
  bookingNumber: string;
  customerName: string;
  customerPhone: string;
  startDate: string;
  endDate: string;
  items: ReceiptItem[];
  totalPrice: number;
  dpPaid: number;
  depositType: string | null;
  depositNote: string | null;
  depositStatus: 'ditahan' | 'dikembalikan' | null;
  status: string;
  fines: ReceiptFine[];
  businessName: string;
  businessAddress?: string | null;
};

const BOOKING_STATUS_LABEL: Record<string, string> = {
  dipesan: 'Siap Diambil',
  aktif: 'Sedang Disewa',
  telat: 'TERLAMBAT',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

export function bookingStatusLabel(status: string): string {
  return BOOKING_STATUS_LABEL[status] ?? status;
}

export function generateWhatsAppReceipt(data: ReceiptData): string {
  const days = rentalDays(data.startDate, data.endDate);
  const itemsText = data.items
    .map((i) => `• ${i.name} (${i.quantity}x) = ${formatIDR(i.subtotal ?? i.price_per_day * i.quantity * days)}`)
    .join('\n');

  const remaining = Math.max(0, data.totalPrice - data.dpPaid);
  const totalFines = data.fines.reduce((sum, f) => sum + f.amount, 0);

  let finesText = '';
  if (data.fines.length > 0) {
    finesText =
      `\n\n*RINCIAN DENDA:*\n` +
      data.fines
        .map(
          (f) =>
            `• [${fineLabel(f.type)}${f.item_name ? ` - ${f.item_name}` : ''}] ${f.description ?? ''}: ${formatIDR(f.amount)}`,
        )
        .join('\n');
  }

  return `*NOTA SEWA - ${data.businessName.toUpperCase()}*
Kode Booking: *${data.bookingNumber}*
---------------------------------------
Penyewa: *${data.customerName}*
WhatsApp: ${data.customerPhone}
Tanggal Ambil: ${formatDateIndo(data.startDate)}
Tanggal Kembali: ${formatDateIndo(data.endDate)} (${days} hari)

*DAFTAR PERALATAN:*
${itemsText}

---------------------------------------
Total Harga Sewa: *${formatIDR(data.totalPrice)}*
DP Terbayar: ${formatIDR(data.dpPaid)}
*Sisa Pembayaran: ${formatIDR(remaining)}*
${
  data.depositType
    ? `\n*JAMINAN SEWA:*\nTipe: *${depositLabel(data.depositType)}*\nCatatan Jaminan: ${data.depositNote || '-'}\nStatus Jaminan: *${data.depositStatus === 'dikembalikan' ? 'SUDAH DIKEMBALIKAN' : 'DITAHAN DI KASIR'}*`
    : ''
}${finesText}${totalFines > 0 ? `\nTotal Denda: *${formatIDR(totalFines)}*` : ''}

Status Sewa: *${BOOKING_STATUS_LABEL[data.status] ?? data.status}*

Terima kasih telah menyewa di ${data.businessName}!
${data.businessAddress ? `Alamat: ${data.businessAddress}` : ''}`;
}

export function getWhatsAppShareUrl(phone: string, text: string): string {
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '62' + cleanPhone.slice(1);
  }
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}
