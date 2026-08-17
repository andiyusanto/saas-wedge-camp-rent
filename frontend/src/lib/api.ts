import type { Session } from '@supabase/supabase-js';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

// Satu titik masuk buat semua panggilan ke backend Express — dulu tiap
// komponen/hook nulis ulang fetch+Authorization+parse-error sendiri-sendiri
// (7 salinan `const API_BASE_URL = ...` tersebar). Melempar Error di sini
// (bukan return {error}) supaya caller bisa pilih try/catch atau biarkan
// React Query-style hook yang menangkapnya — cocok untuk kedua gaya yang
// dipakai di codebase ini.
export async function apiFetch<T = unknown>(session: Session, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}
