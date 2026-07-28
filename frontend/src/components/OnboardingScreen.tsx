import { useState } from 'react';
import type { FormEvent } from 'react';
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

    if (!ownerId) {
      setError('Sesi login tidak ditemukan, coba login ulang.');
      setSubmitting(false);
      return;
    }

    const { error: insertError } = await supabase.from('businesses').insert({
      owner_id: ownerId,
      name,
      owner_name: ownerName || null,
      phone: phone || null,
    });

    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    onCreated();
  }

  return (
    <main className="app-shell">
      <h2>Setup usaha</h2>
      <p className="app-shell__subtitle">Isi data usaha rental kamu sebelum mulai pakai Sewalog.</p>

      <form onSubmit={handleSubmit} className="form">
        <label>
          Nama usaha
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Nama pemilik
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
        </label>
        <label>
          No. telepon
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={submitting}>
          Simpan & lanjut
        </button>
      </form>
    </main>
  );
}
