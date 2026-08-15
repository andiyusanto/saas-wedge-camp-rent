// Resize gambar di browser sebelum diunggah — alat kamera HP modern
// gampang 5-10MB per foto, terlalu besar buat ditampilkan di kartu kecil.
// Tidak menangani HEIC (format default kamera iPhone) secara khusus —
// kalau browser gagal decode, minta user pakai JPG/PNG saja (keputusan
// sengaja: dekoder HEIC nambah ~500KB dependency buat kasus yang jarang).
//
// Hasilnya data URL (base64), dikirim ke backend lewat JSON biasa —
// backend yang upload ke Cloudflare R2 (kredensialnya cuma ada di
// server, lihat backend/src/lib/r2.ts).
export async function resizeImageToDataUrl(file: File, maxDimension = 1280, quality = 0.8): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Format gambar tidak didukung oleh browser ini. Gunakan foto JPG atau PNG.');
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context tidak tersedia di browser ini.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Safari diam-diam mengganti WebP jadi PNG kalau tidak didukung (bukan
  // error, sesuai spesifikasi toDataURL) — backend mendeteksi format
  // asli dari prefix data URL ini, bukan mengasumsikan selalu WebP.
  return canvas.toDataURL('image/webp', quality);
}
