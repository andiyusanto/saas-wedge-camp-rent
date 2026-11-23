// Isi struk thermal 58/80 mm -- fungsi murni dari ReceiptData yang sama
// dengan struk WA (formatters.ts) dan Nota A4 (InvoiceModal.tsx). Semua
// aturan bisnis yang sudah ada WAJIB ikut di sini juga (lihat
// research/brief-cetak-printer-thermal-2026-11.md): jaminan "Rencana saat
// ambil", denda telat vs rusak/hilang dipisah + nama alat, "Kembali paling
// lambat", Paket "Paket X xN" + rincian komponen, rupiah dibulatkan.
import type { ReceiptData } from './formatters';
import {
  formatIDR,
  formatDateIndo,
  rentalDays,
  depositLabel,
  fineLabel,
  addDaysStr,
  groupReceiptItemsByBundle,
  computeRemainingBalance,
  formatRentalDuration,
  formatPickedUpEarlyLine,
  PAYMENT_METHOD_LABEL,
  PAYMENT_KIND_LABEL,
} from './formatters';
import type { ThermalLine } from './escpos';
import { sanitizeAscii } from './escpos';

export type PaperWidth = 58 | 80;

export function columnsForPaperWidth(width: PaperWidth): number {
  return width === 58 ? 32 : 48;
}

// Bungkus teks ke lebar kolom (word-wrap sederhana per spasi, pecah paksa
// kalau satu kata lebih panjang dari kolom -- jarang terjadi tapi jangan
// sampai infinite loop).
function wrapText(text: string, width: number): string[] {
  const words = sanitizeAscii(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    let w = word;
    while (w.length > width) {
      out.push((line ? line + ' ' : '') + w.slice(0, width - (line ? line.length + 1 : 0)));
      w = w.slice(width - (line ? line.length + 1 : 0));
      line = '';
    }
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length > width) {
      if (line) out.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) out.push(line);
  return out.length > 0 ? out : [''];
}

// Baris "label ... nilai" rata kanan, label dibungkus kalau perlu, nilai
// selalu di baris terakhir (dipindah ke baris sendiri kalau tidak muat).
function priceRow(label: string, rawValue: string, width: number): string[] {
  // formatIDR() (Intl id-ID) menyisipkan NBSP (U+00A0) sebagai pemisah --
  // disanitasi jadi spasi biasa di sini, bukan di formatIDR itu sendiri
  // (dipakai juga di struk WA/Nota A4 yang tidak masalah dengan NBSP).
  const value = sanitizeAscii(rawValue);
  const wrapped = wrapText(label, width);
  const last = wrapped[wrapped.length - 1];
  const gap = width - last.length - value.length;
  if (gap >= 1) {
    wrapped[wrapped.length - 1] = last + ' '.repeat(gap) + value;
    return wrapped;
  }
  return [...wrapped, value.padStart(width)];
}

function centered(text: string, width: number): string {
  const t = sanitizeAscii(text);
  if (t.length >= width) return t.slice(0, width);
  const padTotal = width - t.length;
  const left = Math.floor(padTotal / 2);
  return ' '.repeat(left) + t;
}

export type ThermalReceiptDoc = { lines: ThermalLine[]; textLines: string[] };

export function buildThermalReceiptDoc(data: ReceiptData, paperWidth: PaperWidth): ThermalReceiptDoc {
  const width = columnsForPaperWidth(paperWidth);
  const days = rentalDays(data.startDate, data.endDate, data.rentalDayMode);
  const totalFines = data.fines.reduce((sum, f) => sum + f.amount, 0);
  // Pelunasan (brief 17 Nov 2026) -- sisa tagihan termasuk denda, lihat
  // computeRemainingBalance() di formatters.ts.
  const remaining = computeRemainingBalance(data.totalPrice, totalFines, data.dpPaid);
  // Perbaikan bug tampilan (koordinator 17 Nov 2026) -- "Total Tagihan"
  // SEKARANG SELALU termasuk denda (data.totalPrice tetap sewa+barang
  // jual yang dipercaya apa adanya, tidak dihitung ulang di sini).
  const totalTagihan = data.totalPrice + totalFines;

  const lines: ThermalLine[] = [];
  const textLines: string[] = [];

  const addText = (text: string, opts: { bold?: boolean; align?: 'left' | 'center' | 'right'; doubleHeight?: boolean } = {}) => {
    const wrapped = opts.align === 'center' ? [sanitizeAscii(text)] : wrapText(text, width);
    for (const t of wrapped) {
      lines.push({ kind: 'text', text: t, bold: opts.bold, align: opts.align, doubleHeight: opts.doubleHeight });
      textLines.push(opts.align === 'center' ? centered(t, width) : t);
    }
  };
  const addRule = () => {
    lines.push({ kind: 'rule', width });
    textLines.push('-'.repeat(width));
  };
  const addPriceRow = (label: string, value: string) => {
    for (const row of priceRow(label, value, width)) {
      lines.push({ kind: 'text', text: row });
      textLines.push(row);
    }
  };
  const addBlank = () => {
    lines.push({ kind: 'text', text: '' });
    textLines.push('');
  };

  if (data.isReprint) {
    addText(`SALINAN - dicetak ulang ${formatDateIndo(data.reprintedAt ?? '')}`, { bold: true, align: 'center' });
  }
  addText(data.businessName.toUpperCase(), { bold: true, align: 'center', doubleHeight: true });
  addText('Nota Sewa Alat Outdoor', { align: 'center' });
  addRule();
  addText(`Kode: ${data.bookingNumber}`);
  addText(`Penyewa: ${data.customerName}`);
  if (data.customerPhone) addText(`WA: ${data.customerPhone}`);
  addText(`Mulai Sewa: ${formatDateIndo(data.startDate)}`);
  const pickedUpEarlyLine = formatPickedUpEarlyLine(data.startDate, data.pickedUpAt, data.timezone);
  if (pickedUpEarlyLine) addText(pickedUpEarlyLine);
  addText(`Kembali: ${formatDateIndo(data.endDate)} (${formatRentalDuration(days, data.durationLabelStyle ?? null, data.rentalDayMode)})`);
  if (data.returnDeadlineTime) {
    const dueDate =
      data.returnDeadlineNextDay || data.returnDeadlineTime === '00:00' ? addDaysStr(data.endDate, 1) : data.endDate;
    addText(`Plg lambat: ${formatDateIndo(dueDate)}, ${data.returnDeadlineTime}`);
  }
  addRule();

  for (const group of groupReceiptItemsByBundle(data.items)) {
    if (group.bundleName) {
      addText(`Paket ${group.bundleName}${group.bundleQuantity && group.bundleQuantity > 1 ? ` x${group.bundleQuantity}` : ''}`, {
        bold: true,
      });
      for (const item of group.items) {
        const subtotal = item.subtotal ?? item.price_per_day * item.quantity * days;
        addPriceRow(`  - ${item.name} (${item.quantity}x)`, formatIDR(subtotal));
      }
    } else {
      for (const item of group.items) {
        const subtotal = item.subtotal ?? item.price_per_day * item.quantity * days;
        addPriceRow(`${item.name} (${item.quantity}x)`, formatIDR(subtotal));
      }
    }
  }
  addRule();

  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- bagian terpisah
  // dari alat sewa, flat (tidak tergantung jumlah hari). Rental tanpa
  // barang jual (data.saleItems kosong) menghasilkan struk PERSIS
  // seperti sebelum fitur ini ada (regresi aman).
  const rentalSubtotal = data.items.reduce(
    (sum, i) => sum + (i.subtotal ?? i.price_per_day * i.quantity * days),
    0,
  );
  if (data.saleItems.length > 0) {
    addText('BARANG JUAL', { bold: true });
    for (const s of data.saleItems) {
      addPriceRow(`${s.name} (${s.quantity}x)`, formatIDR(s.subtotal));
    }
    addRule();
  }

  // Rincian Denda (koordinator 17 Nov 2026: dipindah ke SEBELUM Total
  // Tagihan, sebelumnya muncul setelah Jaminan Sewa di bagian bawah --
  // isi/itemisasinya TIDAK berubah, cuma posisinya, supaya "Total
  // Tagihan" di bawahnya sudah mencerminkan semua denda).
  if (data.fines.length > 0) {
    addText('RINCIAN DENDA', { bold: true });
    for (const f of data.fines) {
      const label = `${fineLabel(f.type)}${f.item_name ? ` (${f.item_name})` : ''}${f.description ? ` - ${f.description}` : ''}`;
      addPriceRow(label, formatIDR(f.amount));
    }
    addPriceRow('Total Denda', formatIDR(totalFines));
    addRule();
  }

  addPriceRow('Total Sewa', formatIDR(rentalSubtotal));
  if (data.discountAmount && data.discountAmount > 0) {
    addPriceRow(`Diskon ${data.discountTypeName ?? ''} ${data.discountPercent ?? 0}%`, `-${formatIDR(data.discountAmount)}`);
  }
  if (data.saleItems.length > 0) {
    addPriceRow('Total Barang Jual', formatIDR(data.saleItems.reduce((sum, s) => sum + s.subtotal, 0)));
  }
  addPriceRow('Total Tagihan', formatIDR(totalTagihan));
  // Perbaikan bug tampilan (koordinator 17 Nov 2026): "DP Terbayar" diganti
  // "Total Dibayar" -- baris ini SELALU total SEMUA pembayaran (dp_paid),
  // bukan cuma DP awal, meski riwayat pembayaran di bawahnya tetap
  // memberi label "DP" untuk baris pertama.
  addPriceRow('Total Dibayar', formatIDR(data.dpPaid));
  if ((data.payments ?? []).length > 0) {
    addRule();
    addText('RIWAYAT PEMBAYARAN', { bold: true });
    for (const p of data.payments ?? []) {
      const label = `${formatDateIndo(p.paidAt.slice(0, 10))} ${PAYMENT_KIND_LABEL[p.kind] ?? p.kind}${p.method ? ` (${PAYMENT_METHOD_LABEL[p.method] ?? p.method})` : ''}`;
      addPriceRow(label, formatIDR(p.amount));
    }
  }
  if (remaining > 0) {
    addPriceRow('Sisa Tagihan', formatIDR(remaining));
  } else if (remaining < 0) {
    addPriceRow('Lebih Bayar', formatIDR(Math.abs(remaining)));
  } else {
    addText('LUNAS', { bold: true });
  }

  if (data.depositType) {
    addRule();
    addText('JAMINAN SEWA', { bold: true });
    addText(`Tipe: ${depositLabel(data.depositType)}`);
    if (data.depositNote) addText(`Catatan: ${data.depositNote}`);
    const statusText =
      data.depositStatus === 'dikembalikan'
        ? 'Sudah Dikembalikan'
        : data.status === 'dipesan'
          ? 'Akan Diminta Saat Ambil'
          : 'Ditahan di Kasir';
    addText(`Status: ${statusText}`);
  }

  addRule();
  addText(`Status: ${data.status === 'dipesan' ? 'Siap Diambil' : data.status.toUpperCase()}`, { align: 'center' });
  addBlank();
  addText(`Terima kasih - ${data.businessName}`, { align: 'center' });
  if (data.businessAddress) addText(data.businessAddress, { align: 'center' });

  return { lines, textLines };
}

export function buildThermalTestReceipt(businessName: string, paperWidth: PaperWidth, dateLabel: string): ThermalReceiptDoc {
  const width = columnsForPaperWidth(paperWidth);
  const lines: ThermalLine[] = [
    { kind: 'text', text: sanitizeAscii(businessName.toUpperCase()), bold: true, align: 'center', doubleHeight: true },
    { kind: 'rule', width },
    { kind: 'text', text: 'Printer siap dipakai OK', align: 'center' },
    { kind: 'text', text: dateLabel, align: 'center' },
    { kind: 'text', text: 'Sewalog', align: 'center' },
  ];
  const textLines = [
    centered(businessName.toUpperCase(), width),
    '-'.repeat(width),
    centered('Printer siap dipakai OK', width),
    centered(dateLabel, width),
    centered('Sewalog', width),
  ];
  return { lines, textLines };
}
