import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { API_BASE_URL } from '../lib/api';

const ROLE_LABEL: Record<'owner' | 'karyawan', string> = {
  owner: 'Pemilik (co-owner)',
  karyawan: 'Karyawan',
};

// Direvisi 2 Nov 2026 (review -c1) — SEBELUMNYA layar ini cuma tampil
// kalau akun belum punya business sama sekali, dan tombolnya generik
// ("Gabung Sekarang"/"Lewati") tanpa pernah bilang usaha mana atau
// sebagai apa. Sekarang WAJIB tampil kapan pun ada kode undangan
// tersimpan (lihat App.tsx — termasuk kalau akun ini SUDAH punya
// business sendiri, mis. device gantian dan kode punya sesi lain masih
// nyangkut di localStorage) — supaya TIDAK PERNAH diam-diam di-redeem
// atau diam-diam diabaikan. Harus eksplisit tampilkan nama usaha +
// peran, dan "Bukan saya" sekarang WAJIB ada (bukan cuma "lewati bikin
// usaha sendiri") karena ini bisa jadi kode milik ORANG LAIN, bukan
// sekadar pilihan "saya mau usaha sendiri".
export function InviteConfirmScreen({
  session,
  code,
  onJoined,
  onDismiss,
}: {
  session: Session;
  code: string;
  onJoined: () => void;
  onDismiss: () => void;
}) {
  const [preview, setPreview] = useState<{ businessName: string; role: 'owner' | 'karyawan' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/team/invites/preview?code=${encodeURIComponent(code)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        if (body) {
          setPreview({ businessName: body.businessName, role: body.role });
        } else {
          // Kode sudah tidak berlaku (kedaluwarsa/sudah dipakai/salah) —
          // tidak ada apa pun untuk dikonfirmasi, langsung bersihkan dan
          // lanjut seperti biasa (bukan ditampilkan sebagai error blocking).
          setNotFound(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (notFound) onDismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notFound]);

  async function handleJoin() {
    setSubmitting(true);
    setError(null);

    try {
      await apiFetch(session, '/api/team/invites/redeem', { method: 'POST', body: JSON.stringify({ code }) });
    } catch (err) {
      setSubmitting(false);
      setError((err as Error).message);
      return;
    }
    setSubmitting(false);
    onJoined();
  }

  if (loading || notFound) return null;

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#F1EEE2]">
      <div className="w-full max-w-sm bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-sm p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[#E8EFEA] text-[#2B4739] flex items-center justify-center mx-auto mb-3">
          <UserPlus className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#26302B]">Undangan Bergabung</h2>
        <p className="text-xs text-[#6E6853] mt-1">
          Login sebagai <strong>{session.user.email}</strong>.
        </p>
        <p className="text-sm text-[#26302B] mt-3">
          Gabung ke <strong>{preview?.businessName}</strong> sebagai{' '}
          <strong>{preview ? ROLE_LABEL[preview.role] : ''}</strong>?
        </p>

        {error && <p className="text-sm text-[#A8412E] mt-3">{error}</p>}

        <button
          onClick={handleJoin}
          disabled={submitting}
          className="w-full mt-4 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-sm transition active:scale-95 disabled:opacity-60"
        >
          {submitting ? 'Bergabung...' : 'Gabung'}
        </button>
        <button
          onClick={onDismiss}
          disabled={submitting}
          className="w-full mt-2 px-4 py-2 text-xs text-[#6E6853] underline hover:text-[#26302B] transition disabled:opacity-60"
        >
          Bukan saya
        </button>
      </div>
    </main>
  );
}
