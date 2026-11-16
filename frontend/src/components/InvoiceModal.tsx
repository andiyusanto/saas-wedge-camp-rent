import { Fragment, useState } from 'react';
import { Printer, Settings2, X } from 'lucide-react';
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
  PAYMENT_METHOD_LABEL,
  PAYMENT_KIND_LABEL,
} from '../utils/formatters';
import { usePrinterSettings } from '../hooks/usePrinterSettings';
import { buildThermalReceiptDoc } from '../utils/thermalReceipt';
import { printThermalReceipt } from '../utils/thermalPrint';
import { PrinterSetupWizard } from './PrinterSetupWizard';

// Nota cetak/PDF — dirender dari data yang sama dengan struk WA (lihat
// buildReceiptData di useTrackings.ts), tanpa library PDF atau endpoint
// baru: tombol "Cetak / Simpan PDF" cuma memanggil window.print(), dan
// dialog print browser (destinasi "Simpan sebagai PDF") yang menghasilkan
// filenya. #print-invoice-root + CSS @media print di index.css yang
// menyembunyikan seluruh halaman lain (nav, modal chrome) saat dicetak.
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

  if (!isOpen || !data) return null;

  const days = rentalDays(data.startDate, data.endDate, data.rentalDayMode);
  const totalFines = data.fines.reduce((sum, f) => sum + f.amount, 0);
  // Pelunasan (brief 17 Nov 2026) -- sisa tagihan termasuk denda, lihat
  // computeRemainingBalance(); SENGAJA tidak di-clamp ke 0 supaya
  // "Lebih Bayar" (mis. setelah Ubah Alat mengurangi total) ketahuan.
  const remaining = computeRemainingBalance(data.totalPrice, totalFines, data.dpPaid);

  async function handlePrintThermal() {
    if (!data) return;
    if (!settings || settings.connection === 'none') {
      setWizardOpen(true);
      return;
    }
    const doc = buildThermalReceiptDoc(data, settings.paperWidth);
    await printThermalReceipt(doc, settings.paperWidth, settings.connection === 'bluetooth' ? 'bluetooth' : 'usb');
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-white w-full max-w-lg rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col print:max-h-none print:shadow-none print:border-0 print:rounded-none">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0 print:hidden">
          <h2 className="text-lg font-bold">Nota Sewa</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div id="print-invoice-root" className="p-6 overflow-y-auto text-sm text-[#26302B]">
          {data.isReprint && (
            <p className="text-center text-xs font-bold text-[#A65C2A] mb-2 uppercase tracking-wide">
              SALINAN — dicetak ulang {formatDateIndo(data.reprintedAt ?? todayStr())}
            </p>
          )}
          <div className="text-center pb-4 border-b-2 border-[#26302B] mb-4">
            {data.businessLogoUrl && (
              <img
                src={data.businessLogoUrl}
                alt=""
                className="h-14 w-14 object-contain mx-auto mb-2"
              />
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
              <span className="text-[#6E6853]">Tanggal Ambil: </span>
              {formatDateIndo(data.startDate)}
            </p>
            <p>
              <span className="text-[#6E6853]">Tanggal Kembali: </span>
              {formatDateIndo(data.endDate)} ({days} hari)
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

          <div className="text-xs space-y-1 mb-4">
            {data.saleItems.length > 0 ? (
              <>
                <div className="flex justify-between">
                  <span>Total Harga Sewa</span>
                  <span>{formatIDR(data.items.reduce((sum, i) => sum + (i.subtotal ?? i.price_per_day * i.quantity * days), 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Barang Jual</span>
                  <span>{formatIDR(data.saleItems.reduce((sum, s) => sum + s.subtotal, 0))}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Total Tagihan</span>
                  <strong>{formatIDR(data.totalPrice)}</strong>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span>Total Harga Sewa</span>
                <strong>{formatIDR(data.totalPrice)}</strong>
              </div>
            )}
            <div className="flex justify-between">
              <span>DP Terbayar</span>
              <span>{formatIDR(data.dpPaid)}</span>
            </div>
            <div className="flex justify-between font-bold text-sm border-t border-[#26302B] pt-1">
              {remaining > 0 ? (
                <>
                  <span>Sisa Pembayaran</span>
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

          <p className="text-center text-[10px] text-[#6E6853] mt-6 pt-3 border-t border-[#DBD5C1]">
            Terima kasih telah menyewa di {data.businessName}.
          </p>
        </div>

        <div className="p-4 border-t border-[#DBD5C1] shrink-0 print:hidden space-y-2">
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
