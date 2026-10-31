import { useState } from 'react';
import { CreditCard, MessageCircle, Receipt, QrCode, Info } from 'lucide-react';
import type { Subscription, SubscriptionStatus } from '../hooks/useSubscription';
import { useSubscriptionPayments } from '../hooks/useSubscriptionPayments';
import type { SubscriptionPayment } from '../hooks/useSubscriptionPayments';
import { SubscriptionReceiptModal } from './SubscriptionReceiptModal';
import { SUBSCRIPTION_CONFIG } from '../lib/subscriptionConfig';
import { getWhatsAppShareUrl, formatIDR, formatDateIndo } from '../utils/formatters';

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  aktif: 'Aktif',
  tenggang: 'Masa Tenggang',
  'hanya-baca': 'Hanya-baca',
};

const STATUS_CLASS: Record<SubscriptionStatus, string> = {
  aktif: 'bg-[#2B4739]/10 text-[#2B4739] border-[#2B4739]/30',
  tenggang: 'bg-[#A65C2A]/10 text-[#A65C2A] border-[#A65C2A]/30',
  'hanya-baca': 'bg-[#A8412E]/10 text-[#A8412E] border-[#A8412E]/30',
};

const METHOD_LABEL: Record<string, string> = {
  transfer: 'Transfer Bank',
  qris: 'QRIS',
  tunai: 'Tunai',
  lainnya: 'Lainnya',
};

// Halaman "Langganan" owner-only — status, tanggal aktif, info rekening
// pembayaran, tombol konfirmasi via WA, dan riwayat pembayaran (baca-saja,
// satu-satunya jalur tulis adalah RPC admin record_subscription_payment).
// Harga/plan FINAL belum ditentukan (CLAUDE.md: gratis sampai 31 Des 2026,
// harga setelahnya belum diputuskan) — halaman ini TIDAK BOLEH menjanjikan
// angka harga pasti, cuma status & cara konfirmasi pembayaran saat sudah
// diminta admin.
export function LanggananScreen({
  businessId,
  businessName,
  subscription,
  isDemoAccount = false,
}: {
  businessId: string;
  businessName: string;
  subscription: Subscription | null;
  // Akun demo publik (landing page) — review -c1: pengunjung tidak boleh
  // bisa tidak sengaja kirim WA konfirmasi-bayar ke nomor resmi Sewalog
  // dari akun ini. Deteksi dari email auth, lihat utils/demo.ts.
  isDemoAccount?: boolean;
}) {
  const { payments, loading } = useSubscriptionPayments(businessId);
  const [receiptTarget, setReceiptTarget] = useState<SubscriptionPayment | null>(null);

  const waUrl = getWhatsAppShareUrl(
    SUBSCRIPTION_CONFIG.supportWhatsApp,
    `Halo Sewalog, saya mau konfirmasi pembayaran langganan untuk usaha "${businessName}".`,
  );

  const hasBankInfo = SUBSCRIPTION_CONFIG.bankName && SUBSCRIPTION_CONFIG.bankAccountNumber;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {isDemoAccount && (
        <div className="bg-[#E8EFEA] border border-[#2B4739]/30 rounded-xl px-4 py-2.5 text-xs font-semibold text-[#2B4739] flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0" />
          <span>Ini akun demo — tidak perlu berlangganan.</span>
        </div>
      )}

      <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
        <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-[#2B4739]" />
          <span>Langganan</span>
        </h2>

        {subscription ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full border ${STATUS_CLASS[subscription.status]}`}>
                {STATUS_LABEL[subscription.status]}
              </span>
              <span className="text-xs text-[#6E6853]">
                Aktif sampai <span className="font-semibold text-[#26302B]">{formatDateIndo(subscription.activeUntil)}</span>
              </span>
            </div>

            {subscription.status === 'tenggang' && (
              <p className="text-xs font-semibold text-[#A65C2A]">
                Masa aktif sudah habis, masuk masa tenggang. Sisa {7 + subscription.daysUntilActiveUntil} hari sebelum akun ini
                jadi hanya-baca.
              </p>
            )}
            {subscription.status === 'hanya-baca' && (
              <p className="text-xs font-semibold text-[#A8412E]">
                Masa aktif sudah habis — transaksi baru dikunci. Transaksi yang sedang berjalan tetap bisa diselesaikan.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-[#6E6853]">Memuat status langganan...</p>
        )}

        <p className="text-xs text-[#6E6853] leading-relaxed border-t border-[#E6E1D2] pt-3">
          Sewalog gratis sampai 31 Desember 2026. Harga setelahnya belum diputuskan — akan diumumkan sebelum tanggal
          itu. Pembayaran dikonfirmasi manual lewat WhatsApp, bukan otomatis.
        </p>
      </div>

      <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-[#26302B] flex items-center gap-2">
          <QrCode className="w-4 h-4 text-[#2B4739]" />
          <span>Info Pembayaran</span>
        </h3>

        {hasBankInfo ? (
          <div className="text-xs space-y-1">
            <p>
              <span className="text-[#6E6853]">Bank:</span> <span className="font-semibold">{SUBSCRIPTION_CONFIG.bankName}</span>
            </p>
            <p>
              <span className="text-[#6E6853]">No. Rekening:</span>{' '}
              <span className="font-semibold">{SUBSCRIPTION_CONFIG.bankAccountNumber}</span>
            </p>
            <p>
              <span className="text-[#6E6853]">Atas Nama:</span>{' '}
              <span className="font-semibold">{SUBSCRIPTION_CONFIG.bankAccountHolder}</span>
            </p>
          </div>
        ) : (
          <p className="text-xs text-[#6E6853]">
            Info rekening pembayaran segera diumumkan — hubungi Sewalog lewat WA untuk info terbaru atau kalau sudah
            siap membayar.
          </p>
        )}

        {SUBSCRIPTION_CONFIG.qrisImageUrl && (
          <img src={SUBSCRIPTION_CONFIG.qrisImageUrl} alt="QRIS pembayaran Sewalog" className="w-40 h-40 object-contain mx-auto" />
        )}

        {!isDemoAccount && (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-sm transition active:scale-95"
          >
            <MessageCircle className="w-4 h-4" />
            Konfirmasi Bayar via WA
          </a>
        )}
      </div>

      <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-2">
        <h3 className="text-sm font-bold text-[#26302B] flex items-center gap-2">
          <Receipt className="w-4 h-4 text-[#2B4739]" />
          <span>Riwayat Pembayaran</span>
        </h3>

        {loading && <p className="text-xs text-[#6E6853]">Memuat...</p>}
        {!loading && payments.length === 0 && <p className="text-xs text-[#6E6853]">Belum ada pembayaran tercatat.</p>}

        {payments.map((p) => (
          <button
            key={p.id}
            onClick={() => setReceiptTarget(p)}
            className="w-full flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-xs hover:bg-[#E6E1D2] transition text-left"
          >
            <div className="min-w-0">
              <p className="font-semibold text-[#26302B]">{formatDateIndo(p.created_at.slice(0, 10))}</p>
              <p className="text-[#6E6853]">
                {METHOD_LABEL[p.method] ?? p.method} · {p.period_days} hari
              </p>
            </div>
            <span className="font-bold text-[#2B4739] shrink-0">{formatIDR(p.amount)}</span>
          </button>
        ))}
      </div>

      {receiptTarget && (
        <SubscriptionReceiptModal payment={receiptTarget} businessName={businessName} onClose={() => setReceiptTarget(null)} />
      )}
    </div>
  );
}
