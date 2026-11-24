import { Router } from 'express';
import { createRequestClient } from '../lib/supabaseClient.js';
import { PRICING, pricingAnnounced } from '../lib/pricingConfig.js';

const router = Router();

// GET /api/pricing -- satu-satunya jalur frontend mengambil ANGKA
// RUPIAH harga langganan (brief 24 Nov 2026, review koordinator: angka
// harga TIDAK BOLEH ada di bundle JS publik sama sekali sebelum embargo
// PRICING_ANNOUNCE_AT_ISO -- bundle itu dimuat bahkan di layar login,
// jadi siapa pun bisa membacanya lewat DevTools/view-source kalau
// angkanya ikut jadi konstanta frontend). Butuh login (createRequestClient,
// bukan createAnonClient) -- endpoint ini bukan untuk pengunjung publik,
// cukup authenticated biasa, TIDAK perlu owner/karyawan tertentu (harga
// sama untuk semua role, cuma ditampilkan ke yang sudah login).
//
// Admin (is_app_admin) SELALU menerima angka, terlepas dari embargo --
// Alat Admin (AdminPaymentModal.tsx) butuh saran nominal kapan pun untuk
// mencatat pembayaran manual, keputusan koordinator eksplisit.
router.get('/pricing', async (req, res) => {
  const supabase = createRequestClient(req);
  const { data: isAdmin } = await supabase.rpc('is_app_admin');

  const announced = pricingAnnounced();
  if (!announced && !isAdmin) {
    res.json({ announced: false, pricing: null });
    return;
  }

  res.json({ announced, pricing: PRICING });
});

export default router;
