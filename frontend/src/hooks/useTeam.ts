import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

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

async function authedFetch(session: Session, path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export function useTeam(session: Session | null, businessId: string | undefined) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [membersBody, invitesBody] = await Promise.all([
        authedFetch(session, '/api/team/members'),
        authedFetch(session, '/api/team/invites'),
      ]);
      setMembers(membersBody.members);
      setInvites(invitesBody.invites);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function createInvite(role: 'owner' | 'karyawan') {
    if (!session || !businessId) return { error: 'Belum ada usaha' };
    try {
      await authedFetch(session, '/api/team/invites', {
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
      await authedFetch(session, `/api/team/invites/${id}`, { method: 'DELETE' });
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async function removeMember(id: string) {
    if (!session) return { error: 'Belum login' };
    try {
      await authedFetch(session, `/api/team/members/${id}`, { method: 'DELETE' });
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  return { members, invites, loading, error, refresh, createInvite, revokeInvite, removeMember };
}
