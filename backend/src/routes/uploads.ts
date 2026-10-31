import { Router } from 'express';
import crypto from 'node:crypto';
import sharp from 'sharp';
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

// Logo usaha (migration 035) secara produk owner-only (bagian Info Usaha
// di Kelola Usaha, sama seperti field lain di sana — lihat migration 018
// "owner_update_own_business"). Dicek eksplisit di sini juga, bukan cuma
// mengandalkan RLS di langkah SIMPAN-nya nanti (supabase-js dari
// useBusiness.ts) — R2 tidak punya RLS sendiri, jadi tanpa ini karyawan
// tetap bisa mengunggah file ke folder logos/{businessId}/ milik usaha
// walau ujungnya tidak bisa menyimpan URL-nya (defense in depth, bukan
// satu-satunya lapis).
async function requireOwnership(req: Parameters<typeof createRequestClient>[0], businessId: string) {
  const supabase = createRequestClient(req);
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return false;

  const { data: ownedBusiness } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('owner_id', userData.user.id)
    .maybeSingle();
  return Boolean(ownedBusiness);
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

// Logo usaha (migration 035) — diunggah sekali lewat Info Usaha, dipakai
// di Etalase Online, og:image, dan Nota Sewa cetak (lihat businesses.ts
// untuk kolom, etalase.ts & InvoiceModal.tsx untuk pemakaian). Pola sama
// persis dengan item-image/customer-photo di atas: SVG tetap ditolak
// (decodeImageDataUrl() cuma terima webp/png/jpeg) — SVG bisa membawa
// <script>/event handler inline atau referensi <image>/<use> eksternal,
// vektor XSS/leak yang sama kenapa dua endpoint di atas juga menolaknya.
router.post('/uploads/business-logo', async (req, res) => {
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

  if (!(await requireOwnership(req, businessId))) {
    res.status(403).json({ error: 'Cuma pemilik usaha yang bisa mengubah logo' });
    return;
  }

  const key = `logos/${businessId}/${crypto.randomUUID()}.${decoded.extension}`;

  try {
    const url = await uploadToR2(key, decoded.buffer, decoded.mimeType);
    res.status(201).json({ url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// QRIS statis (rencana 2.8b, migration 037) — owner-only (sama alasan
// logo: pengaturan cara bayar cuma boleh diubah pemilik, bukan karyawan,
// keputusan Andi 31 Okt). Ukuran dibatasi lebih ketat (2MB, bukan 5MB
// seperti endpoint lain) karena gambar QRIS statis selalu kecil/simpel —
// file besar di sini lebih mungkin salah upload daripada kebutuhan
// sungguhan. decode+reencode via sharp WAJIB di sini (beda dari endpoint
// lain yang upload buffer asli apa adanya) — gambar QRIS dipakai pihak
// KETIGA (pelanggan) discan langsung oleh aplikasi e-wallet/bank mereka,
// jadi perlu dipastikan filenya benar-benar cuma data gambar (metadata/
// payload tersembunyi ikut hilang lewat decode-reencode, bukan cuma
// redimensi) sebelum disimpan sebagai "QRIS resmi milik rental ini".
// Selalu disimpan sebagai .webp terlepas format asli unggahan, supaya
// cocok dengan constraint qris_image_url_is_own_r2 (prefix path, bukan
// ekstensi) dan konsisten dengan pola foto alat (items.ts).
const MAX_QRIS_BYTES = 2 * 1024 * 1024;

router.post('/uploads/qris-image', async (req, res) => {
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
  if (decoded.buffer.length > MAX_QRIS_BYTES) {
    res.status(400).json({ error: 'Ukuran gambar QRIS maksimal 2MB.' });
    return;
  }

  if (!(await requireOwnership(req, businessId))) {
    res.status(403).json({ error: 'Cuma pemilik usaha yang bisa mengubah cara bayar QRIS' });
    return;
  }

  let reencoded: Buffer;
  try {
    reencoded = await sharp(decoded.buffer)
      .rotate()
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    res.status(400).json({ error: 'Gambar QRIS tidak bisa diproses, coba file lain.' });
    return;
  }

  const key = `qris/${businessId}/${crypto.randomUUID()}.webp`;

  try {
    const url = await uploadToR2(key, reencoded, 'image/webp');
    res.status(201).json({ url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
