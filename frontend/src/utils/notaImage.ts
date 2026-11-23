// Bagikan Nota sebagai Gambar (brief 24 Nov 2026, bagian B) -- dibangun
// dari ReceiptData yang SAMA dengan Nota A4 (InvoiceModal.tsx)/struk WA/
// struk thermal, bukan jalur data terpisah. Dipecah jadi dua lapis sama
// seperti thermalReceipt.ts/escpos.ts:
//   1. buildNotaImageLines() -- MURNI, cuma menyusun "baris" terstruktur
//      dari ReceiptData (testable tanpa canvas/DOM sama sekali).
//   2. renderNotaImageCanvas() -- menggambar baris-baris itu ke
//      <canvas> sungguhan (butuh DOM, diuji lewat Playwright, bukan unit
//      test murni).
// Canvas sendiri (BUKAN html-to-image/html2canvas) -- dipilih supaya logo
// lintas-domain (R2) tidak membuat canvas "tainted" di Safari (logo
// di-fetch dulu jadi data URL via fetchLogoAsDataUrl(), BUKAN langsung
// drawImage dari <img src="https://...">), dan supaya tidak menambah
// bundle size (lihat warning build sudah >500kB).
import type { ReceiptData } from './formatters';
import {
  formatIDR,
  formatDateIndo,
  rentalDays,
  depositLabel,
  fineLabel,
  todayStr,
  addDaysStr,
  groupReceiptItemsByBundle,
  computeRemainingBalance,
  formatRentalDuration,
  formatPickedUpEarlyLine,
  PAYMENT_METHOD_LABEL,
  PAYMENT_KIND_LABEL,
} from './formatters';

export const NOTA_IMAGE_WIDTH = 1080;

export type NotaImageLine =
  | { kind: 'reprint'; text: string }
  | { kind: 'logo-placeholder' }
  | { kind: 'title'; text: string }
  | { kind: 'subtitle'; text: string }
  | { kind: 'caption'; text: string }
  | { kind: 'meta-row'; leftLabel: string; leftValue: string; rightLabel: string; rightValue: string }
  | { kind: 'info-row'; label: string; value: string }
  | { kind: 'divider' }
  | { kind: 'table-header'; cols: [string, string, string] }
  | { kind: 'bundle-header'; text: string }
  | { kind: 'item-row'; name: string; qty: string; subtotal: string; indent: boolean }
  | { kind: 'section-title'; text: string }
  | { kind: 'fine-row'; text: string; amount: string }
  | { kind: 'summary-row'; label: string; value: string; bold: boolean; accent?: 'warning' | 'primary' }
  | { kind: 'payment-row'; text: string; amount: string }
  | { kind: 'deposit-block'; title: string; lines: string[] }
  | { kind: 'footer'; text: string };

export type NotaImageModel = {
  lines: NotaImageLine[];
  hasLogo: boolean;
};

// Rumus/aturan bisnis di sini WAJIB sama dengan InvoiceModal.tsx/
// thermalReceipt.ts (dua tempat lain yang membaca ReceiptData yang
// sama) -- diverifikasi lewat test paritas isi, bukan cuma masing-
// masing terpisah hijau sendiri-sendiri.
export function buildNotaImageLines(data: ReceiptData): NotaImageModel {
  const days = rentalDays(data.startDate, data.endDate, data.rentalDayMode);
  const totalFines = data.fines.reduce((sum, f) => sum + f.amount, 0);
  const remaining = computeRemainingBalance(data.totalPrice, totalFines, data.dpPaid);
  const totalTagihan = data.totalPrice + totalFines;

  const lines: NotaImageLine[] = [];

  if (data.isReprint) {
    lines.push({ kind: 'reprint', text: `SALINAN — dicetak ulang ${formatDateIndo(data.reprintedAt ?? todayStr())}` });
  }

  lines.push({ kind: 'logo-placeholder' });
  lines.push({ kind: 'title', text: data.businessName });
  if (data.businessAddress) lines.push({ kind: 'subtitle', text: data.businessAddress });
  lines.push({ kind: 'caption', text: 'Nota Sewa Alat Outdoor' });

  lines.push({
    kind: 'meta-row',
    leftLabel: 'Kode Booking',
    leftValue: data.bookingNumber,
    rightLabel: 'Tanggal Cetak',
    rightValue: formatDateIndo(todayStr()),
  });

  lines.push({ kind: 'info-row', label: 'Penyewa', value: data.customerName });
  if (data.customerPhone) lines.push({ kind: 'info-row', label: 'WhatsApp', value: data.customerPhone });
  lines.push({ kind: 'info-row', label: 'Mulai Sewa', value: formatDateIndo(data.startDate) });
  const pickedUpLine = formatPickedUpEarlyLine(data.startDate, data.pickedUpAt, data.timezone);
  if (pickedUpLine) lines.push({ kind: 'info-row', label: 'Diambil', value: pickedUpLine.replace('Diambil: ', '') });
  lines.push({
    kind: 'info-row',
    label: 'Tanggal Kembali',
    value: `${formatDateIndo(data.endDate)} (${formatRentalDuration(days, data.durationLabelStyle ?? null, data.rentalDayMode)})`,
  });
  if (data.returnDeadlineTime) {
    const deadlineDate =
      data.returnDeadlineNextDay || data.returnDeadlineTime === '00:00' ? addDaysStr(data.endDate, 1) : data.endDate;
    lines.push({ kind: 'info-row', label: 'Kembali paling lambat', value: `${formatDateIndo(deadlineDate)}, ${data.returnDeadlineTime}` });
  }

  lines.push({ kind: 'divider' });
  lines.push({ kind: 'table-header', cols: ['Alat', 'Qty', 'Subtotal'] });
  for (const group of groupReceiptItemsByBundle(data.items)) {
    if (group.bundleName) {
      lines.push({
        kind: 'bundle-header',
        text: `Paket ${group.bundleName}${group.bundleQuantity && group.bundleQuantity > 1 ? ` ×${group.bundleQuantity}` : ''}`,
      });
      for (const item of group.items) {
        lines.push({
          kind: 'item-row',
          name: item.name,
          qty: `${item.quantity}x`,
          subtotal: formatIDR(item.subtotal ?? item.price_per_day * item.quantity * days),
          indent: true,
        });
      }
    } else {
      for (const item of group.items) {
        lines.push({
          kind: 'item-row',
          name: item.name,
          qty: `${item.quantity}x`,
          subtotal: formatIDR(item.subtotal ?? item.price_per_day * item.quantity * days),
          indent: false,
        });
      }
    }
  }

  if (data.saleItems.length > 0) {
    lines.push({ kind: 'divider' });
    lines.push({ kind: 'table-header', cols: ['Barang Jual', 'Qty', 'Subtotal'] });
    for (const s of data.saleItems) {
      lines.push({ kind: 'item-row', name: s.name, qty: `${s.quantity}x`, subtotal: formatIDR(s.subtotal), indent: false });
    }
  }

  if (data.fines.length > 0) {
    lines.push({ kind: 'divider' });
    lines.push({ kind: 'section-title', text: 'Rincian Denda' });
    for (const f of data.fines) {
      const label = `${fineLabel(f.type)}${f.item_name ? ` (${f.item_name})` : ''}${f.description ? ` — ${f.description}` : ''}`;
      lines.push({ kind: 'fine-row', text: label, amount: formatIDR(f.amount) });
    }
    lines.push({ kind: 'summary-row', label: 'Total Denda', value: formatIDR(totalFines), bold: true });
  }

  lines.push({ kind: 'divider' });
  const rentalBruto = data.items.reduce((sum, i) => sum + (i.subtotal ?? i.price_per_day * i.quantity * days), 0);
  lines.push({ kind: 'summary-row', label: 'Total Harga Sewa', value: formatIDR(rentalBruto), bold: false });
  if (data.discountAmount && data.discountAmount > 0) {
    lines.push({
      kind: 'summary-row',
      label: `Diskon ${data.discountTypeName ?? ''} ${data.discountPercent ?? ''}%`.trim(),
      value: `-${formatIDR(data.discountAmount)}`,
      bold: false,
      accent: 'warning',
    });
  }
  if (data.saleItems.length > 0) {
    lines.push({
      kind: 'summary-row',
      label: 'Total Barang Jual',
      value: formatIDR(data.saleItems.reduce((sum, s) => sum + s.subtotal, 0)),
      bold: false,
    });
  }
  lines.push({ kind: 'summary-row', label: 'Total Tagihan', value: formatIDR(totalTagihan), bold: true });
  lines.push({ kind: 'summary-row', label: 'Total Dibayar', value: formatIDR(data.dpPaid), bold: false });
  if (remaining > 0) {
    lines.push({ kind: 'summary-row', label: 'Sisa Tagihan', value: formatIDR(remaining), bold: true });
  } else if (remaining < 0) {
    lines.push({ kind: 'summary-row', label: 'Lebih Bayar', value: formatIDR(Math.abs(remaining)), bold: true, accent: 'warning' });
  } else {
    lines.push({ kind: 'summary-row', label: 'Status', value: 'LUNAS', bold: true, accent: 'primary' });
  }

  if ((data.payments ?? []).length > 0) {
    lines.push({ kind: 'divider' });
    lines.push({ kind: 'section-title', text: 'Riwayat Pembayaran' });
    for (const p of data.payments ?? []) {
      const text = `${formatDateIndo(p.paidAt.slice(0, 10))} — ${PAYMENT_KIND_LABEL[p.kind] ?? p.kind}${p.method ? ` (${PAYMENT_METHOD_LABEL[p.method] ?? p.method})` : ''}`;
      lines.push({ kind: 'payment-row', text, amount: formatIDR(p.amount) });
    }
  }

  if (data.depositType) {
    const statusText =
      data.depositStatus === 'dikembalikan'
        ? 'Sudah Dikembalikan'
        : data.status === 'dipesan'
          ? 'Akan Diminta Saat Ambil'
          : 'Ditahan di Kasir';
    const depositLines = [`Tipe: ${depositLabel(data.depositType)}`];
    if (data.depositNote) depositLines.push(`Catatan: ${data.depositNote}`);
    depositLines.push(`Status: ${statusText}`);
    lines.push({ kind: 'deposit-block', title: 'Jaminan Sewa', lines: depositLines });
  }

  lines.push({ kind: 'footer', text: `Terima kasih telah menyewa di ${data.businessName}.` });

  return { lines, hasLogo: !!data.businessLogoUrl };
}

// Logo R2 lintas-domain -- di-fetch sebagai blob lalu dikonversi ke data
// URL SEBELUM digambar ke canvas, supaya canvas tidak "tainted" (yang
// akan membuat toBlob()/toDataURL() gagal/kosong di Safari khususnya).
// null kalau fetch gagal apa pun sebabnya (CORS, offline, 404) -- caller
// lanjut tanpa logo, BUKAN gagal total menggambar nota.
export async function fetchLogoAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const COLORS = {
  bg: '#FFFFFF',
  text: '#26302B',
  muted: '#6E6853',
  primary: '#2B4739',
  warning: '#A65C2A',
  border: '#DBD5C1',
  borderDark: '#26302B',
  depositBg: '#F1EEE2',
};

const PAD_X = 48;
const CONTENT_W = NOTA_IMAGE_WIDTH - PAD_X * 2;

// Canvas 2D murni (bukan DOM/React) -- dipilih atas html-to-image/
// html2canvas (lihat komentar atas file). Tinggi dihitung di DUA lintasan:
// render "kering" (dryRun=true, cuma mengakumulasi tinggi tanpa menggambar
// apa pun) untuk menentukan tinggi canvas sungguhan, baru render
// sebenarnya -- canvas HTML tidak bisa "auto-grow" tingginya di tengah
// jalan.
export async function renderNotaImageCanvas(data: ReceiptData, logoDataUrl: string | null): Promise<HTMLCanvasElement> {
  const model = buildNotaImageLines(data);
  const logoImg = logoDataUrl ? await loadImage(logoDataUrl) : null;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d')!;
  const height = Math.ceil(paintLines(measureCtx, model.lines, logoImg, true)) + 48;

  const canvas = document.createElement('canvas');
  canvas.width = NOTA_IMAGE_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  paintLines(ctx, model.lines, logoImg, false);
  return canvas;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Mengembalikan posisi Y akhir (tinggi konten). dryRun=true -- cuma
// menghitung, tidak menggambar apa pun (dipakai lintasan pertama untuk
// menentukan tinggi canvas).
function paintLines(ctx: CanvasRenderingContext2D, lines: NotaImageLine[], logo: HTMLImageElement | null, dryRun: boolean): number {
  let y = 40;
  const centerX = NOTA_IMAGE_WIDTH / 2;

  function text(str: string, x: number, size: number, opts: { bold?: boolean; color?: string; align?: CanvasTextAlign } = {}) {
    if (!dryRun) {
      ctx.font = `${opts.bold ? '700' : '400'} ${size}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = opts.color ?? COLORS.text;
      ctx.textAlign = opts.align ?? 'left';
      ctx.fillText(str, x, y);
    }
  }

  // Bungkus teks panjang (mis. deskripsi denda bebas-ketik) ke beberapa
  // baris supaya tidak bertabrakan dengan nominal di sampingnya --
  // ctx.measureText() tetap presisi walau dryRun (cuma fillText yang
  // dilewati), jadi tinggi yang dihitung lintasan kering sudah akurat.
  function wrapToWidth(str: string, maxWidth: number, size: number, bold: boolean): string[] {
    ctx.font = `${bold ? '700' : '400'} ${size}px system-ui, -apple-system, sans-serif`;
    const words = str.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
    return out.length > 0 ? out : [''];
  }

  for (const line of lines) {
    switch (line.kind) {
      case 'reprint':
        y += 36;
        text(line.text, centerX, 26, { bold: true, color: COLORS.warning, align: 'center' });
        y += 8;
        break;
      case 'logo-placeholder':
        if (logo) {
          if (!dryRun) ctx.drawImage(logo, centerX - 56, y, 112, 112);
          y += 128;
        }
        break;
      case 'title':
        y += 44;
        text(line.text, centerX, 38, { bold: true, align: 'center' });
        break;
      case 'subtitle':
        y += 30;
        text(line.text, centerX, 22, { color: COLORS.muted, align: 'center' });
        break;
      case 'caption':
        y += 28;
        text(line.text, centerX, 22, { color: COLORS.muted, align: 'center' });
        y += 24;
        if (!dryRun) {
          ctx.strokeStyle = COLORS.borderDark;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(PAD_X, y);
          ctx.lineTo(NOTA_IMAGE_WIDTH - PAD_X, y);
          ctx.stroke();
        }
        y += 24;
        break;
      case 'meta-row':
        y += 26;
        text(line.leftLabel, PAD_X, 20, { color: COLORS.muted });
        text(line.rightLabel, NOTA_IMAGE_WIDTH - PAD_X, 20, { color: COLORS.muted, align: 'right' });
        y += 30;
        text(line.leftValue, PAD_X, 24, { bold: true });
        text(line.rightValue, NOTA_IMAGE_WIDTH - PAD_X, 24, { bold: true, align: 'right' });
        y += 20;
        break;
      case 'info-row':
        y += 28;
        text(`${line.label}: `, PAD_X, 22, { color: COLORS.muted });
        if (!dryRun) {
          const labelWidth = ctx.measureText(`${line.label}: `).width;
          text(line.value, PAD_X + labelWidth, 22, { bold: true });
        }
        break;
      case 'divider':
        y += 16;
        if (!dryRun) {
          ctx.strokeStyle = COLORS.border;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PAD_X, y);
          ctx.lineTo(NOTA_IMAGE_WIDTH - PAD_X, y);
          ctx.stroke();
        }
        y += 16;
        break;
      case 'table-header':
        y += 28;
        text(line.cols[0], PAD_X, 20, { color: COLORS.muted });
        text(line.cols[1], centerX, 20, { color: COLORS.muted, align: 'center' });
        text(line.cols[2], NOTA_IMAGE_WIDTH - PAD_X, 20, { color: COLORS.muted, align: 'right' });
        y += 12;
        if (!dryRun) {
          ctx.strokeStyle = COLORS.borderDark;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(PAD_X, y);
          ctx.lineTo(NOTA_IMAGE_WIDTH - PAD_X, y);
          ctx.stroke();
        }
        y += 14;
        break;
      case 'bundle-header':
        y += 30;
        text(line.text, PAD_X, 22, { bold: true });
        break;
      case 'item-row':
        y += 30;
        text(line.indent ? `— ${line.name}` : line.name, PAD_X + (line.indent ? 24 : 0), 22, { color: line.indent ? COLORS.muted : COLORS.text });
        text(line.qty, centerX, 22, { align: 'center' });
        text(line.subtotal, NOTA_IMAGE_WIDTH - PAD_X, 22, { align: 'right' });
        break;
      case 'section-title':
        y += 32;
        text(line.text, PAD_X, 24, { bold: true });
        break;
      case 'fine-row': {
        const wrapped = wrapToWidth(line.text, CONTENT_W, 20, false);
        for (const part of wrapped) {
          y += 26;
          text(part, PAD_X, 20, {});
        }
        y += 24;
        text(line.amount, NOTA_IMAGE_WIDTH - PAD_X, 20, { align: 'right' });
        break;
      }
      case 'summary-row':
        y += line.bold ? 34 : 28;
        text(line.label, PAD_X, line.bold ? 24 : 20, {
          bold: line.bold,
          color: line.accent === 'warning' ? COLORS.warning : line.accent === 'primary' ? COLORS.primary : COLORS.text,
        });
        text(line.value, NOTA_IMAGE_WIDTH - PAD_X, line.bold ? 24 : 20, {
          bold: line.bold,
          color: line.accent === 'warning' ? COLORS.warning : line.accent === 'primary' ? COLORS.primary : COLORS.text,
          align: 'right',
        });
        break;
      case 'payment-row':
        y += 26;
        text(line.text, PAD_X, 18, { color: COLORS.muted });
        text(line.amount, NOTA_IMAGE_WIDTH - PAD_X, 18, { align: 'right' });
        break;
      case 'deposit-block': {
        const blockHeight = 44 + line.lines.length * 26;
        y += 16;
        if (!dryRun) {
          ctx.fillStyle = COLORS.depositBg;
          ctx.fillRect(PAD_X, y, CONTENT_W, blockHeight);
        }
        y += 30;
        text(line.title, PAD_X + 16, 22, { bold: true });
        for (const l of line.lines) {
          y += 26;
          text(l, PAD_X + 16, 20, {});
        }
        y += 18;
        break;
      }
      case 'footer':
        y += 48;
        if (!dryRun) {
          ctx.strokeStyle = COLORS.border;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PAD_X, y - 24);
          ctx.lineTo(NOTA_IMAGE_WIDTH - PAD_X, y - 24);
          ctx.stroke();
        }
        text(line.text, centerX, 18, { color: COLORS.muted, align: 'center' });
        break;
    }
  }
  return y;
}
