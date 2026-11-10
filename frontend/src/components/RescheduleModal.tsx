import { useState } from 'react';
import { X, CalendarClock, AlertTriangle, Send, CheckCircle2 } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { buildReceiptData } from '../hooks/useTrackings';
import type { TrackingBooking } from '../hooks/useTrackings';
import {
  formatDateIndo,
  formatIDR,
  rentalDays,
  addDaysStr,
  todayStr,
  generateWhatsAppReceipt,
  getWhatsAppShareUrl,
} from '../utils/formatters';

type ActionResult = { error: string | null; data: { start_date?: string; end_date: string; total_price: number } | null };

// Ubah Jadwal (booking 'dipesan') & Perpanjang (booking 'aktif') — Tahap
// 2, migration 055. Satu modal untuk dua aksi karena form-nya mirip
// (tanggal + alasan opsional/wajib + total manual), dibedakan lewat prop
// `mode`. Lihat research/brief-paket-hari-dan-reschedule-2026-11.md.
export function RescheduleModal({
  isOpen,
  onClose,
  booking,
  mode,
  rescheduleDeadlineDays,
  rescheduleBooking,
  extendBooking,
  businessName,
  businessAddress,
  businessLogoUrl,
  onDone,
}: {
  isOpen: boolean;
  onClose: () => void;
  booking: TrackingBooking | null;
  mode: 'ubah_jadwal' | 'perpanjang';
  rescheduleDeadlineDays: number | null;
  rescheduleBooking: (
    bookingId: string,
    body: { start_date: string; end_date: string; total_price?: number; reason?: string },
  ) => Promise<ActionResult>;
  extendBooking: (bookingId: string, body: { end_date: string; total_price?: number; reason?: string }) => Promise<ActionResult>;
  businessName: string;
  businessAddress: string | null;
  businessLogoUrl: string | null;
  onDone: () => void;
}) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [overrideTotal, setOverrideTotal] = useState(false);
  const [totalPrice, setTotalPrice] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);
  // Setelah tersimpan (brief Tahap 2 poin 8) — tampilkan tombol "Kirim
  // jadwal baru" sebelum modal ditutup, bukan auto-close+kirim otomatis
  // (vendor yang memutuskan perlu kirim WA atau cukup simpan saja).
  const [savedResult, setSavedResult] = useState<{ start_date: string; end_date: string; total_price: number } | null>(null);

  if (!isOpen || !booking) return null;

  if (initialisedFor !== `${mode}:${booking.id}`) {
    setStartDate(booking.start_date);
    setEndDate(booking.end_date);
    setReason('');
    setOverrideTotal(false);
    setTotalPrice(String(booking.total_price));
    setError(null);
    setSavedResult(null);
    setInitialisedFor(`${mode}:${booking.id}`);
  }

  const days = rentalDays(startDate, endDate, booking.rental_day_mode);

  // "Ubah jadwal paling lambat H-N hari sebelum tanggal ambil" — dihitung
  // dari tanggal ambil LAMA (sama seperti backend, routes/trackings.ts),
  // cuma PERINGATAN (keputusan Andi 10 Nov 2026), bukan blokir. Tidak
  // berlaku untuk Perpanjang (brief Tahap 2 poin 5).
  const pastDeadline =
    mode === 'ubah_jadwal' &&
    rescheduleDeadlineDays != null &&
    todayStr() > addDaysStr(booking.start_date, -rescheduleDeadlineDays);

  const belowMin =
    mode === 'ubah_jadwal' && booking.min_rental_days != null && days < booking.min_rental_days;

  async function handleSubmit() {
    if (!booking) return;
    if (mode === 'ubah_jadwal' && belowMin) {
      setError(`Minimal sewa ${booking.min_rental_days} hari.`);
      return;
    }
    if (pastDeadline && !reason.trim()) {
      setError(`Melewati batas ubah jadwal H-${rescheduleDeadlineDays}. Isi "Alasan perubahan" untuk tetap lanjut.`);
      return;
    }
    setSubmitting(true);
    setError(null);

    const body = overrideTotal ? { total_price: Number(totalPrice) || 0 } : {};
    const result =
      mode === 'ubah_jadwal'
        ? await rescheduleBooking(booking.id, { start_date: startDate, end_date: endDate, reason: reason.trim() || undefined, ...body })
        : await extendBooking(booking.id, { end_date: endDate, reason: reason.trim() || undefined, ...body });

    setSubmitting(false);
    if (result.error || !result.data) {
      setError(result.error);
      return;
    }
    setSavedResult({
      start_date: mode === 'ubah_jadwal' ? startDate : booking.start_date,
      end_date: result.data.end_date,
      total_price: result.data.total_price,
    });
  }

  function handleShareWA() {
    if (!booking || !savedResult || !booking.customer?.phone) return;
    const updatedBooking = { ...booking, start_date: savedResult.start_date, end_date: savedResult.end_date, total_price: savedResult.total_price };
    const text = generateWhatsAppReceipt(buildReceiptData(updatedBooking, businessName, businessAddress, businessLogoUrl));
    window.open(getWhatsAppShareUrl(booking.customer.phone, text), '_blank');
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-lg rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between rounded-t-2xl">
          <h3 className="font-bold text-base flex items-center gap-2">
            <CalendarClock className="w-5 h-5" />
            {mode === 'ubah_jadwal' ? 'Ubah Jadwal' : 'Perpanjang Sewa'}
          </h3>
          <button onClick={onClose} className="text-white hover:opacity-80">
            <X className="w-5 h-5" />
          </button>
        </div>

        {savedResult ? (
          <div className="p-5 space-y-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-[#2B4739]">
              <CheckCircle2 className="w-4 h-4" /> Jadwal baru tersimpan.
            </p>
            <div className="p-2.5 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-xs">
              <p>
                {booking.booking_number} · {booking.customer?.name}
              </p>
              <p className="font-bold text-[#26302B] mt-1">
                {formatDateIndo(savedResult.start_date)} – {formatDateIndo(savedResult.end_date)} · {formatIDR(savedResult.total_price)}
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-[#E6E1D2]">
              <button
                type="button"
                onClick={handleShareWA}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition flex items-center justify-center gap-1.5"
              >
                <Send className="w-4 h-4 text-[#A65C2A]" />
                Kirim Jadwal Baru via WA
              </button>
              <button type="button" onClick={onDone} className="px-4 py-2.5 rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] font-semibold text-sm">
                Selesai
              </button>
            </div>
          </div>
        ) : (
        <div className="p-5 space-y-3 text-sm">
          <p className="text-[#6E6853]">
            {booking.booking_number} · {booking.customer?.name}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Tanggal Ambil</label>
              <input
                type="date"
                value={startDate}
                disabled={mode === 'perpanjang'}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-semibold disabled:bg-[#F1EEE2] disabled:text-[#6E6853]"
              />
              {startDate && <p className="text-[10px] text-[#6E6853] mt-1">{formatDateIndo(startDate, true)}</p>}
            </div>
            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Tanggal Kembali</label>
              <input
                type="date"
                min={mode === 'perpanjang' ? addDaysStr(booking.end_date, 1) : undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-semibold"
              />
              {endDate && <p className="text-[10px] text-[#6E6853] mt-1">{formatDateIndo(endDate, true)}</p>}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-xs flex items-center justify-between">
            <span className="text-[#6E6853]">Jadwal semula: {formatDateIndo(booking.start_date)} – {formatDateIndo(booking.end_date)}</span>
            <span className="font-bold text-[#26302B]">{days} Hari</span>
          </div>

          {belowMin && (
            <p className="text-xs font-semibold text-[#A8412E] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Minimal sewa {booking.min_rental_days} hari.
            </p>
          )}
          {mode === 'ubah_jadwal' && booking.max_rental_days != null && days > booking.max_rental_days && (
            <p className="text-xs font-semibold text-[#A65C2A]">Melebihi paket {booking.max_rental_days} hari.</p>
          )}
          {pastDeadline && (
            <p className="text-xs font-semibold text-[#A65C2A] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Melewati batas ubah jadwal H-{rescheduleDeadlineDays} (tanggal ambil{' '}
              {formatDateIndo(booking.start_date)}). Isi alasan di bawah untuk tetap melanjutkan.
            </p>
          )}

          <div>
            <label className="block font-semibold text-[#26302B] mb-1">
              Alasan perubahan {pastDeadline ? '*' : '(opsional)'}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="mis. pelanggan masih di perjalanan, cuaca buruk, dsb."
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>

          <div className="pt-2 border-t border-[#E6E1D2] space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#26302B]">
              <input type="checkbox" checked={overrideTotal} onChange={(e) => setOverrideTotal(e.target.checked)} className="accent-[#2B4739]" />
              Ubah total harga manual (default: dihitung ulang otomatis kalau jumlah hari berubah)
            </label>
            {overrideTotal && (
              <input
                type="number"
                min={0}
                step={1000}
                value={totalPrice}
                onChange={(e) => setTotalPrice(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold"
              />
            )}
            {!overrideTotal && (
              <p className="text-[11px] text-[#6E6853]">Total sekarang: {formatIDR(booking.total_price)}</p>
            )}
          </div>

          {error && <p className="text-xs font-semibold text-[#A8412E]">{error}</p>}

          <div className="flex items-center gap-3 pt-2 border-t border-[#E6E1D2]">
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition disabled:opacity-60"
            >
              {submitting ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] font-semibold text-sm">
              Batal
            </button>
          </div>
        </div>
        )}
      </ModalPanel>
    </ModalBackdrop>
  );
}
