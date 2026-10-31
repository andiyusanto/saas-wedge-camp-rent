import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { AdminBusinessRow } from '../hooks/useAdminBusinesses';

// Form "Catat Pembayaran" — satu-satunya jalur tulis ke subscription_payments
// + subscriptions.active_until, lewat RPC record_subscription_payment
// (migration 044, is_app_admin() wajib di server, period math inklusif
// sudah diperbaiki di sana — jangan hitung ulang active_until di sini).
export function AdminPaymentModal({
  business,
  onClose,
  onSaved,
}: {
  business: AdminBusinessRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [periodDays, setPeriodDays] = useState('30');
  const [method, setMethod] = useState('transfer');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!supabase) return;
    const amountNum = Number(amount);
    const periodNum = Number(periodDays);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setError('Jumlah tidak valid.');
      return;
    }
    if (!Number.isFinite(periodNum) || periodNum < 1 || periodNum > 400) {
      setError('Jumlah hari harus antara 1-400.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('record_subscription_payment', {
      p_business_id: business.business_id,
      p_amount: amountNum,
      p_period_days: periodNum,
      p_method: method,
      p_note: note || null,
      p_proof_url: null,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="w-full max-w-sm bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-lg p-5 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#26302B]">Catat Pembayaran</h2>
          <p className="text-xs text-[#6E6853] truncate">{business.name} · {business.owner_email}</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-[#6E6853]">Jumlah (Rp)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-sm"
              placeholder="0"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6E6853]">Masa aktif (hari)</label>
            <input
              type="number"
              value={periodDays}
              onChange={(e) => setPeriodDays(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6E6853]">Metode</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-sm"
            >
              <option value="transfer">Transfer</option>
              <option value="qris">QRIS</option>
              <option value="tunai">Tunai</option>
              <option value="lainnya">Lainnya</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6E6853]">Catatan (opsional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-sm"
            />
          </div>
        </div>

        {error && <p className="text-xs text-[#A8412E]">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] font-semibold text-sm"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm disabled:opacity-60"
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
