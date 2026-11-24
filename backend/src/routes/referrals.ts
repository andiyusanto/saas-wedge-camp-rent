import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createAnonClient } from '../lib/supabaseClient.js';

const router = Router();

// Review koordinator 24 Nov 2026 (brief Ajak Rental Lain): validate_referral_code
// TIDAK digrant ke anon sama sekali -- kalau digrant, siapa pun bisa
// memanggil RPC-nya langsung lewat REST dengan publishable key, melewati
// rate limit Express sepenuhnya, dan kode berbasis nama+3 karakter acak
// cukup mudah ditebak massal. Jalur SATU-SATUNYA: endpoint ini, lewat
// createAnonClient() + secret (pola SAMA create_booking_request,
// migration 037/065 -- REUSE secret yang sama, BOOKING_REQUEST_SECRET,
// bukan secret/env baru) + rate limit per-IP di bawah.
const perIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan dari koneksi ini, coba lagi dalam 1 jam.' },
});

// GET /api/public/referral-codes/:code -- dipanggil dari form daftar
// (OnboardingScreen.tsx/AuthScreen.tsx), SEBELUM atau SESUDAH login
// (endpoint publik, tidak butuh auth sama sekali -- sengaja, supaya
// bisa divalidasi begitu kode terisi dari link `?ref=`, bahkan sebelum
// akun dibuat). Cuma mengembalikan NAMA rental pengajak -- validasi
// "kode salah TIDAK menghalangi daftar" (brief) ditegakkan di sini:
// kode tidak ditemukan -> 200 {name: null}, BUKAN 404 (404 bisa
// terkesan seperti error ke frontend, padahal ini keadaan NORMAL/valid
// -- banyak pendaftar tidak pakai kode ajakan sama sekali).
router.get('/public/referral-codes/:code', perIpLimiter, async (req, res) => {
  const { code } = req.params;
  const secret = process.env.BOOKING_REQUEST_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Konfigurasi server belum lengkap' });
    return;
  }
  if (!code || code.length > 20) {
    res.json({ name: null });
    return;
  }

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc('validate_referral_code', { p_code: code, p_secret: secret });

  if (error) {
    res.status(500).json({ error: 'Gagal memeriksa kode ajakan' });
    return;
  }

  res.json({ name: data ?? null });
});

export default router;
