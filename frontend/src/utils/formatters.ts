export function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Nama hari singkat Indonesia, indeks SAMA PERSIS dengan Date.getDay()
// (0 = Minggu). Dipakai formatDateIndo() di bawah.
const DAY_NAMES_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Format tanggal diseragamkan dd-mm-yyyy (keputusan Andi 10 Nov 2026) —
// RAKIT MANUAL dari angka, sengaja TIDAK lewat Intl.DateTimeFormat/
// toLocaleDateString: Intl id-ID bisa memakai "/" atau nama bulan dan
// hasilnya bisa beda antar runtime/browser, sedangkan date picker bawaan
// (input type="date") juga sudah ambigu (format ikut bahasa perangkat) —
// tampilan lain di aplikasi tidak boleh ikut ambigu juga.
export function formatDateIndo(dateStr: string, withDay: boolean = true): string {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime())) return dateStr;

  const formatted = `${pad2(day)}-${pad2(month)}-${year}`;
  return withDay ? `${DAY_NAMES_ID[date.getDay()]}, ${formatted}` : formatted;
}

// Sama alasan rakit manual seperti formatDateIndo() di atas. Tanpa nama
// hari (konsisten dengan perilaku lama) — format "dd-mm-yyyy HH:mm", jam
// 24 jam.
export function formatDateTimeIndo(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  const dateStr = `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
  const timeStr = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${dateStr} ${timeStr}`;
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

// Pakai Date lokal browser, pola sama seperti todayStr() — device vendor
// fisik ada di WIB, jadi tidak perlu offset manual seperti versi backend
// (backend/src/lib/dates.ts) yang jalan di server, mungkin beda zona.
export function addDaysStr(dateStr: string, amount: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + amount);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type RentalDayMode = 'per_malam' | 'per_hari_kalender';

// Cara hitung durasi sewa jadi pengaturan per rental (migration 049,
// keputusan Andi 2 Nov 2026) — `mode` WAJIB diisi eksplisit oleh
// pemanggil (tidak ada default diam-diam), supaya tidak ada pemanggil
// baru yang lupa dan diam-diam memakai perilaku lama.
//
// 'per_hari_kalender' = perilaku lama (inklusif, ambil & kembali hari
// sama = 1 hari). 'per_malam' = jumlah malam murni (ambil=kembali hari
// sama TIDAK VALID — dicegah di level form/API sebelum sampai sini,
// fungsi ini tidak menolak, cuma menghitung).
//
// `mode` yang dipakai HARUS snapshot yang tersimpan di baris transaksi
// (bookings.rental_day_mode, null untuk baris lama = diperlakukan
// 'per_hari_kalender'), BUKAN pengaturan businesses.rental_day_mode
// yang SEDANG berlaku — supaya nota/struk/denda transaksi lama tidak
// pernah berubah kalau vendor ganti pengaturan ini belakangan. Satu-
// satunya pengecualian: transaksi BARU yang sedang diisi di Catat
// Transaksi (NewBookingModal) belum punya snapshot sama sekali, jadi
// memakai pengaturan LIVE business saat itu (itu snapshot yang akan
// dibuat begitu disimpan).
//
// Pakai Date lokal browser (perangkat vendor sudah WIB), bukan
// toISOString/UTC — lihat catatan di backend/src/lib/dates.ts soal
// jebakan pergeseran tanggal serupa.
export function rentalDays(start: string, end: string, mode: RentalDayMode | null): number {
  const ms = new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime();
  const nights = Math.round(ms / 86_400_000);
  return mode === 'per_malam' ? Math.max(1, nights) : Math.max(1, nights + 1);
}

// Label lama sewa "2H1M" (bagian E, migration 072, brief 23 Nov 2026) --
// SATU helper, dipakai di struk WA/Nota A4/struk thermal/ringkasan Catat
// Transaksi/Transaksi Aktif/Riwayat (brief eksplisit: jangan diduplikasi).
// Murni TEKS -- tidak menyentuh harga/denda/stok sama sekali, dan harga
// tetap selalu "/hari" di katalog/tarif bertingkat (tidak disentuh style
// ini). style null (baris lama/belum diatur) ditafsirkan 'hari', sama
// pola rental_day_mode (migration 049) -- regresi: tampilan identik
// sebelum fitur ini ada. 'hari_malam' CUMA berarti sesuatu untuk mode
// per_malam (N malam -> N+1 hari, mis. 1 malam = "2H1M") -- dipanggil
// dengan style 'hari' untuk rental per_hari_kalender di semua call site
// (keputusan koordinator: rental_day_mode='per_hari_kalender' tidak
// pernah melihat pengaturan ini).
export type DurationLabelStyle = 'hari' | 'hari_malam' | null;

// rentalDayMode WAJIB diperiksa DI SINI (bukan tiap call site) --
// snapshot duration_label_style tetap bisa 'hari_malam' walau rental
// belakangan pindah ke rental_day_mode='per_hari_kalender' (owner pernah
// memilih 2H1M, lalu ganti mode) -- "N+1H/NM" cuma bermakna untuk sewa
// per MALAM, jadi dipaksa 'hari' kalau mode bukan 'per_malam', terlepas
// dari nilai style yang tersimpan (catatan review koordinator 23 Nov
// 2026). Satu titik pemeriksaan ini mencegah kalau-kalau yang sama harus
// diulang di 6+ tempat pemakaian (struk WA/Nota/thermal/ringkasan Catat
// Transaksi/Transaksi Aktif/Riwayat).
export function formatRentalDuration(nights: number, style: DurationLabelStyle, rentalDayMode: RentalDayMode | null): string {
  if (style === 'hari_malam' && rentalDayMode === 'per_malam') {
    return `${nights + 1}H${nights}M`;
  }
  return `${nights} hari`;
}

// Harga bertingkat per-hari (migration 034, diadaptasi dari Bilbo-Outdoors
// src/pricing.ts — TAPI semantik beda sengaja, lihat komentar migrasinya:
// ini TARIF PER HARI itu sendiri, bukan total kumulatif ala Bilbo).
// price_per_day = tarif hari ke-1, day2Rate..day5Rate = tarif hari ke-2..5,
// extraDayRate = tarif tiap hari ke-6 dst. Total sewa N hari = jumlah
// tarif hari 1..min(N,5) + maks(0,N-5) x extraDayRate. Alat flat (semua
// tingkat sama dengan price_per_day) otomatis jadi N x harga flat.
//
// Salinannya di backend (backend/src/lib/pricing.ts) JUGA dipakai untuk
// denda keterlambatan bertingkat (backend/src/lib/penalty.ts
// computeTieredLateFee) — booking_items.*_at_booking (migration 034)
// menyimpan snapshot tarif ini per baris, diisi server-side saat
// transaksi dibuat (bukan dari sini/frontend).
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

// Paket Alat Tahap 1 (brief 15 Nov 2026, migration 064) -- salinan
// frontend dari backend/src/lib/pricing.ts allocateBundlePrice dkk
// (satu definisi per runtime, pola sama computeItemRentalPrice di atas
// -- lihat migration 034). Dipakai NewBookingModal.tsx saat memecah
// paket jadi booking_items per komponen sebelum POST /bookings.
export type BundleComponent = { item_id: string; quantityPerBundle: number; catalogRates: ItemDayRates };

export function combinedComponentRates(components: BundleComponent[]): ItemDayRates {
  const sum = (key: keyof ItemDayRates) =>
    components.reduce((total, c) => total + c.catalogRates[key] * c.quantityPerBundle, 0);
  return {
    price_per_day: sum('price_per_day'),
    day2_rate: sum('day2_rate'),
    day3_rate: sum('day3_rate'),
    day4_rate: sum('day4_rate'),
    day5_rate: sum('day5_rate'),
    extra_day_rate: sum('extra_day_rate'),
  };
}

export function applyBundleDiscount(
  rates: ItemDayRates,
  discountType: 'percent' | 'nominal' | null,
  discountValue: number | null,
): ItemDayRates {
  if (!discountType || !discountValue) return rates;
  // Dibulatkan ke rupiah terdekat per tingkat (koordinator 16 Nov 2026,
  // pola sama backend/src/lib/pricing.ts) -- tarif ganjil × persen bisa
  // desimal.
  const apply = (v: number) =>
    Math.round(discountType === 'percent' ? Math.max(0, v * (1 - discountValue / 100)) : Math.max(0, v - discountValue));
  return {
    price_per_day: apply(rates.price_per_day),
    day2_rate: apply(rates.day2_rate),
    day3_rate: apply(rates.day3_rate),
    day4_rate: apply(rates.day4_rate),
    day5_rate: apply(rates.day5_rate),
    extra_day_rate: apply(rates.extra_day_rate),
  };
}

export type AllocatedComponent = { item_id: string; subtotalPerInstance: number };

export function allocateBundlePrice(components: BundleComponent[], totalPerInstance: number, days: number): AllocatedComponent[] {
  const standalone = components.map((c) => computeItemRentalPrice(c.catalogRates, days) * c.quantityPerBundle);
  const standaloneSum = standalone.reduce((a, b) => a + b, 0);

  if (standaloneSum <= 0) {
    const equal = Math.floor(totalPerInstance / components.length);
    const result = components.map((c) => ({ item_id: c.item_id, subtotalPerInstance: equal }));
    result[0].subtotalPerInstance += totalPerInstance - equal * components.length;
    return result;
  }

  const raw = standalone.map((s) => Math.floor((s / standaloneSum) * totalPerInstance));
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const remainder = totalPerInstance - rawSum;

  return components.map((c, i) => ({ item_id: c.item_id, subtotalPerInstance: raw[i] + (i === 0 ? remainder : 0) }));
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
export type ReceiptItem = {
  name: string;
  quantity: number;
  price_per_day: number;
  subtotal?: number | null;
  bundle_instance_id?: string | null;
  bundle_name?: string | null;
  bundle_quantity?: number | null;
};
export type ReceiptFine = {
  type: string;
  amount: number;
  description?: string | null;
  item_name?: string | null;
};

// Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
// tipe TERPISAH dari ReceiptItem (bukan reuse) karena barang jual tidak
// punya tarif per-hari bertingkat, cuma harga satuan flat -- subtotal =
// harga × qty, tidak tergantung jumlah hari sewa sama sekali.
export type ReceiptSaleItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

// Pelunasan + Nota Cetak Ulang (brief 17 Nov 2026, migration 067) --
// riwayat pembayaran APA ADANYA dari booking_payments (termasuk baris
// trigger DP awal dan koreksi/refund negatif), dipakai struk WA/A4/
// thermal buat tampilkan daftar + status LUNAS/sisa.
export type ReceiptPayment = {
  amount: number;
  method: string | null;
  kind: string;
  note: string | null;
  paidAt: string;
};

export type ReceiptData = {
  bookingNumber: string;
  customerName: string;
  customerPhone: string;
  startDate: string;
  endDate: string;
  items: ReceiptItem[];
  saleItems: ReceiptSaleItem[];
  totalPrice: number;
  dpPaid: number;
  depositType: string | null;
  depositNote: string | null;
  depositStatus: 'ditahan' | 'dikembalikan' | null;
  status: string;
  fines: ReceiptFine[];
  businessName: string;
  businessAddress?: string | null;
  businessLogoUrl?: string | null;
  // Snapshot (migration 049) — null = transaksi dari sebelum fitur ini,
  // ditafsirkan 'per_hari_kalender' oleh rentalDays(). Jangan pernah
  // diisi dari businesses.rental_day_mode yang SEDANG berlaku.
  rentalDayMode: RentalDayMode | null;
  // Snapshot batas jam kembali (migration 062) — null = ikuti jam ambil,
  // tidak ada baris "Kembali paling lambat" ditampilkan.
  returnDeadlineTime?: string | null;
  returnDeadlineNextDay?: boolean | null;
  // Opsional, default kosong/false -- supaya struk yang dibangun dari
  // TrackingScreen.tsx (belum diisi field ini) tetap identik seperti
  // sebelum fitur Pelunasan/Nota Ulang ada (regresi aman).
  payments?: ReceiptPayment[];
  isReprint?: boolean;
  reprintedAt?: string | null;
  // Mulai Sewa + ambil lebih awal (brief 23 Nov 2026) -- opsional, default
  // null/undefined supaya struk tanpa field ini (belum diisi) tetap
  // identik seperti sebelum fitur ini ada. timezone dipakai membaca
  // TANGGAL picked_up_at di zona rental (pola migration 053), bukan UTC.
  pickedUpAt?: string | null;
  timezone?: string | null;
  // Snapshot label lama sewa (migration 072) -- null = 'hari' (regresi).
  durationLabelStyle?: DurationLabelStyle;
};

// Baris "Diambil: {tanggal jam}" (brief 23 Nov 2026 bagian A) -- CUMA
// tampil kalau TANGGAL picked_up_at (di zona rental) berbeda dari
// start_date. Sama kalau diambil tepat waktu -> baris tidak muncul,
// supaya struk lama/transaksi yang diambil normal tampil PERSIS seperti
// sebelum fitur ini ada. SATU helper, dipakai struk WA/Nota A4/thermal.
export function formatPickedUpEarlyLine(startDate: string, pickedUpAt: string | null | undefined, timezone: string | null | undefined): string | null {
  if (!pickedUpAt) return null;
  const offsetHours = TZ_OFFSET_HOURS[timezone ?? 'Asia/Jakarta'] ?? 7;
  const localMs = new Date(pickedUpAt).getTime() + offsetHours * 3_600_000;
  const local = new Date(localMs);
  const pickedUpDateStr = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
  if (pickedUpDateStr === startDate) return null;
  const hh = pad2(local.getUTCHours());
  const mm = pad2(local.getUTCMinutes());
  return `Diambil: ${formatDateIndo(pickedUpDateStr)} ${hh}:${mm}`;
}

// toDateStrInTzFrontend: versi ringan toDateStrInTz (backend/src/lib/
// dates.ts) untuk dipakai di frontend -- offset WIB/WITA/WIT dihitung
// manual (Indonesia tanpa DST, CLAUDE.md bagian 4), BUKAN lewat
// toLocaleDateString (tergantung locale/timezone browser, bisa beda dari
// zona RENTAL kalau staf mengakses dari luar zona itu).
const TZ_OFFSET_HOURS: Record<string, number> = {
  'Asia/Jakarta': 7,
  'Asia/Makassar': 8,
  'Asia/Jayapura': 9,
};

// Pelunasan (brief 17 Nov 2026) -- SATU sumber "sisa tagihan" dipakai di
// kartu Transaksi Aktif, Riwayat, Nota/struk, ekspor, dan Laporan. Rumus
// = sewa+barang jual (totalPrice SUDAH gabungan sejak migration 066) +
// denda - total dibayar. paidTotal HARUS selalu booking.dp_paid (cache
// yang disinkronkan trigger/RPC add_booking_payment) -- BUKAN Σ
// booking_payments dihitung ulang di tempat lain, supaya angka ini
// selalu sinkron dengan sisa tagihan yang divalidasi RPC saat pelunasan
// (catatan koordinator 17 Nov 2026). SENGAJA TIDAK di-clamp ke 0 --
// kalau hasilnya negatif ("lebih bayar", mis. setelah Ubah Alat/Ubah
// Jadwal mengurangi total setelah sudah dibayar), pemanggil yang
// menentukan tampilannya sendiri (lihat remainingLabel di bawah),
// supaya vendor sadar ada uang yang mesti dikembalikan/dikoreksi,
// bukan diam-diam disembunyikan jadi "LUNAS".
export function computeRemainingBalance(totalPrice: number, penaltiesTotal: number, paidTotal: number): number {
  return totalPrice + penaltiesTotal - paidTotal;
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  tunai: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
};

export const PAYMENT_KIND_LABEL: Record<string, string> = {
  dp: 'DP',
  pelunasan: 'Pelunasan',
  pembayaran: 'Pembayaran',
  koreksi: 'Koreksi/Refund',
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

// Kelompokkan baris struk ber-bundle_instance_id sama jadi satu grup
// "Paket X ×N" (dipakai struk WA di atas, dan bisa dipakai tampilan
// lain, mis. InvoiceModal.tsx/TrackingScreen.tsx) -- baris tanpa
// penanda tetap satu grup sendiri-sendiri (bundleName null).
export type ReceiptItemGroup = { bundleName: string | null; bundleQuantity: number | null; items: ReceiptItem[] };

export function groupReceiptItemsByBundle(items: ReceiptItem[]): ReceiptItemGroup[] {
  const groups: ReceiptItemGroup[] = [];
  const instanceIndex = new Map<string, number>();
  for (const item of items) {
    if (item.bundle_instance_id) {
      const existingIdx = instanceIndex.get(item.bundle_instance_id);
      if (existingIdx != null) {
        groups[existingIdx].items.push(item);
        continue;
      }
      instanceIndex.set(item.bundle_instance_id, groups.length);
      groups.push({ bundleName: item.bundle_name ?? null, bundleQuantity: item.bundle_quantity ?? null, items: [item] });
    } else {
      groups.push({ bundleName: null, bundleQuantity: null, items: [item] });
    }
  }
  return groups;
}

export function generateWhatsAppReceipt(data: ReceiptData): string {
  const days = rentalDays(data.startDate, data.endDate, data.rentalDayMode);
  const itemsText = groupReceiptItemsByBundle(data.items)
    .map((group) => {
      const line = (i: ReceiptItem) => `• ${i.name} (${i.quantity}x) = ${formatIDR(i.subtotal ?? i.price_per_day * i.quantity * days)}`;
      if (!group.bundleName) return group.items.map(line).join('\n');
      const header = `• Paket ${group.bundleName}${group.bundleQuantity && group.bundleQuantity > 1 ? ` x${group.bundleQuantity}` : ''}`;
      return [header, ...group.items.map((i) => `   - ${line(i).slice(2)}`)].join('\n');
    })
    .join('\n');

  const totalFines = data.fines.reduce((sum, f) => sum + f.amount, 0);
  // Pelunasan (brief 17 Nov 2026) -- sisa tagihan SEKARANG termasuk
  // denda (lihat computeRemainingBalance), tidak lagi cuma totalPrice-
  // dpPaid seperti sebelumnya.
  const remaining = computeRemainingBalance(data.totalPrice, totalFines, data.dpPaid);
  // Perbaikan bug tampilan (koordinator 17 Nov 2026, ditemukan dari Nota
  // reprint Pelunasan): "Total Tagihan" SEBELUMNYA cuma data.totalPrice
  // (sewa+barang jual), tidak pernah termasuk denda -- padahal "Sisa
  // Pembayaran"/LUNAS di bawahnya SUDAH termasuk denda (computeRemaining
  // Balance), jadi dua angka itu tidak nyambung dan pelanggan bisa
  // mengira salah hitung/lebih bayar. totalTagihan di sini SEKARANG
  // SELALU = data.totalPrice + totalFines (data.totalPrice tetap angka
  // akhir sewa+barang jual yang dipercaya -- bisa diedit manual vendor,
  // TIDAK dihitung ulang dari jumlah item di sini, pola yang sama
  // seperti sebelumnya).
  const totalTagihan = data.totalPrice + totalFines;

  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- terpisah dari
  // alat sewa, tidak tergantung jumlah hari.
  const saleItemsText = data.saleItems
    .map((s) => `• ${s.name} (${s.quantity}x) @${formatIDR(s.unitPrice)} = ${formatIDR(s.subtotal)}`)
    .join('\n');
  const saleItemsTotal = data.saleItems.reduce((sum, s) => sum + s.subtotal, 0);
  const rentalSubtotal = data.items.reduce(
    (sum, i) => sum + (i.subtotal ?? i.price_per_day * i.quantity * days),
    0,
  );

  // Rincian Denda (brief 17 Nov 2026: dipindah ke SEBELUM Total Tagihan,
  // sebelumnya muncul setelah Jaminan Sewa di bagian bawah struk --
  // isi/itemisasinya TIDAK berubah, cuma posisinya).
  let finesText = '';
  if (data.fines.length > 0) {
    finesText =
      `*RINCIAN DENDA:*\n` +
      data.fines
        .map(
          (f) =>
            `• [${fineLabel(f.type)}${f.item_name ? ` - ${f.item_name}` : ''}] ${f.description ?? ''}: ${formatIDR(f.amount)}`,
        )
        .join('\n') +
      `\nTotal Denda: *${formatIDR(totalFines)}*`;
  }

  const paymentsText = (data.payments ?? [])
    .map(
      (p) =>
        `• ${formatDateIndo(p.paidAt.slice(0, 10))} ${PAYMENT_KIND_LABEL[p.kind] ?? p.kind}${p.method ? ` (${PAYMENT_METHOD_LABEL[p.method] ?? p.method})` : ''}: ${formatIDR(p.amount)}`,
    )
    .join('\n');

  return `${data.isReprint ? `*SALINAN -- dicetak ulang ${formatDateIndo(data.reprintedAt ?? '')}*\n` : ''}*NOTA SEWA - ${data.businessName.toUpperCase()}*
Kode Booking: *${data.bookingNumber}*
---------------------------------------
Penyewa: *${data.customerName}*
WhatsApp: ${data.customerPhone}
Mulai Sewa: ${formatDateIndo(data.startDate)}${
    formatPickedUpEarlyLine(data.startDate, data.pickedUpAt, data.timezone) ? `\n${formatPickedUpEarlyLine(data.startDate, data.pickedUpAt, data.timezone)}` : ''
  }
Tanggal Kembali: ${formatDateIndo(data.endDate)} (${formatRentalDuration(days, data.durationLabelStyle ?? null, data.rentalDayMode)})${
    data.returnDeadlineTime
      ? `\nKembali paling lambat: ${formatDateIndo(
          data.returnDeadlineNextDay || data.returnDeadlineTime === '00:00' ? addDaysStr(data.endDate, 1) : data.endDate,
        )}, ${data.returnDeadlineTime}`
      : ''
  }

*DAFTAR PERALATAN:*
${itemsText}
${
  saleItemsText
    ? `\n*BARANG YANG DIBELI:*\n${saleItemsText}`
    : ''
}

---------------------------------------
Total Harga Sewa: *${formatIDR(rentalSubtotal)}*
${saleItemsText ? `Total Barang Jual: *${formatIDR(saleItemsTotal)}*\n` : ''}${
  finesText ? `${finesText}\n` : ''
}Total Tagihan: *${formatIDR(totalTagihan)}*
Total Dibayar: ${formatIDR(data.dpPaid)}
${
  paymentsText
    ? `\n*RIWAYAT PEMBAYARAN:*\n${paymentsText}\n`
    : ''
}${
  remaining > 0
    ? `*Sisa Tagihan: ${formatIDR(remaining)}*`
    : remaining < 0
      ? `*Lebih Bayar: ${formatIDR(Math.abs(remaining))}*`
      : `*LUNAS*`
}
${
  data.depositType
    ? `\n*JAMINAN SEWA:*\nTipe: *${depositLabel(data.depositType)}*\nCatatan Jaminan: ${data.depositNote || '-'}\nStatus Jaminan: *${
        // Brief 15 Nov 2026: booking 'dipesan' belum sungguhan menerima
        // jaminan (barang+KTP belum diserahkan) -- jangan sebut "DITAHAN"
        // sebelum dikonfirmasi lewat dialog Ambil.
        data.depositStatus === 'dikembalikan'
          ? 'SUDAH DIKEMBALIKAN'
          : data.status === 'dipesan'
            ? 'AKAN DIMINTA SAAT AMBIL'
            : 'DITAHAN DI KASIR'
      }*`
    : ''
}

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

// Opsi B Tahap 2, tweak label (brief 17 Nov 2026, koordinator) -- label
// "Telat, N unit terkunci ..." di kartu alat Kalender. N = TOTAL UNIT
// (jumlah quantity booking_items item ini), BUKAN jumlah transaksi -- satu
// transaksi bisa menyewa lebih dari 1 unit alat yang sama. Nama penyewa
// unik (fallback ke kode booking kalau nama kosong), diurutkan end_date
// PALING LAMA dulu, dipotong jadi "A, B +K lainnya" kalau lebih dari 2 nama
// supaya tidak memanjang di HP.
export function formatOverdueLabel(bookings: { booking_number: string | null; customer_name: string | null; end_date: string; quantity: number }[]): string {
  const totalQuantity = bookings.reduce((sum, b) => sum + b.quantity, 0);
  const sorted = [...bookings].sort((a, b) => a.end_date.localeCompare(b.end_date));

  const names: string[] = [];
  const seen = new Set<string>();
  for (const b of sorted) {
    const name = b.customer_name?.trim() || b.booking_number || 'Tanpa nama';
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  const namesText = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} lainnya`;

  return `Telat, ${totalQuantity} unit terkunci sampai dikembalikan · ${namesText}`;
}
