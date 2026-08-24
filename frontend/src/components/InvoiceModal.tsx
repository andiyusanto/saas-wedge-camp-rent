import { Printer, X } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { ReceiptData } from '../utils/formatters';
import { formatIDR, formatDateIndo, rentalDays, depositLabel, fineLabel, todayStr } from '../utils/formatters';

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
  if (!isOpen || !data) return null;

  const days = rentalDays(data.startDate, data.endDate);
  const remaining = Math.max(0, data.totalPrice - data.dpPaid);
  const totalFines = data.fines.reduce((sum, f) => sum + f.amount, 0);

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
          <div className="text-center pb-4 border-b-2 border-[#26302B] mb-4">
            <h1 className="text-lg font-extrabold uppercase">{data.businessName}</h1>
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
              {data.items.map((item, i) => (
                <tr key={i} className="border-b border-[#DBD5C1]">
                  <td className="py-1.5">{item.name}</td>
                  <td className="py-1.5 text-center">{item.quantity}x</td>
                  <td className="py-1.5 text-right">{formatIDR(item.price_per_day * item.quantity * days)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="text-xs space-y-1 mb-4">
            <div className="flex justify-between">
              <span>Total Harga Sewa</span>
              <strong>{formatIDR(data.totalPrice)}</strong>
            </div>
            <div className="flex justify-between">
              <span>DP Terbayar</span>
              <span>{formatIDR(data.dpPaid)}</span>
            </div>
            <div className="flex justify-between font-bold text-sm border-t border-[#26302B] pt-1">
              <span>Sisa Pembayaran</span>
              <span>{formatIDR(remaining)}</span>
            </div>
          </div>

          {data.depositType && (
            <div className="text-xs mb-4 p-2.5 bg-[#F1EEE2] rounded-lg">
              <p className="font-bold mb-1">Jaminan Sewa</p>
              <p>Tipe: {depositLabel(data.depositType)}</p>
              {data.depositNote && <p>Catatan: {data.depositNote}</p>}
              <p>Status: {data.depositStatus === 'dikembalikan' ? 'Sudah Dikembalikan' : 'Ditahan di Kasir'}</p>
            </div>
          )}

          {data.fines.length > 0 && (
            <div className="text-xs mb-4">
              <p className="font-bold mb-1">Rincian Denda</p>
              {data.fines.map((f, i) => (
                <div key={i} className="flex justify-between">
                  <span>
                    {fineLabel(f.type)}
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

        <div className="p-4 border-t border-[#DBD5C1] shrink-0 print:hidden">
          <button
            onClick={() => window.print()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-md transition"
          >
            <Printer className="w-4 h-4" />
            Cetak / Simpan PDF
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
