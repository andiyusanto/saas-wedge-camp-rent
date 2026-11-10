// Service worker Sewalog — HANYA untuk Web Push (notifikasi Pesanan
// Online baru, v1). Lihat research/brief-notifikasi-push-2026-11.md.
//
// SENGAJA tidak ada handler `fetch` dan TIDAK ADA caching apa pun di
// file ini. CLAUDE.md bagian 4 melarang offline-first caching agresif
// untuk app ini — data stok yang sempat di-cache offline bisa
// menampilkan info basi ke vendor dan menciptakan ulang masalah
// double-booking yang justru coba diselesaikan tools ini. Service
// worker ini tidak pernah menjawab request jaringan sendiri; semua
// request tetap lewat jaringan seperti biasa.

self.addEventListener('push', (event) => {
  let payload = { title: 'Sewalog', body: 'Ada pemberitahuan baru.' };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Payload bukan JSON valid — pakai fallback di atas, jangan gagal diam-diam.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Sewalog', {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { type: payload.type ?? null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Klik notifikasi membuka tab Transaksi Aktif (bagian "Pesanan masuk")
  // — v1 hanya punya satu jenis notifikasi, jadi tujuannya selalu sama.
  const targetUrl = '/?tab=tracking';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) {
          client.postMessage({ type: 'sewalog-push-click', tab: 'tracking' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
