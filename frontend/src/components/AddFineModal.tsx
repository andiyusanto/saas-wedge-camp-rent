import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { X, PlusCircle } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { TrackingBooking } from '../hooks/useTrackings';
import { apiFetch } from '../lib/api';

type FineType = 'kerusakan' | 'kehilangan';

export function AddFineModal({
  isOpen,
  onClose,
  booking,
  session,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  booking: TrackingBooking | null;
  session: Session;
  onSaved: () => void;
}) {
  const [type, setType] = useState<FineType>('kerusakan');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !booking) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim() || Number(amount) <= 0) {
      setError('Isi keterangan denda dan nominal rupiah > 0');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiFetch(session, `/api/bookings/${booking!.id}/penalties`, {
        method: 'POST',
        body: JSON.stringify({ type, amount: Number(amount), description: description.trim() }),
      });
    } catch (err) {
      setSubmitting(false);
      setError((err as Error).message);
      return;
    }
    setSubmitting(false);

    setDescription('');
    setAmount('');
    onSaved();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-md rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto flex flex-col">
        <div className="bg-[#A8412E] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <PlusCircle className="w-5 h-5 text-white" />
            <h2 className="text-base font-bold">Tambah Denda Transaksi</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs sm:text-sm">
          <div className="p-3 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1]">
            <p className="text-[#6E6853]">
              Booking: <strong className="text-[#26302B]">{booking.booking_number ?? '-'}</strong>
            </p>
            <p className="text-[#6E6853]">
              Penyewa: <strong className="text-[#26302B]">{booking.customer?.name}</strong>
            </p>
          </div>

          <div>
            <label className="block font-semibold text-[#26302B] mb-1">Kategori Denda *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType('kerusakan')}
                className={`p-2.5 rounded-xl text-xs font-bold border text-center transition ${
                  type === 'kerusakan' ? 'bg-[#A65C2A] text-white border-[#A65C2A]' : 'bg-[#F1EEE2] text-[#26302B] border-[#DBD5C1]'
                }`}
              >
                Kerusakan
              </button>
              <button
                type="button"
                onClick={() => setType('kehilangan')}
                className={`p-2.5 rounded-xl text-xs font-bold border text-center transition ${
                  type === 'kehilangan' ? 'bg-[#A8412E] text-white border-[#A8412E]' : 'bg-[#F1EEE2] text-[#26302B] border-[#DBD5C1]'
                }`}
              >
                Kehilangan
              </button>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-[#26302B] mb-1">Keterangan Denda / Alasan *</label>
            <input
              type="text"
              required
              placeholder="Contoh: Frame tenda bengkok 1 ruas"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#26302B] mb-1">Nominal Denda (Rupiah) *</label>
            <input
              type="number"
              required
              min={0}
              step={1000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold text-sm focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>

          {error && <p className="text-[#A8412E] font-semibold">{error}</p>}

          <div className="pt-3 border-t border-[#DBD5C1] flex items-center justify-end space-x-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] font-semibold text-xs transition">
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-[#A8412E] hover:bg-[#8D3524] text-white font-bold text-xs shadow-md transition disabled:opacity-60"
            >
              Simpan Denda
            </button>
          </div>
        </form>
      </ModalPanel>
    </ModalBackdrop>
  );
}
