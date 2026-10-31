import { Printer, X } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { SubscriptionPayment } from '../hooks/useSubscriptionPayments';
import { SUBSCRIPTION_CONFIG } from '../lib/subscriptionConfig';
import { formatIDR, formatDateIndo } from '../utils/formatters';

const METHOD_LABEL: Record<string, string> = {
  transfer: 'Transfer Bank',
  qris: 'QRIS',
  tunai: 'Tunai',
  lainnya: 'Lainnya',
};

// Kuitansi cetak/PDF pembayaran langganan — pola sama seperti InvoiceModal
// (window.print() + #print-invoice-root, lihat index.css), tapi ini
// ditagih sebagai PT MARKABAM NOTODESUN DIGITAL (merchant langganan
// Sewalog sendiri, bukan vendor/pelanggan mereka — lihat
// subscriptionConfig.ts & docs/legalitas-pembayaran.md). SENGAJA tidak
// ada klaim pajak/PPN apa pun di sini — belum ada dasar legalnya.
export function SubscriptionReceiptModal({
  payment,
  businessName,
  onClose,
}: {
  payment: SubscriptionPayment;
  businessName: string;
  onClose: () => void;
}) {
  const receiptNumber = payment.id.slice(0, 8).toUpperCase();

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-white w-full max-w-sm rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col print:max-h-none print:shadow-none print:border-0 print:rounded-none">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0 print:hidden">
          <h2 className="text-lg font-bold">Kuitansi Pembayaran</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div id="print-invoice-root" className="p-6 overflow-y-auto text-sm text-[#26302B]">
          <div className="text-center pb-4 border-b-2 border-[#26302B] mb-4">
            <h1 className="text-base font-extrabold uppercase">{SUBSCRIPTION_CONFIG.bankAccountHolder}</h1>
            <p className="text-xs text-[#6E6853] mt-1">Kuitansi Pembayaran Langganan Sewalog</p>
          </div>

          <div className="flex justify-between text-xs mb-4">
            <div>
              <p className="text-[#6E6853]">No. Kuitansi</p>
              <p className="font-bold">{receiptNumber}</p>
            </div>
            <div className="text-right">
              <p className="text-[#6E6853]">Tanggal</p>
              <p className="font-bold">{formatDateIndo(payment.created_at.slice(0, 10))}</p>
            </div>
          </div>

          <div className="space-y-2 text-xs border-t border-b border-[#E6E1D2] py-3 mb-4">
            <div className="flex justify-between">
              <span className="text-[#6E6853]">Usaha</span>
              <span className="font-semibold">{businessName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6E6853]">Masa aktif</span>
              <span className="font-semibold">{payment.period_days} hari</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6E6853]">Metode</span>
              <span className="font-semibold">{METHOD_LABEL[payment.method] ?? payment.method}</span>
            </div>
            {payment.note && (
              <div className="flex justify-between gap-2">
                <span className="text-[#6E6853] shrink-0">Catatan</span>
                <span className="font-semibold text-right">{payment.note}</span>
              </div>
            )}
          </div>

          <div className="flex justify-between items-baseline">
            <span className="text-sm font-bold">Total Dibayar</span>
            <span className="text-lg font-extrabold">{formatIDR(payment.amount)}</span>
          </div>

          <button
            onClick={() => window.print()}
            className="w-full mt-6 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm transition print:hidden"
          >
            <Printer className="w-4 h-4" />
            Cetak / Simpan PDF
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
