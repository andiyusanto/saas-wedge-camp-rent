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

export type ReceiptItem = { name: string; quantity: number; price_per_day: number };
export type ReceiptFine = { type: string; amount: number; description?: string | null };

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

export function generateWhatsAppReceipt(data: ReceiptData): string {
  const days = rentalDays(data.startDate, data.endDate);
  const itemsText = data.items
    .map((i) => `• ${i.name} (${i.quantity}x) = ${formatIDR(i.price_per_day * i.quantity * days)}`)
    .join('\n');

  const remaining = Math.max(0, data.totalPrice - data.dpPaid);
  const totalFines = data.fines.reduce((sum, f) => sum + f.amount, 0);

  let finesText = '';
  if (data.fines.length > 0) {
    finesText =
      `\n\n*RINCIAN DENDA:*\n` +
      data.fines.map((f) => `• [${fineLabel(f.type)}] ${f.description ?? ''}: ${formatIDR(f.amount)}`).join('\n');
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
