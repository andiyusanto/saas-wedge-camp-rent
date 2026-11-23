import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Settings2, Share2, X } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { ReceiptData } from '../utils/formatters';
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
} from '../utils/formatters';
import { usePrinterSettings } from '../hooks/usePrinterSettings';
import { buildThermalReceiptDoc } from '../utils/thermalReceipt';
import { printThermalReceipt, isIosStandalone } from '../utils/thermalPrint';
import { renderNotaImageCanvas, fetchLogoAsDataUrl } from '../utils/notaImage';
import { PrinterSetupWizard } from './PrinterSetupWizard';

// Nota cetak/PDF — dirender dari data yang sama dengan struk WA (lihat
// buildReceiptData di useTrackings.ts), tanpa library PDF atau endpoint
// baru: tombol "Cetak / Simpan PDF" cuma memanggil window.print(), dan
// dialog print browser (destinasi "Simpan sebagai PDF") yang menghasilkan
// filenya.
//
// Bug PDF berhalaman-ganda (temuan investigasi 24 Nov 2026, dikonfirmasi
// lewat print-to-PDF Chromium sungguhan -- BUKAN cuma iOS, kejadian juga
// di desktop): CSS lama (`body * { visibility: hidden }`) tidak membuang
// TINGGI layout elemen lain (navbar, daftar transaksi, dst -- tetap
// beberapa ribu px), sementara #print-invoice-root diposisikan absolute
// -- browser print engine menggambar ulang elemen itu di SETIAP halaman
// yang "muat" dalam tinggi dokumen yang (secara layout) masih sangat
// panjang, menghasilkan PDF berhalaman-ganda dengan nota yang sama
// diulang. Diperbaiki dengan React Portal: konten cetak di-render DUA
// KALI -- sekali untuk pratinjau di layar (di dalam modal seperti biasa,
// id "nota-preview"), sekali lagi lewat createPortal() LANGSUNG ke
// document.body (id "print-invoice-root", disembunyikan di layar lewat
// `hidden print:block`, cuma aktif saat dicetak). CSS @media print
// (index.css) sekarang membuang (display:none, BUKAN visibility:hidden)
// SELURUH anak langsung <body> SELAIN #print-invoice-root -- termasuk
// seluruh #root (app utuh, apa pun tingginya) -- jadi dokumen yang
// dicetak PERSIS setinggi nota itu sendiri, tidak ada lagi halaman
// duplikat. Pola sama berlaku untuk #print-thermal-root (thermalPrint.ts,
// sudah lama di-append langsung ke body, lihat komentar di sana).
export function InvoiceModal({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: ReceiptData | null;
}) {
  const { settings, saveSettings } = usePrinterSettings();
  const [wizardOpen, setWizardOpen] = useState(false);
  // Bagikan Nota (brief 24 Nov 2026, bagian B) -- gambar DI-RENDER LEBIH
  // DULU (saat modal terbuka/data berubah), BUKAN ditunda sampai tombol
  // ditekan -- syarat iOS: navigator.share() HARUS dipanggil sedekat
  // mungkin dengan gesture klik pengguna, kalau menunggu proses async
  // yang panjang (fetch logo + gambar canvas) baru dimulai SETELAH klik,
  // Safari bisa menolak panggilan share() dianggap bukan lagi hasil
  // gesture langsung.
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (!data) {
      setShareBlob(null);
      return;
    }
    let cancelled = false;
    setShareBlob(null);
    (async () => {
      const logoDataUrl = data.businessLogoUrl ? await fetchLogoAsDataUrl(data.businessLogoUrl) : null;
      if (cancelled) return;
      const canvas = await renderNotaImageCanvas(data, logoDataUrl);
      canvas.toBlob((blob) => {
        if (!cancelled) setShareBlob(blob);
      }, 'image/png');
    })();
    return () => {
      cancelled = true;
    };
    // data.bookingNumber + isReprint sebagai proxy identitas nota --
    // `data` sendiri objek baru tiap render orang tua, memasukkannya utuh
    // ke dependency akan render ulang gambar terus-menerus tanpa guna.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.bookingNumber, data?.isReprint, data?.businessLogoUrl]);

  if (!isOpen || !data) return null;

  async function handleShareNota() {
    if (!shareBlob || !data) return;
    const file = new File([shareBlob], `Nota-${data.bookingNumber}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Nota ${data.bookingNumber}` });
      } catch {
        // Dibatalkan pengguna / gagal -- diamkan, TIDAK lanjut ke fallback
        // unduh otomatis (bisa terasa seperti aksi ganda yang tidak diminta).
      }
      return;
    }
    const url = URL.createObjectURL(shareBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Nota-${data.bookingNumber}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const days = rentalDays(data.startDate, data.endDate, data.rentalDayMode);
  const totalFines = data.fines.reduce((sum, f) => sum + f.amount, 0);
  // Pelunasan (brief 17 Nov 2026) -- sisa tagihan termasuk denda, lihat
  // computeRemainingBalance(); SENGAJA tidak di-clamp ke 0 supaya
  // "Lebih Bayar" (mis. setelah Ubah Alat mengurangi total) ketahuan.
  const remaining = computeRemainingBalance(data.totalPrice, totalFines, data.dpPaid);
  // Perbaikan bug tampilan (koordinator 17 Nov 2026, ditemukan dari Nota
  // reprint Pelunasan): "Total Tagihan" SEKARANG SELALU termasuk denda
  // (data.totalPrice tetap sewa+barang jual yang dipercaya apa adanya).
  const totalTagihan = data.totalPrice + totalFines;

  async function handlePrintThermal() {
    if (!data) return;
    if (!settings || settings.connection === 'none') {
      setWizardOpen(true);
      return;
    }
    const doc = buildThermalReceiptDoc(data, settings.paperWidth);
    await printThermalReceipt(doc, settings.paperWidth, settings.connection === 'bluetooth' ? 'bluetooth' : 'usb');
  }

  // Dirender SEKALI sebagai elemen, dipakai DUA kali (pratinjau layar +
  // portal cetak) -- lihat komentar panjang di atas soal bug halaman
  // ganda. Elemen React boleh dipakai di lebih dari satu posisi output
  // selama bukan di dalam array/list yang butuh identitas `key` unik.
  const notaBody = (
    <>
      {data.isReprint && (
        <p className="text-center text-xs font-bold text-[#A65C2A] mb-2 uppercase tracking-wide">
          SALINAN — dicetak ulang {formatDateIndo(data.reprintedAt ?? todayStr())}
        </p>
      )}
      <div className="text-center pb-4 border-b-2 border-[#26302B] mb-4">
        {data.businessLogoUrl && (
          <img src={data.businessLogoUrl} alt="" className="h-14 w-14 object-contain mx-auto mb-2" />
        )}
        <h1 className="text-lg font-extrabold uppercase">{data.businessName}</h1>
        {data.businessAddress && <p className="text-xs text-[#6E6853] mt-0.5">{data.businessAddress}</p>}
        <p className="text-xs text-[#6E6853] mt-1">Nota Sewa Alat Outdoor</p>
      </div>

      <div className="flex justify-between text-xs mb-4">
        <div>
          <p className="text-[#6E6853]">Kode Booking</p>
          <p className="font-bold">{data.bookingNumber}</p>
        </div>
        <div className="text-right">
          <p className="text-[#6E6853]">Tanggal Cetak</p>
          <p className="font-bold">{formatDateIndo(todayStr())}</p>
        </div>
      </div>

      <div className="mb-4 text-xs space-y-0.5">
        <p>
          <span className="text-[#6E6853]">Penyewa: </span>
          <strong>{data.customerName}</strong>
        </p>
        {data.customerPhone && (
          <p>
            <span className="text-[#6E6853]">WhatsApp: </span>
            {data.customerPhone}
          </p>
        )}
        <p>
          <span className="text-[#6E6853]">Mulai Sewa: </span>
          {formatDateIndo(data.startDate)}
        </p>
        {formatPickedUpEarlyLine(data.startDate, data.pickedUpAt, data.timezone) && (
          <p>
            <span className="text-[#6E6853]">Diambil: </span>
            {formatPickedUpEarlyLine(data.startDate, data.pickedUpAt, data.timezone)!.replace('Diambil: ', '')}
          </p>
        )}
        <p>
          <span className="text-[#6E6853]">Tanggal Kembali: </span>
          {formatDateIndo(data.endDate)} ({formatRentalDuration(days, data.durationLabelStyle ?? null, data.rentalDayMode)})
        </p>
        {data.returnDeadlineTime && (
          <p>
            <span className="text-[#6E6853]">Kembali paling lambat: </span>
            {formatDateIndo(
              data.returnDeadlineNextDay || data.returnDeadlineTime === '00:00' ? addDaysStr(data.endDate, 1) : data.endDate,
            )}
            , {data.returnDeadlineTime}
          </p>
        )}
      </div>

      <table className="w-full text-xs mb-4 border-collapse">
        <thead>
          <tr className="border-b border-[#26302B]">
            <th className="text-left py-1.5">Alat</th>
            <th className="text-center py-1.5">Qty</th>
            <th className="text-right py-1.5">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {groupReceiptItemsByBundle(data.items).map((group, gi) =>
            group.bundleName ? (
              <Fragment key={gi}>
                <tr className="border-b border-[#DBD5C1]">
                  <td className="py-1.5 font-bold" colSpan={3}>
                    Paket {group.bundleName}
                    {group.bundleQuantity && group.bundleQuantity > 1 ? ` ×${group.bundleQuantity}` : ''}
                  </td>
                </tr>
                {group.items.map((item, i) => (
                  <tr key={i} className="border-b border-[#DBD5C1]">
                    <td className="py-1.5 pl-3 text-[#6E6853]">— {item.name}</td>
                    <td className="py-1.5 text-center">{item.quantity}x</td>
                    <td className="py-1.5 text-right">
                      {formatIDR(item.subtotal ?? item.price_per_day * item.quantity * days)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ) : (
              <Fragment key={gi}>
                {group.items.map((item, i) => (
                  <tr key={i} className="border-b border-[#DBD5C1]">
                    <td className="py-1.5">{item.name}</td>
                    <td className="py-1.5 text-center">{item.quantity}x</td>
                    <td className="py-1.5 text-right">
                      {formatIDR(item.subtotal ?? item.price_per_day * item.quantity * days)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ),
          )}
        </tbody>
      </table>

      {/* Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- tabel
          kedua, terpisah dari alat sewa. Rental tanpa barang jual
          (data.saleItems kosong) tidak menampilkan tabel ini sama
          sekali -- regresi aman. */}
      {data.saleItems.length > 0 && (
        <table className="w-full text-xs mb-4 border-collapse">
          <thead>
            <tr className="border-b border-[#26302B]">
              <th className="text-left py-1.5">Barang Jual</th>
              <th className="text-center py-1.5">Qty</th>
              <th className="text-right py-1.5">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {data.saleItems.map((s, i) => (
              <tr key={i} className="border-b border-[#DBD5C1]">
                <td className="py-1.5">{s.name}</td>
                <td className="py-1.5 text-center">{s.quantity}x</td>
                <td className="py-1.5 text-right">{formatIDR(s.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Rincian Denda (koordinator 17 Nov 2026: dipindah ke SEBELUM
          Total Tagihan, sebelumnya muncul di bawah Jaminan Sewa --
          isi/itemisasinya TIDAK berubah, cuma posisinya, supaya
          "Total Tagihan" di bawah sudah mencerminkan semua denda). */}
      {data.fines.length > 0 && (
        <div className="text-xs mb-4">
          <p className="font-bold mb-1">Rincian Denda</p>
          {data.fines.map((f, i) => (
            <div key={i} className="flex justify-between">
              <span>
                {fineLabel(f.type)}
                {f.item_name ? ` (${f.item_name})` : ''}
                {f.description ? ` — ${f.description}` : ''}
              </span>
              <span>{formatIDR(f.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between font-bold border-t border-[#DBD5C1] pt-1 mt-1">
            <span>Total Denda</span>
            <span>{formatIDR(totalFines)}</span>
          </div>
        </div>
      )}

      <div className="text-xs space-y-1 mb-4">
        <div className="flex justify-between">
          <span>Total Harga Sewa</span>
          <span>{formatIDR(data.items.reduce((sum, i) => sum + (i.subtotal ?? i.price_per_day * i.quantity * days), 0))}</span>
        </div>
        {!!data.discountAmount && data.discountAmount > 0 && (
          <div className="flex justify-between text-[#A65C2A]">
            <span>Diskon {data.discountTypeName} {data.discountPercent}%</span>
            <span>-{formatIDR(data.discountAmount)}</span>
          </div>
        )}
        {data.saleItems.length > 0 && (
          <div className="flex justify-between">
            <span>Total Barang Jual</span>
            <span>{formatIDR(data.saleItems.reduce((sum, s) => sum + s.subtotal, 0))}</span>
          </div>
        )}
        <div className="flex justify-between font-bold">
          <span>Total Tagihan</span>
          <strong>{formatIDR(totalTagihan)}</strong>
        </div>
        {/* Perbaikan bug tampilan (koordinator 17 Nov 2026): "DP
            Terbayar" diganti "Total Dibayar" -- baris ini SELALU
            total SEMUA pembayaran (dp_paid), bukan cuma DP awal. */}
        <div className="flex justify-between">
          <span>Total Dibayar</span>
          <span>{formatIDR(data.dpPaid)}</span>
        </div>
        <div className="flex justify-between font-bold text-sm border-t border-[#26302B] pt-1">
          {remaining > 0 ? (
            <>
              <span>Sisa Tagihan</span>
              <span>{formatIDR(remaining)}</span>
            </>
          ) : remaining < 0 ? (
            <>
              <span className="text-[#A65C2A]">Lebih Bayar</span>
              <span className="text-[#A65C2A]">{formatIDR(Math.abs(remaining))}</span>
            </>
          ) : (
            <>
              <span className="text-[#2B4739]">Status</span>
              <span className="text-[#2B4739]">LUNAS</span>
            </>
          )}
        </div>
      </div>

      {/* Pelunasan: riwayat pembayaran (brief 17 Nov 2026) -- daftar
          apa adanya dari booking_payments, termasuk DP awal/koreksi.
          Rental tanpa riwayat payments (field opsional, dari
          TrackingScreen yang belum diisi) tidak menampilkan blok ini
          sama sekali -- regresi aman. */}
      {(data.payments ?? []).length > 0 && (
        <div className="text-xs mb-4">
          <p className="font-bold mb-1">Riwayat Pembayaran</p>
          {(data.payments ?? []).map((p, i) => (
            <div key={i} className="flex justify-between">
              <span>
                {formatDateIndo(p.paidAt.slice(0, 10))} — {PAYMENT_KIND_LABEL[p.kind] ?? p.kind}
                {p.method ? ` (${PAYMENT_METHOD_LABEL[p.method] ?? p.method})` : ''}
              </span>
              <span>{formatIDR(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {data.depositType && (
        <div className="text-xs mb-4 p-2.5 bg-[#F1EEE2] rounded-lg">
          <p className="font-bold mb-1">Jaminan Sewa</p>
          <p>Tipe: {depositLabel(data.depositType)}</p>
          {data.depositNote && <p>Catatan: {data.depositNote}</p>}
          <p>
            Status:{' '}
            {data.depositStatus === 'dikembalikan'
              ? 'Sudah Dikembalikan'
              : data.status === 'dipesan'
                ? 'Akan Diminta Saat Ambil'
                : 'Ditahan di Kasir'}
          </p>
        </div>
      )}

      <p className="text-center text-[10px] text-[#6E6853] mt-6 pt-3 border-t border-[#DBD5C1]">
        Terima kasih telah menyewa di {data.businessName}.
      </p>
    </>
  );

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-white w-full max-w-lg rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col print:max-h-none print:shadow-none print:border-0 print:rounded-none">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0 print:hidden">
          <h2 className="text-lg font-bold">Nota Sewa</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div id="nota-preview" className="p-6 overflow-y-auto text-sm text-[#26302B]">
          {notaBody}
        </div>

        {createPortal(
          <div id="print-invoice-root" className="hidden print:block p-6 text-sm text-[#26302B]">
            {notaBody}
          </div>,
          document.body,
        )}

        <div className="p-4 border-t border-[#DBD5C1] shrink-0 print:hidden space-y-2">
          {/* Temuan investigasi "Nota/PDF di iPhone" (24 Nov 2026) --
              window.print() dikenal luas TIDAK memunculkan dialog apa pun
              di PWA standalone iOS (app "Pasang Aplikasi" dari layar
              utama, WKWebView tanpa chrome Safari). Bukan disembunyikan
              diam-diam (Nota/PDF & Cetak Struk TETAP ada, tidak diubah
              sama sekali) -- cuma diberi info + Bagikan Nota dijadikan
              tombol UTAMA (di atas, gaya solid) khusus kondisi ini. */}
          {isIosStandalone() && (
            <p className="text-[11px] text-[#A65C2A] font-semibold text-center">
              Di iPhone, gunakan Bagikan Nota untuk kirim ke pelanggan.
            </p>
          )}
          <button
            onClick={handleShareNota}
            disabled={!shareBlob}
            className={
              isIosStandalone()
                ? 'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-md transition disabled:opacity-50'
                : 'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#A65C2A] text-[#A65C2A] font-bold text-sm transition disabled:opacity-50'
            }
          >
            <Share2 className="w-4 h-4" />
            Bagikan Nota
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#2B4739] text-[#2B4739] font-bold text-sm transition"
            >
              <Printer className="w-4 h-4" />
              Nota / PDF
            </button>
            <button
              onClick={handlePrintThermal}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-md transition"
            >
              <Printer className="w-4 h-4" />
              Cetak Struk
            </button>
          </div>
          <button
            onClick={() => setWizardOpen(true)}
            className="w-full text-center text-xs text-[#6E6853] flex items-center justify-center gap-1"
          >
            <Settings2 className="w-3 h-3" />
            Printer: {settings
              ? settings.connection === 'none'
                ? 'Belum ada printer'
                : `${settings.connection === 'bluetooth' ? 'Bluetooth' : 'USB'} · ${settings.paperWidth}mm`
              : 'Belum diatur'} · Ubah
          </button>
        </div>
      </ModalPanel>

      <PrinterSetupWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        businessName={data.businessName}
        onSaved={(next) => {
          saveSettings(next);
          if (next.connection !== 'none') {
            const doc = buildThermalReceiptDoc(data, next.paperWidth);
            printThermalReceipt(doc, next.paperWidth, next.connection === 'bluetooth' ? 'bluetooth' : 'usb');
          }
        }}
      />
    </ModalBackdrop>
  );
}
