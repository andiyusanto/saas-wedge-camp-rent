import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { formatIDR } from '../utils/formatters';

// Pelunasan (brief 17 Nov 2026, migration 067) -- dipakai dari dua tempat
// (Transaksi Aktif & Riwayat) buat "Catat Pembayaran"/"Lunasi sisa", jadi
// komponennya dibuat generik: pemanggil yang tahu cara kirim ke endpoint
// (Transaksi Aktif lewat useTrackings().addPayment, Riwayat lewat apiFetch
// langsung karena useHistory tidak punya mutator) -- modal ini cuma UI +
// validasi nominal, tidak tahu bookingId/session sama sekali.
export function PaymentModal({
  isOpen,
  onClose,
  remaining,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  remaining: number;
  onSubmit: (body: { amount: number; method: string | null; note: string | null }) => Promise<{ error: string | null }>;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('tunai');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAmount(remaining > 0 ? String(Math.round(remaining)) : '');
      setMethod('tunai');
      setNote('');
      setError(null);
    }
  }, [isOpen, remaining]);

  if (!isOpen) return null;

  async function handleSubmit() {
    const n = Number(amount);
    if (!(n > 0)) {
      setError('Nominal harus lebih dari 0');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await onSubmit({ amount: n, method, note: note.trim() || null });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-white w-full max-w-sm rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between">
          <h2 className="text-lg font-bold">Catat Pembayaran</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          {remaining > 0 && (
            <p className="text-[#6E6853]">
              Sisa tagihan saat ini: <strong className="text-[#A8412E]">{formatIDR(remaining)}</strong>
            </p>
          )}
          <div>
            <label className="block text-xs font-bold text-[#6E6853] mb-1">Nominal</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#DBD5C1] text-sm"
            />
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(Math.round(remaining)))}
                className="mt-1 text-xs font-bold text-[#2B4739] underline"
              >
                Lunasi sisa {formatIDR(remaining)}
              </button>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-[#6E6853] mb-1">Cara Bayar</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#DBD5C1] text-sm">
              <option value="tunai">Tunai</option>
              <option value="transfer">Transfer</option>
              <option value="qris">QRIS</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#6E6853] mb-1">Catatan (opsional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#DBD5C1] text-sm"
            />
          </div>
          {error && <p className="text-xs text-[#A8412E] font-bold">{error}</p>}
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="w-full py-2.5 rounded-xl bg-[#2B4739] text-white font-bold text-sm disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan Pembayaran'}
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
