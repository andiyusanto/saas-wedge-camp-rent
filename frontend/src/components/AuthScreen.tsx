import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { API_BASE_URL } from '../lib/api';

export function AuthScreen() {
  if (!isSupabaseConfigured) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-[#F1EEE2]">
        <div className="w-full max-w-sm bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-sm p-6">
          <Brand />
          <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg p-3 mt-4">
            Aplikasi belum terhubung ke server (konfigurasi Supabase belum diisi). Hubungi admin/developer — login
            &amp; daftar tidak bisa dipakai sampai ini diperbaiki.
          </p>
        </div>
      </main>
    );
  }

  return <AuthForm />;
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/logo.svg" alt="" width={36} height={36} />
      <h1 className="text-xl font-bold text-[#26302B]">Sewalog</h1>
    </div>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<'masuk' | 'daftar'>('masuk');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    setSubmitting(true);
    setError(null);
    setMessage(null);

    if (mode === 'masuk') {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) setError(signInError.message);
    } else {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setMessage('Akun dibuat. Kalau perlu konfirmasi email, cek inbox dulu sebelum masuk.');
      }
    }

    setSubmitting(false);
  }

  async function handleResetDemo() {
    setResettingDemo(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/reset`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Gagal reset (HTTP ${res.status})`);

      setEmail(body.ownerEmail);
      setPassword(body.password);
      setMode('masuk');
      setMessage('Data demo direset. Tekan Masuk untuk lihat.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResettingDemo(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#F1EEE2]">
      <div className="w-full max-w-sm bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-sm p-6">
        <Brand />

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 mt-5">
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>

          {error && <p className="text-sm text-[#A8412E]">{error}</p>}
          {message && <p className="text-sm text-[#2B4739]">{message}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-sm transition active:scale-95 disabled:opacity-60"
          >
            {mode === 'masuk' ? 'Masuk' : 'Daftar'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === 'masuk' ? 'daftar' : 'masuk')}
          className="mt-4 text-xs text-[#6E6853] underline hover:text-[#26302B] transition"
        >
          {mode === 'masuk' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
        </button>

        <button
          type="button"
          onClick={handleResetDemo}
          disabled={resettingDemo}
          className="mt-2 block text-xs text-[#A65C2A] underline hover:text-[#8A4A20] transition disabled:opacity-60"
        >
          {resettingDemo ? 'Mereset data demo...' : 'Lagi demo ke calon vendor? Reset data demo'}
        </button>
      </div>
    </main>
  );
}
