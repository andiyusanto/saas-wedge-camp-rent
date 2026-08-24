import { Router } from 'express';
import crypto from 'node:crypto';
import { createRequestClient } from '../lib/supabaseClient.js';
import { uploadToR2 } from '../lib/r2.js';

const router = Router();

const MAX_BYTES = 5 * 1024 * 1024; // 5MB, sebelum ini biasanya sudah dikompres jadi ratusan KB di browser

// Browser diminta hasilkan WebP, tapi Safari diam-diam substitusi PNG kalau
// tidak didukung (bukan error) — deteksi format asli dari data URL yang
// dikirim, jangan diasumsikan selalu WebP.
function decodeImageDataUrl(image: unknown): { buffer: Buffer; mimeType: string; extension: string } {
  if (typeof image !== 'string') {
    throw new Error('Data tidak lengkap');
  }
  const match = image.match(/^data:(image\/webp|image\/png|image\/jpeg);base64,(.+)$/);
  if (!match) {
    throw new Error('Format gambar tidak valid.');
  }
  const [, mimeType, base64Data] = match;
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > MAX_BYTES) {
    throw new Error('Ukuran gambar terlalu besar.');
  }
  return { buffer, mimeType, extension };
}

async function requireMembership(req: Parameters<typeof createRequestClient>[0], businessId: string) {
  const supabase = createRequestClient(req);
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return false;

  // business_members punya satu baris per anggota (owner + tiap karyawan)
  // untuk business_id yang sama — tanpa filter user_id, .maybeSingle() di
  // bawah ini akan error begitu ada 2+ anggota (>1 baris cocok).
  const { data: membership } = await supabase
    .from('business_members')
    .select('id')
    .eq('business_id', businessId)
    .eq('user_id', userData.user.id)
    .maybeSingle();
  return Boolean(membership);
}

router.post('/uploads/item-image', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { businessId, image } = req.body ?? {};
  if (!businessId) {
    res.status(400).json({ error: 'Data tidak lengkap' });
    return;
  }

  let decoded;
  try {
    decoded = decodeImageDataUrl(image);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  // R2 tidak punya RLS sendiri kayak Supabase Storage — jadi keanggotaan
  // business dicek manual di sini sebelum upload diizinkan, supaya user
  // tidak bisa upload ke folder businessId milik orang lain.
  if (!(await requireMembership(req, businessId))) {
    res.status(403).json({ error: 'Kamu bukan anggota usaha ini' });
    return;
  }

  const key = `items/${businessId}/${crypto.randomUUID()}.${decoded.extension}`;

  try {
    const url = await uploadToR2(key, decoded.buffer, decoded.mimeType);
    res.status(201).json({ url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Foto penyewa (opsional) diambil saat Catat Transaksi — bukti visual
// siapa yang mengambil barang, terpisah dari foto KTP/dokumen jaminan
// (sengaja tidak menyimpan foto dokumen identitas, lihat diskusi produk:
// foto orang lebih rendah risiko privasi/UU PDP dibanding scan KTP/NIK).
router.post('/uploads/customer-photo', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { businessId, image } = req.body ?? {};
  if (!businessId) {
    res.status(400).json({ error: 'Data tidak lengkap' });
    return;
  }

  let decoded;
  try {
    decoded = decodeImageDataUrl(image);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  if (!(await requireMembership(req, businessId))) {
    res.status(403).json({ error: 'Kamu bukan anggota usaha ini' });
    return;
  }

  const key = `customers/${businessId}/${crypto.randomUUID()}.${decoded.extension}`;

  try {
    const url = await uploadToR2(key, decoded.buffer, decoded.mimeType);
    res.status(201).json({ url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
