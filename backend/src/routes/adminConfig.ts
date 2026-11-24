import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';

const router = Router();

// GET /api/admin/config -- flag Alat Admin yang bergantung keputusan
// NON-teknis (brief admin-metrik-rental 24 Nov 2026): kolom "Nilai
// transaksi" (Rupiah) baru boleh TAMPIL ke Andi sendiri setelah
// Kebijakan Privasi versi baru terbit + rental pilot dikabari ±7 hari
// sebelumnya -- bukan soal kontrol akses antar-orang (Andi sudah
// is_app_admin, RPC admin_list_businesses sudah menghitung angkanya
// penuh terlepas dari flag ini), jadi penggerbangan ditaruh di sini
// (pola sama GET /api/pricing), BUKAN di SQL. Default mati (aman)
// kalau env belum diisi -- fitur baru hidup kalau Andi eksplisit set
// ADMIN_SHOW_TXN_VALUE=true di env backend.
router.get('/admin/config', async (req, res) => {
  const supabase = createRequestClient(req);
  const { data: isAdmin } = await supabase.rpc('is_app_admin');

  if (!isAdmin) {
    res.status(403).json({ error: 'Tidak berhak' });
    return;
  }

  res.json({ showTxnValue: process.env.ADMIN_SHOW_TXN_VALUE === 'true' });
});

export default router;
