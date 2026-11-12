import * as webpush from 'web-push';

// Notifikasi push: Pesanan Online baru (v1) -- research/brief-notifikasi-push-2026-11.md.
// Kalau env VAPID belum diisi, fitur ini mati dengan aman di SELURUH titik
// (tombol UI tidak muncul karena /api/push/vapid-public-key balikin null,
// dan sendPushToBusiness() di bawah langsung no-op) -- tidak pernah throw.

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? '';

export const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);

if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey(): string | null {
  return PUSH_ENABLED ? VAPID_PUBLIC_KEY : null;
}

export type NewOrderPushPayload = {
  type: 'new_booking_request';
  title: string;
  body: string;
};

// "{nama pelanggan} · {n} alat · {dd-mm} → {dd-mm}" -- SENGAJA tanpa nomor
// WA, harga, atau alamat (bisa terbaca di layar kunci). dd-mm dirakit
// manual, bukan Intl/toLocaleDateString (CLAUDE.md bagian 4 & konvensi
// format tanggal app ini).
function ddmm(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}-${m}`;
}

// Diekstrak sebagai fungsi murni supaya testable tanpa perlu mock
// web-push/supabase — 404/410 artinya browser sudah mencabut subscription
// ini secara permanen (device uninstall app, browser data dibersihkan,
// dsb), jadi baris subscription dihapus. Kode status lain (timeout,
// 5xx sementara, dsb) dibiarkan apa adanya, tidak dihapus.
export function shouldRemoveSubscription(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

export function buildNewOrderPayload(params: {
  customerName: string;
  itemCount: number;
  startDate: string;
  endDate: string;
}): NewOrderPushPayload {
  return {
    type: 'new_booking_request',
    title: 'Pesanan baru dari Etalase Online',
    body: `${params.customerName} · ${params.itemCount} alat · ${ddmm(params.startDate)} → ${ddmm(params.endDate)}`,
  };
}

// Dipanggil dari jalur publik anonim (POST /public/booking-requests/:slug)
// SETELAH create_booking_request sukses. Best-effort dan TIDAK BOLEH
// menghalangi/menunda respons ke pelanggan -- caller tidak pernah await
// ini sebelum membalas, dan setiap kegagalan di sini cuma di-log.
export async function sendPushToBusiness(businessId: string, secret: string, payload: NewOrderPushPayload): Promise<void> {
  if (!PUSH_ENABLED) return;

  try {
    // Import dinamis -- supabaseClient.ts melempar error di top-level
    // kalau env SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY belum diisi (dicek
    // saat module di-load), yang akan merusak impor statis file ini di
    // unit test (webPush.test.ts) yang cuma butuh buildNewOrderPayload/
    // shouldRemoveSubscription dan sengaja tidak mengisi env Supabase.
    const { createAnonClient } = await import('./supabaseClient.js');
    const supabase = createAnonClient();
    const { data: subs, error } = await supabase.rpc('get_push_subscriptions_for_business', {
      p_secret: secret,
      p_business_id: businessId,
    });

    if (error) {
      // Review -c1 (migration 057): sebelumnya error RPC ditelan diam-diam
      // di sini, sampai bikin bug nyata (grant execute anon kelupaan di
      // migration 056) tidak kelihatan sama sekali di log Render -- tes
      // regresi tetap terlihat lolos karena pesanan pelanggan tetap
      // sukses walau push-nya diam-diam tidak pernah terkirim.
      console.error('sendPushToBusiness: get_push_subscriptions_for_business gagal', error.message);
      return;
    }
    if (!subs || subs.length === 0) return;

    await Promise.all(
      subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
          await supabase.rpc('record_push_result', { p_secret: secret, p_subscription_id: sub.id, p_success: true });
        } catch (sendError: any) {
          const statusCode = sendError?.statusCode;
          if (shouldRemoveSubscription(statusCode)) {
            await supabase.rpc('record_push_result', { p_secret: secret, p_subscription_id: sub.id, p_success: false });
          } else {
            console.error('sendPushToBusiness: kirim gagal (bukan 404/410)', statusCode, sendError?.message);
          }
        }
      }),
    );
  } catch (outerError) {
    console.error('sendPushToBusiness: gagal diam-diam', outerError);
  }
}
