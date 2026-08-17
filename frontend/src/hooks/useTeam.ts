import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { apiFetch } from '../lib/api';

export type TeamMember = {
  id: string;
  user_id: string;
  role: 'owner' | 'karyawan';
  email: string;
  created_at: string;
};

export type TeamInvite = {
  id: string;
  code: string;
  role: 'owner' | 'karyawan';
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export function useTeam(session: Session | null, businessId: string | undefined) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session || !businessId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // allSettled, bukan all — GET /team/invites sengaja owner-only (lihat
    // migration 014), tapi GET /team/members dipakai juga di luar layar
    // Kelola Karyawan (baris "diperbarui oleh X" di Katalog & Stok Alat).
    // Karyawan yang memanggil ini dari ItemsScreen harus tetap dapat daftar
    // anggota walau invites-nya 403.
    const [membersResult, invitesResult] = await Promise.allSettled([
      apiFetch<{ members: TeamMember[] }>(session, `/api/team/members?businessId=${businessId}`),
      apiFetch<{ invites: TeamInvite[] }>(session, `/api/team/invites?businessId=${businessId}`),
    ]);

    if (membersResult.status === 'fulfilled') {
      setMembers(membersResult.value.members);
    } else {
      setError(membersResult.reason.message);
    }

    // Gagal ambil invites (mis. bukan owner) bukan error fatal — cukup
    // kosongkan, TeamScreen sendiri sudah disembunyikan dari karyawan lewat
    // Navbar/App.tsx.
    setInvites(invitesResult.status === 'fulfilled' ? invitesResult.value.invites : []);

    setLoading(false);
  }, [session, businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function createInvite(role: 'owner' | 'karyawan') {
    if (!session || !businessId) return { error: 'Belum ada usaha' };
    try {
      await apiFetch(session, '/api/team/invites', {
        method: 'POST',
        body: JSON.stringify({ businessId, role }),
      });
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async function revokeInvite(id: string) {
    if (!session) return { error: 'Belum login' };
    try {
      await apiFetch(session, `/api/team/invites/${id}`, { method: 'DELETE' });
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async function removeMember(id: string) {
    if (!session) return { error: 'Belum login' };
    try {
      await apiFetch(session, `/api/team/members/${id}`, { method: 'DELETE' });
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  return { members, invites, loading, error, refresh, createInvite, revokeInvite, removeMember };
}
