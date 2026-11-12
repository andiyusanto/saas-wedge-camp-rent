import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { clearActiveTab } from '../lib/tabStorage';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      // Supabase mendaratkan user di sini dengan sesi sementara setelah
      // klik link reset password di email (bukan login normal) — App.tsx
      // pakai flag ini buat menyela ke layar "Buat Password Baru" alih-alih
      // langsung masuk ke app dengan sesi itu.
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }
      // Tab terakhir (lib/tabStorage.ts) sengaja TIDAK ikut ke sesi login
      // berikutnya di device yang sama (mis. owner lupa logout, staf lain
      // login) -- login ulang selalu mulai dari Kalender.
      if (event === 'SIGNED_OUT') {
        clearActiveTab();
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return {
    session,
    loading,
    isPasswordRecovery,
    clearPasswordRecovery: () => setIsPasswordRecovery(false),
  };
}
