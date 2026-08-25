import { useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    if (password !== confirmPassword) {
      setError('Password dan konfirmasi tidak sama.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    onDone();
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#F1EEE2]">
      <div className="w-full max-w-sm bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-sm p-6">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="" width={36} height={36} />
          <h1 className="text-xl font-bold text-[#26302B]">Sewalog</h1>
        </div>

        <h2 className="text-sm font-bold text-[#26302B] mt-4 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[#2B4739]" />
          Buat Password Baru
        </h2>
        <p className="text-xs text-[#6E6853] mt-1">
          Masukkan password baru untuk akun Sewalog kamu, lalu langsung masuk memakainya.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 mt-4">
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Password baru
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              autoFocus
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Ulangi password baru
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={6}
              required
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>

          {error && <p className="text-sm text-[#A8412E]">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-sm transition active:scale-95 disabled:opacity-60"
          >
            {submitting ? 'Menyimpan...' : 'Simpan Password Baru'}
          </button>
        </form>
      </div>
    </main>
  );
}
