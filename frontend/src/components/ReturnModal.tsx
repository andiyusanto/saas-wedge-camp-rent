import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { X, RotateCcw, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { TrackingBooking } from '../hooks/useTrackings';
import {
  formatDateIndo,
  depositLabel,
  generateWhatsAppReceipt,
  getWhatsAppShareUrl,
} from '../utils/formatters';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export function ReturnModal({
  isOpen,
  onClose,
  booking,
  businessName,
  session,
  onDone,
}: {
  isOpen: boolean;
  onClose: () => void;
  booking: TrackingBooking | null;
  businessName: string;
  session: Session;
  onDone: () => void;
}) {
  const [lateFee, setLateFee] = useState('0');
  const [damageAmount, setDamageAmount] = useState('');
  const [damageDesc, setDamageDesc] = useState('');
  const [lossAmount, setLossAmount] = useState('');
  const [lossDesc, setLossDesc] = useState('');
  const [returnDeposit, setReturnDeposit] = useState(true);
  const [autoOpenWA, setAutoOpenWA] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  if (!isOpen || !booking) return null;

  if (initialisedFor !== booking.id) {
    setLateFee(String(Math.round(booking.suggested_late_fee)));
    setDamageAmount('');
    setDamageDesc('');
    setLossAmount('');
    setLossDesc('');
    setReturnDeposit(booking.deposits.some((d) => d.status === 'ditahan'));
    setError(null);
    setInitialisedFor(booking.id);
  }

  const hasDeposit = booking.deposits.some((d) => d.status === 'ditahan');
  const activeDeposit = booking.deposits.find((d) => d.status === 'ditahan');

  async function handleConfirm() {
    if (!booking) return;
    setSubmitting(true);
    setError(null);

    const extraPenalties = [];
    if (Number(damageAmount) > 0) {
      extraPenalties.push({ type: 'kerusakan', amount: Number(damageAmount), description: damageDesc || null });
    }
    if (Number(lossAmount) > 0) {
      extraPenalties.push({ type: 'kehilangan', amount: Number(lossAmount), description: lossDesc || null });
    }

    const res = await fetch(`${API_BASE_URL}/api/bookings/${booking.id}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        late_fee_amount: Number(lateFee) || 0,
        extra_penalties: extraPenalties,
        return_deposits: hasDeposit && returnDeposit,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? `Gagal (HTTP ${res.status})`);
      return;
    }

    if (autoOpenWA && booking.customer?.phone) {
      const allFines = [
        ...booking.penalties,
        ...(Number(lateFee) > 0 ? [{ type: 'keterlambatan', amount: Number(lateFee), description: null }] : []),
        ...extraPenalties,
      ];
      const receiptText = generateWhatsAppReceipt({
        bookingNumber: booking.booking_number ?? '-',
        customerName: booking.customer.name,
        customerPhone: booking.customer.phone,
        startDate: booking.start_date,
        endDate: booking.end_date,
        items: booking.items.map((i) => ({ name: i.name, quantity: i.quantity, price_per_day: 0 })),
        totalPrice: booking.total_price,
        dpPaid: booking.dp_paid,
        depositType: activeDeposit?.type ?? null,
        depositNote: activeDeposit?.note ?? null,
        depositStatus: hasDeposit && returnDeposit ? 'dikembalikan' : (activeDeposit?.status as 'ditahan' | null),
        status: body.status,
        fines: allFines,
        businessName,
      });
      window.open(getWhatsAppShareUrl(booking.customer.phone, receiptText), '_blank');
    }

    onDone();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-2xl rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <RotateCcw className="w-5 h-5 text-[#B5652E]" />
            <h2 className="text-lg font-bold">Proses Pengembalian Peralatan</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs sm:text-sm">
          <div className="bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1] space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-mono text-xs font-bold text-[#2B4739] bg-[#E8EFEA] px-2 py-0.5 rounded border border-[#2B4739]/20">
                {booking.booking_number ?? '-'}
              </span>
              <span className="font-bold text-[#26302B]">
                {booking.customer?.name} ({booking.customer?.phone})
              </span>
            </div>
            <p className="text-[#8A8368]">
              Jadwal Sewa: {formatDateIndo(booking.start_date)} s/d {formatDateIndo(booking.end_date)}
            </p>
          </div>

          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B]">1. Denda Keterlambatan</h3>
            {booking.is_overdue ? (
              <div className="p-3 rounded-lg bg-[#FAF0EE] border border-[#A8412E]/40 text-[#A8412E]">
                <p className="font-extrabold flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> TERLAMBAT {booking.hours_late} JAM
                </p>
                <p className="text-[11px] text-[#26302B] mt-1">Saran denda otomatis (bisa diubah):</p>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-[#E8EFEA] border border-[#2B4739]/30 text-[#2B4739] font-bold">
                ✓ Belum melewati batas waktu
              </div>
            )}
            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Nominal Denda Keterlambatan (Rp)</label>
              <input
                type="number"
                min={0}
                value={lateFee}
                onChange={(e) => setLateFee(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
            </div>
          </div>

          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B]">2. Cek Kerusakan / Kehilangan Alat</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Denda Kerusakan (Rp)</label>
                <input
                  type="number"
                  min={0}
                  value={damageAmount}
                  onChange={(e) => setDamageAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Keterangan Kerusakan</label>
                <input
                  type="text"
                  placeholder="Contoh: Resleting rusak"
                  value={damageDesc}
                  onChange={(e) => setDamageDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Denda Kehilangan (Rp)</label>
                <input
                  type="number"
                  min={0}
                  value={lossAmount}
                  onChange={(e) => setLossAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Keterangan Kehilangan</label>
                <input
                  type="text"
                  placeholder="Contoh: Pasak hilang 2 pcs"
                  value={lossDesc}
                  onChange={(e) => setLossDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
                />
              </div>
            </div>
          </div>

          {hasDeposit && (
            <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
              <h3 className="font-bold text-[#26302B] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#2B4739]" />
                <span>3. Penyerahan Kembali Jaminan</span>
              </h3>
              <div className="p-3 rounded-xl bg-white border border-[#DBD5C1] space-y-2">
                <p className="text-xs text-[#26302B]">
                  Jaminan Ditahan: <strong className="text-[#2B4739]">{depositLabel(activeDeposit!.type)}</strong>
                  {activeDeposit?.note ? ` (${activeDeposit.note})` : ''}
                </p>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={returnDeposit}
                    onChange={(e) => setReturnDeposit(e.target.checked)}
                    className="w-4 h-4 accent-[#2B4739]"
                  />
                  <span className="text-xs font-bold text-[#26302B]">Kembalikan jaminan sekarang</span>
                </label>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoOpenWA}
              onChange={(e) => setAutoOpenWA(e.target.checked)}
              className="w-4 h-4 accent-[#2B4739] rounded"
            />
            <span className="text-xs font-semibold text-[#26302B]">Kirim konfirmasi struk lewat WhatsApp</span>
          </label>

          {error && (
            <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg p-2.5">
              {error}
            </p>
          )}
        </div>

        <div className="p-4 border-t border-[#DBD5C1] bg-[#F1EEE2] flex items-center justify-end space-x-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#DBD5C1] hover:bg-white text-[#26302B] font-semibold text-xs transition">
            Batal
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs shadow-md transition flex items-center space-x-2 active:scale-95 disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4 text-[#B5652E]" />
            <span>{submitting ? 'Memproses...' : 'Selesaikan Pengembalian'}</span>
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
