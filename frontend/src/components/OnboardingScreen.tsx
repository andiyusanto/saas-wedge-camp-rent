import { useState } from 'react';
import type { FormEvent } from 'react';
import { Store } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export function OnboardingScreen({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

    setSubmitting(false);

    if (memberError) {
      setError(memberError.message);
      return;
    }

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
