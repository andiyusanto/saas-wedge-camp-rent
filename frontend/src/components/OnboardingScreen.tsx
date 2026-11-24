import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Store } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { API_BASE_URL } from '../lib/api';

// Ajak Rental Lain (brief 24 Nov 2026) -- validasi "ringan" cuma
// menampilkan nama rental pengajak, lewat endpoint publik (TANPA login,
// TANPA secret di sisi klien -- secret ada di backend saja, lihat
// routes/referrals.ts). Didebounce di pemanggil (useEffect di bawah),
// bukan di sini.
async function validateReferralCode(code: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/public/referral-codes/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.name ?? null;
  } catch {
    return null;
  }
}

export function OnboardingScreen({
  referralCode: initialReferralCode,
  onCreated,
}: {
  // Kode ajakan dari link `?ref=` (App.tsx readReferralCode()), prefill
  // otomatis tapi TETAP bisa diubah manual (brief: "terisi otomatis dari
  // link dan bisa diubah").
  referralCode: string | null;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState(initialReferralCode ?? '');
  const [referralPreviewName, setReferralPreviewName] = useState<string | null>(null);
  const [referralChecked, setReferralChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Validasi langsung (didebounce) -- "✓ Diajak oleh {nama}" / "Kode
  // tidak ditemukan". Kode salah TIDAK PERNAH menghalangi daftar (brief)
  // -- ini cuma info, bukan validasi form (tidak ada `required`/block submit).
  useEffect(() => {
    const code = referralCode.trim();
    if (!code) {
      setReferralPreviewName(null);
      setReferralChecked(false);
      return;
    }
    setReferralChecked(false);
    const timer = setTimeout(async () => {
      const foundName = await validateReferralCode(code);
      setReferralPreviewName(foundName);
      setReferralChecked(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [referralCode]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    setSubmitting(true);
    setError(null);

    const { data: userData } = await supabase.auth.getUser();
    const ownerId = userData.user?.id;
    const ownerEmail = userData.user?.email;

    if (!ownerId || !ownerEmail) {
      setError('Sesi login tidak ditemukan, coba login ulang.');
      setSubmitting(false);
      return;
    }

    // ID digenerate di client (bukan mengandalkan default gen_random_uuid()
    // + .select() baca-balik) — soalnya baca-balik lewat RLS SELECT butuh
    // is_member_of(), yang baru terpenuhi SETELAH baris business_members di
    // bawah ini ada. Kalau insert dulu baru select id, jadi ayam-telur.
    const businessId = crypto.randomUUID();

    const { error: insertError } = await supabase.from('businesses').insert({
      id: businessId,
      owner_id: ownerId,
      name,
      owner_name: ownerName || null,
      phone: phone || null,
    });

    if (insertError) {
      setSubmitting(false);
      setError(insertError.message);
      return;
    }

    // RLS businesses (select/update) sekarang lewat business_members, bukan
    // owner_id langsung — tanpa baris ini pemilik yang baru saja bikin
    // bisnisnya sendiri malah tidak bisa membacanya lagi.
    const { error: memberError } = await supabase.from('business_members').insert({
      business_id: businessId,
      user_id: ownerId,
      role: 'owner',
      email: ownerEmail,
    });

    if (memberError) {
      setSubmitting(false);
      setError(memberError.message);
      return;
    }

    // register_referral_signup (migration 074) -- dipanggil SETELAH
    // business+owner selesai dibuat (butuh business_members untuk
    // menentukan business-nya sendiri dari auth.uid() di dalam RPC).
    // Gagal apa pun (kode kosong/salah/anti-abuse) diabaikan diam-diam
    // -- brief: "Kode salah TIDAK menghalangi daftar", business yang
    // baru dibuat TETAP berhasil terlepas dari hasil ini.
    if (referralCode.trim()) {
      await supabase.rpc('register_referral_signup', { p_code: referralCode.trim() });
    }
    try {
      localStorage.removeItem('sewalog_pending_referral');
    } catch {
      // tidak fatal -- cuma housekeeping, kode sudah terpakai (atau
      // dicoba) di titik ini.
    }

    setSubmitting(false);
    onCreated();
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#F1EEE2]">
      <div className="w-full max-w-sm bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-sm p-6">
        <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
          <Store className="w-5 h-5 text-[#2B4739]" />
          <span>Setup Usaha</span>
        </h2>
        <p className="text-xs text-[#6E6853] mt-1">Isi data usaha rental kamu sebelum mulai pakai Sewalog.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 mt-4">
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Nama usaha
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Nama pemilik
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            No. telepon
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Kode ajakan (opsional)
            <input
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              placeholder="Mis. WASUP7K"
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739] uppercase"
            />
            {referralChecked && referralCode.trim() && (
              <span className={referralPreviewName ? 'text-[#2B4739] font-semibold text-xs' : 'text-[#A65C2A] text-xs'}>
                {referralPreviewName ? `✓ Diajak oleh ${referralPreviewName}` : 'Kode tidak ditemukan'}
              </span>
            )}
          </label>

          {error && <p className="text-sm text-[#A8412E]">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-sm transition active:scale-95 disabled:opacity-60"
          >
            Simpan & Lanjut
          </button>
        </form>
      </div>
    </main>
  );
}
