import { Router } from 'express';
import crypto from 'node:crypto';
import { createRequestClient } from '../lib/supabaseClient.js';
import { uploadToR2 } from '../lib/r2.js';

const router = Router();

const MAX_BYTES = 5 * 1024 * 1024; // 5MB, sebelum ini biasanya sudah dikompres jadi ratusan KB di browser

router.post('/uploads/item-image', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { businessId, image } = req.body ?? {};

  if (!businessId || typeof image !== 'string') {
    res.status(400).json({ error: 'Data tidak lengkap' });
    return;
  }

  // Browser diminta hasilkan WebP, tapi Safari diam-diam substitusi PNG
  // kalau tidak didukung (bukan error) — deteksi format asli dari data
  // URL yang dikirim, jangan diasumsikan selalu WebP.
  const match = image.match(/^data:(image\/webp|image\/png|image\/jpeg);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: 'Format gambar tidak valid.' });
    return;
  }
  const [, mimeType, base64Data] = match;
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > MAX_BYTES) {
    res.status(413).json({ error: 'Ukuran gambar terlalu besar.' });
    return;
  }

  // R2 tidak punya RLS sendiri kayak Supabase Storage — jadi keanggotaan
  // business dicek manual di sini sebelum upload diizinkan, supaya user
  // tidak bisa upload ke folder businessId milik orang lain.
  const supabase = createRequestClient(req);
  const { data: membership } = await supabase
    .from('business_members')
    .select('id')
    .eq('business_id', businessId)
    .maybeSingle();

  if (!membership) {
    res.status(403).json({ error: 'Kamu bukan anggota usaha ini' });
    return;
  }

  const key = `items/${businessId}/${crypto.randomUUID()}.${extension}`;

  try {
    const url = await uploadToR2(key, buffer, mimeType);
    res.status(201).json({ url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
