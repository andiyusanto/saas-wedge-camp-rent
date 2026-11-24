import { useState } from 'react';
import { X, PackageCheck, ShieldCheck } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { TrackingBooking } from '../hooks/useTrackings';
import { depositLabel, computeRemainingBalance, formatDateIndo, formatIDR, todayStr } from '../utils/formatters';

type DepositType = '' | 'ktp' | 'sim' | 'stnk' | 'paspor' | 'uang' | 'lainnya';

// Dialog pengingat jaminan saat Ambil (brief 15 Nov 2026, Bagian B) —
// "Sewa Alat Pendakian": "sering kelupaan minta kartu jaminan ke
// costumer". Wajib dicentang sebelum lanjut, bisa ganti jenis jaminan
// (mis. KTP ketinggalan, diganti Uang/SIM) atau memilih jaminan kalau
// booking belum punya sama sekali (mis. dari Pesanan Online). TIDAK bisa
// "downgrade" jaminan yang SUDAH ADA jadi tanpa jaminan — tidak ada
// jalur hapus deposit di aplikasi ini, keputusan Andi 15 Nov 2026 (di
// luar cakupan brief ini). Satu layar, minim ketikan (CLAUDE.md bagian 5).
export function PickupConfirmModal({
  isOpen,
  onClose,
  booking,
  pickupBooking,
  onDone,
}: {
  isOpen: boolean;
  onClose: () => void;
  booking: TrackingBooking | null;
  pickupBooking: (
    bookingId: string,
    deposit?: { type: string; amount?: number; note?: string | null },
    payment?: { amount: number; method?: string | null; note?: string | null },
  ) => Promise<{ error: string | null }>;
  onDone: () => void;
}) {
  const [depositType, setDepositType] = useState<DepositType>('');
  const [depositNote, setDepositNote] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);
  // "Lunasi sekarang" (brief 17 Nov 2026) -- belum ada denda saat Ambil,
  // jadi sisa di sini cuma sewa+barang jual dikurangi yang sudah dibayar.
  const [lunasiSekarang, setLunasiSekarang] = useState(false);
  const [payMethod, setPayMethod] = useState('tunai');

  // Bug Andi 16 Nov 2026 (pola sama UbahAlatModal.tsx): reset saat ditutup
  // supaya dibuka ulang untuk booking yang sama (mis. batal lalu buka
  // lagi) selalu inisialisasi ulang dari data TERBARU.
  if (!isOpen) {
    if (initialisedFor !== null) setInitialisedFor(null);
    return null;
  }
  if (!booking) return null;

  const existingDeposit = booking.deposits.find((d) => d.status === 'ditahan');

  if (initialisedFor !== booking.id) {
    setDepositType((existingDeposit?.type as DepositType) ?? '');
    setDepositNote(existingDeposit?.note ?? '');
    setDepositAmount(existingDeposit?.amount != null ? String(existingDeposit.amount) : '');
    setConfirmed(false);
    setError(null);
    setLunasiSekarang(false);
    // Rencana bayar (brief rencana-bayar-bebaskan-denda 24 Nov 2026) --
    // default cara bayar = rencana bayar booking ini (bisa diganti).
    setPayMethod(booking.payment_plan === 'cash' ? 'tunai' : booking.payment_plan || 'tunai');
    setInitialisedFor(booking.id);
  }

  const remaining = computeRemainingBalance(booking.total_price, 0, booking.dp_paid);

  async function handleConfirm() {
    if (!booking) return;
    if (depositType === 'uang' && !(Number(depositAmount) > 0)) {
      setError('Jumlah Deposit Uang wajib diisi (lebih dari 0) untuk jenis jaminan Uang.');
      return;
    }
    if (!confirmed) {
      setError('Centang konfirmasi dulu sebelum lanjut.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const { error: err } = await pickupBooking(
      booking.id,
      depositType
        ? { type: depositType, amount: depositType === 'uang' ? Number(depositAmount) || 0 : undefined, note: depositNote || null }
        : undefined,
      lunasiSekarang && remaining > 0 ? { amount: remaining, method: payMethod } : undefined,
    );

    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    onDone();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-sm rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between">
          <h3 className="font-bold text-base flex items-center gap-2">
            <PackageCheck className="w-5 h-5" />
            Tandai Barang Diambil
          </h3>
          <button onClick={onClose} className="text-white hover:opacity-80">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-sm">
          <p className="text-[#6E6853]">
            {booking.booking_number} · {booking.customer?.name}
          </p>

          {/* Pickup lebih awal (brief 23 Nov 2026, bagian C) -- info saja,
              bukan batas hari seperti "Alat diambil sekarang" di Catat
              Transaksi (dipesan boleh diambil lebih awal kapan pun,
              cukup cek stok malam itu -- 409 ramah di handleConfirm
              lewat error state yang sudah ada kalau kurang). */}
          {booking.start_date > todayStr() && (
            <p className="text-[11px] text-[#A65C2A] font-medium bg-[#F9EFE7] border border-[#A65C2A]/30 rounded-lg px-3 py-2">
              Diambil lebih awal dari Mulai Sewa ({formatDateIndo(booking.start_date, false)}). Stok terkunci sejak hari ini.
            </p>
          )}

          <div>
            <label className="block font-semibold text-[#26302B] mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#2B4739]" />
              Jenis Jaminan
            </label>
            <select
              value={depositType}
              onChange={(e) => setDepositType(e.target.value as DepositType)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-semibold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            >
              <option value="">Tanpa jaminan</option>
              <option value="ktp">{depositLabel('ktp')}</option>
              <option value="sim">{depositLabel('sim')}</option>
              <option value="stnk">{depositLabel('stnk')}</option>
              <option value="paspor">{depositLabel('paspor')}</option>
              <option value="uang">{depositLabel('uang')}</option>
              <option value="lainnya">{depositLabel('lainnya')}</option>
            </select>
            <p className="text-[11px] text-[#6E6853] mt-1">
              Pelanggan tidak bawa jaminan? Ganti ke jenis lain (mis. Uang) atau batalkan transaksi.
            </p>
          </div>

          {depositType === 'uang' && (
            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Jumlah Deposit Uang (Rp) *</label>
              <input
                type="number"
                min={0}
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold"
              />
            </div>
          )}

          {depositType && (
            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Catatan Identitas Jaminan (opsional)</label>
              <input
                type="text"
                placeholder={`Contoh: ${depositLabel(depositType)} a.n. ${booking.customer?.name ?? 'Penyewa'}`}
                value={depositNote}
                onChange={(e) => setDepositNote(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
            </div>
          )}

          {remaining > 0 && (
            <div className="p-3 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1] space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lunasiSekarang}
                  onChange={(e) => setLunasiSekarang(e.target.checked)}
                  className="w-4 h-4 accent-[#2B4739] shrink-0"
                />
                <span className="text-xs font-bold text-[#26302B]">Lunasi sekarang {formatIDR(remaining)}</span>
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

          <label className="flex items-start gap-2 p-3 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1] cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="w-4 h-4 accent-[#2B4739] mt-0.5 shrink-0"
            />
            <span className="text-xs font-bold text-[#26302B]">
              {depositType
                ? `Sudah terima ${depositLabel(depositType)} dari ${booking.customer?.name ?? 'pelanggan ini'}`
                : `Konfirmasi: TIDAK ada jaminan untuk transaksi ini`}
            </span>
          </label>

          {error && <p className="text-xs font-semibold text-[#A8412E]">{error}</p>}

          <div className="flex items-center gap-3 pt-2 border-t border-[#E6E1D2]">
            <button
              type="button"
              disabled={submitting || !confirmed}
              onClick={handleConfirm}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition disabled:opacity-60"
            >
              {submitting ? 'Memproses...' : 'Ambil'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] font-semibold text-sm">
              Batal
            </button>
          </div>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
