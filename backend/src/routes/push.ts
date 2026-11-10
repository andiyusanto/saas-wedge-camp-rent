import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { getVapidPublicKey, buildNewOrderPayload } from '../lib/webPush.js';
import * as webpush from 'web-push';

const router = Router();

// Publik (tanpa auth) -- frontend cek ini sebelum menampilkan tombol
// "Aktifkan notifikasi" sama sekali. null = env VAPID belum diisi,
// fitur mati dengan aman (research/brief-notifikasi-push-2026-11.md #6).
router.get('/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.post('/push/subscribe', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { business_id, endpoint, p256dh, auth: authKey, user_agent } = req.body ?? {};
  if (
    typeof business_id !== 'string' ||
    typeof endpoint !== 'string' ||
    typeof p256dh !== 'string' ||
    typeof authKey !== 'string'
  ) {
    res.status(400).json({ error: 'Data subscription tidak lengkap' });
    return;
  }

  const supabase = createRequestClient(req);
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  // Endpoint unique -- browser bisa kirim subscription baru kalau yang
  // lama kedaluwarsa, jadi hapus dulu baris lama milik user ini (kalau
  // ada) sebelum insert yang baru, daripada upsert on-conflict lewat RLS.
  await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);

  const { error } = await supabase.from('push_subscriptions').insert({
    business_id,
    user_id: userId,
    endpoint,
    p256dh,
    auth: authKey,
    user_agent: typeof user_agent === 'string' ? user_agent.slice(0, 300) : null,
  });

  if (error) {
    console.error('push/subscribe gagal:', error.message);
    res.status(400).json({ error: 'Gagal menyimpan subscription' });
    return;
  }

  res.status(201).json({ ok: true });
});

router.post('/push/unsubscribe', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== 'string') {
    res.status(400).json({ error: 'endpoint wajib diisi' });
    return;
  }

  const supabase = createRequestClient(req);
  // RLS (user_id = auth.uid()) sudah membatasi ini ke baris milik
  // pemanggil sendiri -- tidak perlu filter user_id manual lagi.
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);

  if (error) {
    console.error('push/unsubscribe gagal:', error.message);
    res.status(400).json({ error: 'Gagal menghapus subscription' });
    return;
  }

  res.status(200).json({ ok: true });
});

// Tombol "Kirim notifikasi uji" -- kirim ke SEMUA perangkat milik
// pemanggil sendiri saja (bukan seluruh business), supaya tidak mengejutkan
// anggota lain dengan notifikasi palsu.
router.post('/push/test-send', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  if (!getVapidPublicKey()) {
    res.status(400).json({ error: 'Notifikasi push belum diaktifkan di server ini' });
    return;
  }

  const supabase = createRequestClient(req);
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error || !subs || subs.length === 0) {
    res.status(404).json({ error: 'Belum ada perangkat yang mengaktifkan notifikasi' });
    return;
  }

  const payload = buildNewOrderPayload({
    customerName: 'Pelanggan Contoh',
    itemCount: 1,
    startDate: '2026-01-01',
    endDate: '2026-01-02',
  });
  const testPayload = { ...payload, title: 'Notifikasi uji', body: 'Kalau ini muncul, notifikasi di perangkat ini sudah aktif.' };

  let delivered = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(testPayload),
        );
        delivered += 1;
      } catch (sendError: any) {
        console.error('push/test-send gagal ke satu perangkat:', sendError?.statusCode, sendError?.message);
      }
    }),
  );

  if (delivered === 0) {
    res.status(502).json({ error: 'Gagal mengirim ke semua perangkat terdaftar' });
    return;
  }

  res.json({ ok: true, delivered });
});

export default router;
