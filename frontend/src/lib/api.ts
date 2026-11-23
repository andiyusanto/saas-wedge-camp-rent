import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

// Satu titik masuk buat semua panggilan ke backend Express — dulu tiap
// komponen/hook nulis ulang fetch+Authorization+parse-error sendiri-sendiri
// (7 salinan `const API_BASE_URL = ...` tersebar). Melempar Error di sini
// (bukan return {error}) supaya caller bisa pilih try/catch atau biarkan
// React Query-style hook yang menangkapnya — cocok untuk kedua gaya yang
// dipakai di codebase ini.
//
// Bug "Gagal memuat: JWT expired" (laporan Andi 24 Nov 2026, screenshot HP
// akun demo) -- akar masalahnya `session.access_token` dari PARAMETER ini
// dulu dipakai langsung sebagai token, padahal itu snapshot state React
// yang bisa basi: di HP/PWA yang lama di background (>1 jam), timer
// auto-refresh supabase-js berhenti (dibahas lagi di bawah), dan begitu
// app dibuka lagi komponen langsung fetch dengan token lama SEBELUM
// refresh sempat jalan. Parameter `session` DIBIARKAN ada demi
// kompatibilitas seluruh caller (banyak sekali, mengubah signature-nya
// berisiko regresi luas untuk perbaikan yang sebenarnya tidak perlu itu),
// tapi TIDAK PERNAH lagi dipakai untuk token -- selalu `getSession()` yang
// SELALU memberi access_token segar (supabase-js me-refresh sendiri kalau
// kedaluwarsa, lihat komentar resmi di GoTrueClient.getSession()).
export async function apiFetch<T = unknown>(session: Session, path: string, init?: RequestInit): Promise<T> {
  async function doFetch(token: string) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  const { data: sessionData } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  let token = sessionData.session?.access_token ?? session.access_token;
  let { res, body } = await doFetch(token);

  // 401 / "JWT expired" bisa tetap lolos dari getSession() di atas kalau
  // token sempat ditolak backend TEPAT di jendela sebelum refresh otomatis
  // selesai (race, bukan cuma skenario "lama di background") -- refresh
  // SEKALI secara eksplisit lalu ulang permintaan, baru menyerah.
  const looksExpired = res.status === 401 || /jwt expired/i.test(String(body?.error ?? ''));
  if (looksExpired && supabase) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session?.access_token) {
      token = refreshed.session.access_token;
      ({ res, body } = await doFetch(token));
    }
  }

  if (!res.ok) {
    const stillExpired = res.status === 401 || /jwt expired/i.test(String(body?.error ?? ''));
    if (stillExpired) {
      // Refresh gagal juga -- sesi sungguhan sudah tidak valid (refresh
      // token ikut kedaluwarsa/dicabut). signOut() memicu onAuthStateChange
      // di App.tsx, yang sudah menampilkan AuthScreen (tombol masuk) begitu
      // session jadi null -- tidak perlu UI baru di sini.
      await supabase?.auth.signOut();
      throw new Error('Sesi berakhir, silakan masuk lagi.');
    }
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}
