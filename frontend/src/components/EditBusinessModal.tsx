import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { X, Store, CheckCircle2 } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { Business, BusinessUpdateInput } from '../hooks/useBusiness';

export function EditBusinessModal({
  isOpen,
  onClose,
  business,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  business: Business | null;
  onSave: (input: BusinessUpdateInput) => Promise<{ error: string | null }>;
}) {
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [toleranceHours, setToleranceHours] = useState('6');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !business) return;
    setName(business.name);
    setOwnerName(business.owner_name ?? '');
    setPhone(business.phone ?? '');
    setToleranceHours(String(business.late_tolerance_hours));
    setError(null);
  }, [isOpen, business]);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama usaha wajib diisi.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const { error: saveError } = await onSave({
      name: name.trim(),
      owner_name: ownerName.trim() || null,
      phone: phone.trim() || null,
      late_tolerance_hours: Math.max(0, Number(toleranceHours) || 0),
    });

    setSubmitting(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    onClose();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-md rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-[#A65C2A]" />
            <h2 className="text-lg font-bold">Info Usaha</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-sm overflow-y-auto">
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Nama usaha *
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Nama pemilik
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            No. telepon
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Toleransi telat (jam)
            <input
              type="number"
              min={0}
              step={1}
              value={toleranceHours}
              onChange={(e) => setToleranceHours(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
            <span className="text-[11px] text-[#6E6853] font-normal">
              Berapa jam setelah janji kembali sebelum transaksi dianggap terlambat dan mulai kena denda.
            </span>
          </label>

          {error && (
            <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg p-2.5">
              {error}
            </p>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] font-semibold text-xs transition"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs shadow-md transition flex items-center gap-2 active:scale-95 disabled:opacity-60"
            >
              <CheckCircle2 className="w-4 h-4 text-[#A65C2A]" />
              <span>{submitting ? 'Menyimpan...' : 'Simpan Perubahan'}</span>
            </button>
          </div>
        </form>
      </ModalPanel>
    </ModalBackdrop>
  );
}
