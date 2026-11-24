import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { X, RotateCcw, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { TrackingBooking } from '../hooks/useTrackings';
import { apiFetch } from '../lib/api';
import {
  formatDateIndo,
  depositLabel,
  generateWhatsAppReceipt,
  getWhatsAppShareUrl,
  computeRemainingBalance,
  formatIDR,
} from '../utils/formatters';

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
  const [damageItemId, setDamageItemId] = useState('');
  const [lossAmount, setLossAmount] = useState('');
  const [lossDesc, setLossDesc] = useState('');
  const [lossItemId, setLossItemId] = useState('');
  const [returnDeposit, setReturnDeposit] = useState(true);
  const [autoOpenWA, setAutoOpenWA] = useState(true);
  // "Lunasi sekarang" (brief 17 Nov 2026) -- ditampilkan SETELAH denda
  // diisi, jadi sisa yang dihitung di sini sudah termasuk denda telat +
  // kerusakan/kehilangan yang BARU DIISI di form ini (belum tersimpan),
  // bukan cuma denda yang sudah ada di booking.penalties.
  const [lunasiSekarang, setLunasiSekarang] = useState(false);
  const [payMethod, setPayMethod] = useState('tunai');
  // Bebaskan denda telat (brief rencana-bayar-bebaskan-denda 24 Nov 2026,
  // wawancara 15-23 Nov: 9 vendor membebaskan denda kalau pelanggan
  // sudah mengabari). Bisa dibatalkan sebelum Simpan (kembali ke saran
  // lewat preWaivedAmount). Denda kerusakan/kehilangan TIDAK terpengaruh.
  const [feeWaived, setFeeWaived] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [preWaivedAmount, setPreWaivedAmount] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  // Bug Andi 16 Nov 2026 (pola sama UbahAlatModal.tsx): reset saat ditutup
  // supaya dibuka ulang untuk booking yang sama (mis. batal lalu buka
  // lagi) selalu inisialisasi ulang dari data TERBARU.
  if (!isOpen) {
    if (initialisedFor !== null) setInitialisedFor(null);
    return null;
  }
  if (!booking) return null;

  if (initialisedFor !== booking.id) {
    setLateFee(String(Math.round(booking.suggested_late_fee)));
    setDamageAmount('');
    setDamageDesc('');
    setDamageItemId(booking.items.length === 1 ? booking.items[0].item_id : '');
    setLossAmount('');
    setLossDesc('');
    setLossItemId(booking.items.length === 1 ? booking.items[0].item_id : '');
    setReturnDeposit(booking.deposits.some((d) => d.status === 'ditahan'));
    // Rencana bayar (brief 24 Nov 2026) -- default cara bayar lunasi
    // sekarang = rencana bayar booking ini (bisa diganti).
    setPayMethod(booking.payment_plan === 'cash' ? 'tunai' : booking.payment_plan || 'tunai');
    setFeeWaived(false);
    setWaiveReason('');
    setPreWaivedAmount('0');
    setError(null);
    setInitialisedFor(booking.id);
  }

  // Cara hitung denda telat (migration 063) — snapshot transaksi ini.
  const lateFeeDisabled = booking.late_fee_mode === 'tanpa_denda';
  const isHourlyMode = booking.late_fee_mode === 'per_jam';
  const hasDeposit = booking.deposits.some((d) => d.status === 'ditahan');
  const activeDeposit = booking.deposits.find((d) => d.status === 'ditahan');
  const needsItemChoice = booking.items.length > 1;
  const itemNameById = (id: string) => booking.items.find((i) => i.item_id === id)?.name ?? null;

  // Sisa tagihan FINAL (pola computeRemainingBalance) -- existing
  // penalties (kalau ada, dari AddFineModal sebelumnya) + denda yang
  // BARU diisi di form ini (belum tersimpan ke DB).
  const existingFinesTotal = booking.penalties.reduce((sum, p) => sum + p.amount, 0);
  const newFinesTotal = (Number(lateFee) || 0) + (Number(damageAmount) || 0) + (Number(lossAmount) || 0);
  const remainingAfterReturn = computeRemainingBalance(booking.total_price, existingFinesTotal + newFinesTotal, booking.dp_paid);

  async function handleConfirm() {
    if (!booking) return;

    if (Number(damageAmount) > 0 && needsItemChoice && !damageItemId) {
      setError('Pilih alat yang rusak');
      return;
    }
    if (Number(lossAmount) > 0 && needsItemChoice && !lossItemId) {
      setError('Pilih alat yang hilang');
      return;
    }
    if (feeWaived && waiveReason.trim().length === 0) {
      setError('Alasan pembebasan denda wajib diisi');
      return;
    }

    setSubmitting(true);
    setError(null);

    const extraPenalties: { type: string; amount: number; description: string | null; item_id: string | null }[] =
      [];
    if (Number(damageAmount) > 0) {
      extraPenalties.push({
        type: 'kerusakan',
        amount: Number(damageAmount),
        description: damageDesc || null,
        item_id: damageItemId || null,
      });
    }
    if (Number(lossAmount) > 0) {
      extraPenalties.push({
        type: 'kehilangan',
        amount: Number(lossAmount),
        description: lossDesc || null,
        item_id: lossItemId || null,
      });
    }

    const willPay = lunasiSekarang && remainingAfterReturn > 0;
    let body: { status: string };
    try {
      body = await apiFetch(session, `/api/bookings/${booking.id}/return`, {
        method: 'POST',
        body: JSON.stringify({
          late_fee_amount: Number(lateFee) || 0,
          extra_penalties: extraPenalties,
          return_deposits: hasDeposit && returnDeposit,
          payment: willPay ? { amount: remainingAfterReturn, method: payMethod } : undefined,
          ...(feeWaived
            ? { late_fee_waived_amount: Number(preWaivedAmount) || 0, late_fee_waived_reason: waiveReason.trim() }
            : {}),
        }),
      });
    } catch (err) {
      setSubmitting(false);
      setError((err as Error).message);
      return;
    }
    setSubmitting(false);

    if (autoOpenWA && booking.customer?.phone) {
      const allFines = [
        ...booking.penalties,
        ...(Number(lateFee) > 0
          ? [{ type: 'keterlambatan', amount: Number(lateFee), description: null, item_name: null }]
          : []),
        ...extraPenalties.map((p) => ({ ...p, item_name: p.item_id ? itemNameById(p.item_id) : null })),
      ];
      const receiptText = generateWhatsAppReceipt({
        bookingNumber: booking.booking_number ?? '-',
        customerName: booking.customer.name,
        customerPhone: booking.customer.phone,
        startDate: booking.start_date,
        endDate: booking.end_date,
        items: booking.items.map((i) => ({ name: i.name, quantity: i.quantity, price_per_day: 0 })),
        saleItems: booking.sale_items.map((s) => ({ name: s.name, quantity: s.quantity, unitPrice: s.price_at_booking, subtotal: s.subtotal })),
        totalPrice: booking.total_price,
        dpPaid: willPay ? booking.dp_paid + remainingAfterReturn : booking.dp_paid,
        depositType: activeDeposit?.type ?? null,
        depositNote: activeDeposit?.note ?? null,
        depositStatus: hasDeposit && returnDeposit ? 'dikembalikan' : (activeDeposit?.status as 'ditahan' | null),
        status: body.status,
        fines: allFines,
        businessName,
        rentalDayMode: booking.rental_day_mode,
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
            <RotateCcw className="w-5 h-5 text-[#A65C2A]" />
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
            <p className="text-[#6E6853]">
              Jadwal Sewa: {formatDateIndo(booking.start_date)} s/d {formatDateIndo(booking.end_date)}
            </p>
          </div>

          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B]">1. Denda Keterlambatan</h3>
            {booking.is_overdue ? (
              <div
                className={`p-3 rounded-lg border ${
                  lateFeeDisabled ? 'bg-[#F9EFE7] border-[#A65C2A]/40 text-[#A65C2A]' : 'bg-[#FAF0EE] border-[#A8412E]/40 text-[#A8412E]'
                }`}
              >
                <p className="font-extrabold flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> {lateFeeDisabled ? 'LEWAT BATAS KEMBALI' : 'TERLAMBAT'} {booking.hours_late} JAM
                </p>
                {/* Cara hitung denda telat (migration 063) — tiga tampilan
                    beda per mode: tanpa_denda (rincian disembunyikan, cuma
                    catatan netral), per_jam (satu baris "jam x tarif",
                    BUKAN breakdown per-alat), sisanya (bertahap_12jam/
                    per_hari_24jam) pola breakdown per-alat yang sudah ada. */}
                {lateFeeDisabled ? (
                  <p className="text-[11px] text-[#26302B] mt-1">
                    Rental ini tidak memungut denda telat otomatis — isi manual kalau perlu.
                  </p>
                ) : isHourlyMode ? (
                  <>
                    <p className="text-[11px] text-[#26302B] mt-1">Saran denda otomatis (bisa diubah):</p>
                    {booking.late_fee_hourly && (
                      <p className="text-[11px] text-[#26302B] mt-1">
                        Telat {booking.late_fee_hourly.hours} jam × Rp{booking.late_fee_hourly.per_hour.toLocaleString('id-ID')} = Rp
                        {(booking.late_fee_hourly.hours * booking.late_fee_hourly.per_hour).toLocaleString('id-ID')}
                        {booking.late_fee_hourly.capped && (
                          <> — dibatasi maks Rp{(booking.late_fee_hourly.cap ?? 0).toLocaleString('id-ID')} (setara per hari penuh)</>
                        )}
                        {booking.late_fee_hourly.needs_manual_input && <> — nominal Rp/jam belum diatur, isi manual.</>}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-[#26302B] mt-1">Saran denda otomatis (bisa diubah):</p>
                    {booking.late_fee_breakdown.length > 0 && (
                      <ul className="text-[11px] text-[#26302B] mt-1 space-y-0.5">
                        {booking.late_fee_breakdown.map((x) => (
                          <li key={x.item_id}>
                            {x.name}: ~Rp{x.per_day_rate.toLocaleString('id-ID')}/hari × {booking.late_days_equivalent} hari
                            telat = Rp{x.fee.toLocaleString('id-ID')}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
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
            {/* Bebaskan denda telat (brief 24 Nov 2026) -- tombol tidak
                tampil kalau mode tanpa_denda (saran sudah Rp0, tidak ada
                apa pun untuk dibebaskan). */}
            {!lateFeeDisabled && !feeWaived && (
              <button
                type="button"
                onClick={() => {
                  setPreWaivedAmount(lateFee);
                  setLateFee('0');
                  setFeeWaived(true);
                }}
                className="text-xs font-semibold text-[#A65C2A] underline underline-offset-2"
              >
                Bebaskan denda
              </button>
            )}
            {feeWaived && (
              <div className="p-3 rounded-lg bg-white border border-[#A65C2A]/40 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-[#A65C2A]">
                    Denda dibebaskan (sebelumnya Rp{Number(preWaivedAmount).toLocaleString('id-ID')})
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setLateFee(preWaivedAmount);
                      setFeeWaived(false);
                      setWaiveReason('');
                    }}
                    className="text-[11px] font-semibold text-[#6E6853] underline underline-offset-2"
                  >
                    Batalkan
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['Pelanggan sudah mengabari', 'Cuaca/kendala di jalan', 'Pelanggan langganan'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setWaiveReason(preset)}
                      className={`text-[11px] px-2 py-1 rounded-full border transition ${
                        waiveReason === preset
                          ? 'bg-[#A65C2A] text-white border-[#A65C2A]'
                          : 'bg-white text-[#6E6853] border-[#DBD5C1] hover:bg-[#F1EEE2]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={waiveReason}
                  onChange={(e) => setWaiveReason(e.target.value)}
                  placeholder="Alasan pembebasan denda (wajib)"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-xs"
                />
              </div>
            )}
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
              {needsItemChoice && (
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-[#26302B] mb-1">Alat yang Rusak</label>
                  <select
                    value={damageItemId}
                    onChange={(e) => setDamageItemId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
                  >
                    <option value="">Pilih alat...</option>
                    {booking.items.map((i) => (
                      <option key={i.item_id} value={i.item_id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
              {needsItemChoice && (
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-[#26302B] mb-1">Alat yang Hilang</label>
                  <select
                    value={lossItemId}
                    onChange={(e) => setLossItemId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
                  >
                    <option value="">Pilih alat...</option>
                    {booking.items.map((i) => (
                      <option key={i.item_id} value={i.item_id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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

          {remainingAfterReturn > 0 && (
            <div className="p-3 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1] space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lunasiSekarang}
                  onChange={(e) => setLunasiSekarang(e.target.checked)}
                  className="w-4 h-4 accent-[#2B4739] shrink-0"
                />
                <span className="text-xs font-bold text-[#26302B]">
                  Lunasi sekarang {formatIDR(remainingAfterReturn)} (termasuk denda)
                </span>
              </label>
              {lunasiSekarang && (
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-xs text-[#26302B]"
                >
                  <option value="tunai">Tunai</option>
                  <option value="transfer">Transfer</option>
                  <option value="qris">QRIS</option>
                </select>
              )}
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
            <CheckCircle2 className="w-4 h-4 text-[#A65C2A]" />
            <span>{submitting ? 'Memproses...' : 'Selesaikan Pengembalian'}</span>
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
