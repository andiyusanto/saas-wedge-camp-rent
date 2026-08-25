import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Store, CheckCircle2 } from 'lucide-react';
import type { Business, BusinessUpdateInput } from '../hooks/useBusiness';

export function BusinessInfoSection({
  business,
  onSave,
}: {
  business: Business;
  onSave: (input: BusinessUpdateInput) => Promise<{ error: string | null }>;
}) {
  const [name, setName] = useState(business.name);
  const [ownerName, setOwnerName] = useState(business.owner_name ?? '');
  const [phone, setPhone] = useState(business.phone ?? '');
  const [toleranceHours, setToleranceHours] = useState(String(business.late_tolerance_hours));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // business bisa berubah dari luar (refresh setelah tab lain aktif) —
  // sinkronkan field kalau belum ada perubahan yang sedang diketik.
  useEffect(() => {
    setName(business.name);
    setOwnerName(business.owner_name ?? '');
    setPhone(business.phone ?? '');
    setToleranceHours(String(business.late_tolerance_hours));
  }, [business]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama usaha wajib diisi.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSaved(false);

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
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
      <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
        <Store className="w-5 h-5 text-[#2B4739]" />
        <span>Info Usaha</span>
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          </label>
        </div>
        <p className="text-[11px] text-[#6E6853]">
          Toleransi telat: berapa jam setelah janji kembali sebelum transaksi dianggap terlambat dan mulai kena denda.
        </p>

        {error && <p className="text-xs font-semibold text-[#A8412E]">{error}</p>}

        <div className="flex items-center gap-3 pt-1 border-t border-[#E6E1D2]">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4" />
            {submitting ? 'Menyimpan...' : 'Simpan'}
          </button>
          {saved && <span className="text-xs font-semibold text-[#2B4739]">Tersimpan.</span>}
        </div>
      </form>
    </div>
  );
}
