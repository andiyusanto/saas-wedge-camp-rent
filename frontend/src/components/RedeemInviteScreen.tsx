import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';

export function RedeemInviteScreen({
  session,
  code,
  onJoined,
  onSkip,
}: {
  session: Session;
  code: string;
  onJoined: () => void;
  onSkip: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#F1EEE2]">
      <div className="w-full max-w-sm bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-sm p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[#E8EFEA] text-[#2B4739] flex items-center justify-center mx-auto mb-3">
          <UserPlus className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#26302B]">Undangan Bergabung</h2>
        <p className="text-xs text-[#6E6853] mt-1">
          Kamu login sebagai <strong>{session.user.email}</strong>. Gabung ke usaha yang mengundang kamu?
        </p>

        {error && <p className="text-sm text-[#A8412E] mt-3">{error}</p>}

        <button
          onClick={handleJoin}
          disabled={submitting}
          className="w-full mt-4 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-sm transition active:scale-95 disabled:opacity-60"
        >
          {submitting ? 'Bergabung...' : 'Gabung Sekarang'}
        </button>
        <button
          onClick={onSkip}
          className="w-full mt-2 px-4 py-2 text-xs text-[#6E6853] underline hover:text-[#26302B] transition"
        >
          Lewati, saya mau bikin usaha sendiri
        </button>
      </div>
    </main>
  );
}
