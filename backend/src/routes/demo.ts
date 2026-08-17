import { Router } from 'express';
import { resetDemoData } from '../lib/demoReset.js';

const router = Router();

const RESET_COOLDOWN_MS = 60_000;
let lastResetAt = 0;

// Endpoint publik SENGAJA tanpa autentikasi — dipicu dari tombol di layar
// login, dipakai oleh orang yang lagi demo ke calon vendor (biasanya bukan
// developer, tidak punya akses terminal buat `npm run seed:demo`). Aman
// karena resetDemoData() SELALU beroperasi cuma di satu business demo yang
// dikunci lewat kredensial di lib/demoReset.ts — endpoint ini tidak pernah
// menerima business_id atau kredensial apa pun dari request. Cooldown di
// bawah cuma jaring pengaman terakhir supaya tidak bisa dispam.
router.post('/demo/reset', async (_req, res) => {
  const now = Date.now();
  const elapsed = now - lastResetAt;
  if (elapsed < RESET_COOLDOWN_MS) {
    res.status(429).json({ error: `Baru saja direset, coba lagi ${Math.ceil((RESET_COOLDOWN_MS - elapsed) / 1000)} detik lagi.` });
    return;
  }
  lastResetAt = now;

  try {
    const result = await resetDemoData();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
