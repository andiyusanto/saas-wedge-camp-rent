import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { apiFetch, API_BASE_URL } from '../lib/api';

// Notifikasi push: Pesanan Online baru (v1) — research/brief-notifikasi-push-2026-11.md.
// Kartu UI-nya di TrackingScreen.tsx dekat "Pesanan masuk".

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64Safe);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

function isIosSafariNonStandalone(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  // iOS Chrome/Firefox dsb juga memakai WebKit, tapi "Safari" di UA tetap
  // ada di semua browser iOS (semua jalan di atas WebKit) — cek standalone
  // mode saja sudah cukup bedakan "sudah di-Add to Home Screen" atau belum.
  const isStandalone = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return isIos && !isStandalone;
}

export function usePushNotifications(session: Session, businessId: string) {
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  // "Coba Lagi" diklik tapi izin TETAP 'denied' setelah requestPermission()
  // (browser tidak menampilkan dialog lagi begitu pernah ditolak, jadi
  // requestPermission() langsung resolve 'denied' lagi) -- sebelumnya tidak
  // ada umpan balik SAMA SEKALI di kasus ini (setError() sengaja di-skip
  // untuk 'denied', lihat komentar di enable() di bawah), bikin tombol
  // kelihatan tidak bereaksi. Dilaporkan Andi dari HP Android, 12 Nov 2026.
  const [retryStillBlocked, setRetryStillBlocked] = useState(false);
  // Status loading terpisah untuk tombol Aktifkan/Coba Lagi/Matikan --
  // dilaporkan Andi dari HP 12 Nov 2026: ada jeda beberapa detik di HP
  // (requestPermission -> pushManager.subscribe -> simpan ke server) tanpa
  // umpan balik apa pun, jadi kelihatan tidak bereaksi/bisa diklik dobel.
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const supported =
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iosNeedsHomeScreen = isIosSafariNonStandalone();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/push/vapid-public-key`);
        const body = await res.json();
        if (!cancelled) setVapidPublicKey(body.publicKey ?? null);
      } catch {
        if (!cancelled) setVapidPublicKey(null);
      }

      if (!supported) {
        if (!cancelled) {
          setPermission('unsupported');
          setLoading(false);
        }
        return;
      }

      setPermission(Notification.permission);

      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(Boolean(existing));
      } catch (err) {
        console.error('usePushNotifications: gagal registrasi service worker', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // supported dihitung sekali dari fitur browser, tidak berubah antar-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bonus brief 12 Nov 2026: deteksi otomatis begitu pengguna kembali dari
  // Pengaturan HP/browser (mis. baru saja mengizinkan notifikasi di sana),
  // tanpa perlu klik "Coba Lagi" lagi -- CUMA memperbarui status `permission`
  // (tombol balik jadi "Aktifkan" kalau sudah granted), TIDAK PERNAH
  // subscribe otomatis -- subscribe tetap wajib lewat klik pengguna sendiri
  // (koreksi review koordinator 12 Nov 2026).
  useEffect(() => {
    if (!supported) return;
    function syncPermission() {
      if (document.visibilityState !== 'visible') return;
      const current = Notification.permission;
      setPermission((prev) => (prev === current ? prev : current));
      if (current !== 'denied') setRetryStillBlocked(false);
    }
    document.addEventListener('visibilitychange', syncPermission);
    return () => document.removeEventListener('visibilitychange', syncPermission);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  const enable = useCallback(async () => {
    setError(null);
    setRetryStillBlocked(false);
    if (!supported || !vapidPublicKey) {
      setError('Notifikasi push tidak tersedia di perangkat/browser ini.');
      return;
    }

    setEnabling(true);
    try {
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);
      if (permissionResult !== 'granted') {
        // Pesan untuk permission 'denied' sudah ditampilkan terpisah di
        // TrackingScreen.tsx lewat push.permission === 'denied' — set error di sini
        // dulu bikin dua pesan nyaris identik muncul bareng (ditemukan via screenshot 2026-11-11).
        if (permissionResult !== 'denied') {
          setError('Izin notifikasi tidak diberikan. Coba lagi untuk mengaktifkan notifikasi.');
        } else {
          // "Coba Lagi" diklik tapi browser TIDAK menampilkan dialog lagi
          // (sudah pernah ditolak) -- requestPermission() cuma resolve
          // 'denied' lagi tanpa ada yang berubah, jadi tanpa ini klik
          // kelihatan tidak bereaksi sama sekali. Pesan statis di
          // TrackingScreen.tsx (push.permission==='denied') TIDAK berubah
          // teksnya di sini, cuma ditambah satu baris transient supaya klik
          // tetap terasa "melakukan sesuatu".
          setRetryStillBlocked(true);
        }
        return;
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
      const subJson = sub.toJSON();

      await apiFetch(session, '/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          business_id: businessId,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
          user_agent: navigator.userAgent,
        }),
      });
      setSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengaktifkan notifikasi');
    } finally {
      setEnabling(false);
    }
  }, [session, businessId, supported, vapidPublicKey]);

  const disable = useCallback(async () => {
    setError(null);
    setDisabling(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await apiFetch(session, '/api/push/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menonaktifkan notifikasi');
    } finally {
      setDisabling(false);
    }
  }, [session]);

  const sendTest = useCallback(async () => {
    setTestSending(true);
    setTestResult(null);
    try {
      await apiFetch(session, '/api/push/test-send', { method: 'POST' });
      setTestResult('Notifikasi uji dikirim — cek perangkat ini.');
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Gagal mengirim notifikasi uji');
    } finally {
      setTestSending(false);
    }
  }, [session]);

  return {
    featureAvailable: Boolean(vapidPublicKey),
    supported,
    iosNeedsHomeScreen,
    permission,
    subscribed,
    loading,
    error,
    retryStillBlocked,
    enabling,
    disabling,
    enable,
    disable,
    testSending,
    testResult,
    sendTest,
  };
}
