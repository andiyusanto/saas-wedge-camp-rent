import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Store, CheckCircle2, Upload, X } from 'lucide-react';
import type { Business, BusinessUpdateInput } from '../hooks/useBusiness';
import { useRegencies } from '../hooks/useRegencies';
import { RegencySelect } from './RegencySelect';
import { apiFetch } from '../lib/api';
import { resizeImageToDataUrl } from '../utils/imageResize';

export function BusinessInfoSection({
  session,
  businessId,
  business,
  ownerEmail,
  onSave,
}: {
  session: Session;
  businessId: string;
  business: Business;
  ownerEmail: string | null;
  onSave: (input: BusinessUpdateInput) => Promise<{ error: string | null }>;
}) {
  const [name, setName] = useState(business.name);
  const [ownerName, setOwnerName] = useState(business.owner_name ?? '');
  const [phone, setPhone] = useState(business.phone ?? '');
  const [address, setAddress] = useState(business.address ?? '');
  const [regencyId, setRegencyId] = useState(business.regency_id ?? '');
  const { provinces, regencies } = useRegencies();
  const [toleranceHours, setToleranceHours] = useState(String(business.late_tolerance_hours));
  const [logoUrl, setLogoUrl] = useState(business.logo_url ?? '');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // business bisa berubah dari luar (refresh setelah tab lain aktif) —
  // sinkronkan field kalau belum ada perubahan yang sedang diketik.
  useEffect(() => {
    setName(business.name);
    setOwnerName(business.owner_name ?? '');
    setPhone(business.phone ?? '');
    setAddress(business.address ?? '');
    setRegencyId(business.regency_id ?? '');
    setToleranceHours(String(business.late_tolerance_hours));
    setLogoUrl(business.logo_url ?? '');
  }, [business]);

  // Logo usaha (migration 035) — pola sama seperti upload foto alat di
  // ItemsScreen.tsx, cuma maxDimension lebih kecil (512, bukan 1280) dan
  // quality lebih tinggi (0.9) karena logo biasanya elemen flat/teks,
  // bukan foto — kompresi webp lebih kentara di situ dibanding foto.
  async function handleUploadLogo(file: File) {
    setUploadingLogo(true);
    setError(null);

    try {
      const dataUrl = await resizeImageToDataUrl(file, 512, 0.9);
      const body = await apiFetch<{ url: string }>(session, '/api/uploads/business-logo', {
        method: 'POST',
        body: JSON.stringify({ businessId, image: dataUrl }),
      });
      setLogoUrl(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah logo.');
    } finally {
      setUploadingLogo(false);
    }
  }

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
      address: address.trim() || null,
      regency_id: regencyId || null,
      late_tolerance_hours: Math.max(0, Number(toleranceHours) || 0),
      logo_url: logoUrl.trim() || null,
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
        <div>
          <label className="block text-sm text-[#6E6853] mb-1.5">Logo Usaha</label>
          <div className="flex items-center gap-2">
            {logoUrl && (
              <span className="relative shrink-0">
                <img
                  src={logoUrl}
                  alt="Pratinjau logo"
                  className="h-14 w-14 object-contain rounded-lg border border-[#DBD5C1] bg-white"
                />
                <button
                  type="button"
                  onClick={() => setLogoUrl('')}
                  title="Hapus logo"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#A8412E] text-white flex items-center justify-center shadow-sm"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <label className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-[#DBD5C1] px-3 py-2.5 text-xs font-semibold text-[#6E6853] hover:bg-[#F1EEE2] cursor-pointer transition">
              <Upload className="w-4 h-4" />
              {uploadingLogo ? 'Mengunggah...' : logoUrl ? 'Ganti Logo' : 'Upload Logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={uploadingLogo}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadLogo(file);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
          </div>
          <input
            type="url"
            placeholder="atau tempel URL gambar di sini..."
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="mt-2 w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-sm"
          />
          <span className="text-[11px] text-[#6E6853] block mt-1">
            Opsional — tampil di Etalase Online, preview link WhatsApp, dan Nota Sewa cetak. Tanpa logo, tampilan
            di tempat-tempat itu seperti sekarang.
          </span>
        </div>

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
          <RegencySelect provinces={provinces} regencies={regencies} value={regencyId} onChange={setRegencyId} />
          <div className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Email pemilik (akun login)
            <p className="px-3 py-2 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-[#26302B]">
              {ownerEmail ?? '-'}
            </p>
          </div>
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
        <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
          Alamat usaha
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            placeholder="Jl. Contoh No. 1, Malang"
            className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
          />
          <span className="text-[11px] text-[#6E6853]">
            Ikut tercetak di struk WhatsApp dan Nota Sewa cetak/PDF kalau diisi.
          </span>
        </label>
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
