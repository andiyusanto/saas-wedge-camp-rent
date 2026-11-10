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

  const enable = useCallback(async () => {
    setError(null);
    if (!supported || !vapidPublicKey) {
      setError('Notifikasi push tidak tersedia di perangkat/browser ini.');
      return;
    }

    try {
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);
      if (permissionResult !== 'granted') {
        setError('Izin notifikasi ditolak. Buka pengaturan browser untuk mengizinkan notifikasi dari situs ini.');
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
    }
  }, [session, businessId, supported, vapidPublicKey]);

  const disable = useCallback(async () => {
    setError(null);
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
    enable,
    disable,
    testSending,
    testResult,
    sendTest,
  };
}
