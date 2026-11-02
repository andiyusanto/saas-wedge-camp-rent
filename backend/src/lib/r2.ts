import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// R2 kompatibel S3 — SDK yang sama dipakai, cuma endpoint-nya diarahkan
// ke Cloudflare, bukan AWS. credentials ini SENGAJA hanya dipegang
// backend (tidak pernah dikirim ke frontend), beda dari Supabase Storage
// yang bisa diamankan lewat RLS per-user — R2 tidak punya mekanisme itu,
// jadi upload harus selalu lewat endpoint kita, tidak langsung dari klien.
//
// Divalidasi lazy (saat dipakai, bukan saat modul di-import) supaya
// server tetap bisa jalan buat fitur lain kalau R2 belum dikonfigurasi —
// cuma endpoint upload foto yang bakal gagal.
let client: S3Client | null = null;
let bucketName: string;
let publicBaseUrl: string;

function getClient(): S3Client {
  if (client) return client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  bucketName = process.env.R2_BUCKET_NAME ?? '';
  publicBaseUrl = process.env.R2_PUBLIC_URL ?? '';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicBaseUrl) {
    throw new Error(
      'Upload gambar belum dikonfigurasi (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/R2_PUBLIC_URL belum diisi di .env)',
    );
  }

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return client;
}

export async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<string> {
  const s3 = getClient();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return `${publicBaseUrl.replace(/\/$/, '')}/${key}`;
}

// Audit privasi 2 Nov 2026 — foto penyewa (customer-photo) TIDAK LAGI
// masuk bucket publik di atas (URL-nya bisa diakses siapa pun selamanya
// tanpa login begitu diketahui, dikonfirmasi lewat curl langsung).
// Bucket TERPISAH ini sengaja TIDAK terhubung custom domain publik apa
// pun — satu-satunya jalur baca adalah getCustomerPhotoSignedUrl() di
// bawah (presigned GET, umur pendek), dipanggil dari endpoint backend
// yang mengecek keanggotaan business dulu (routes/bookings.ts).
//
// SENGAJA tidak fallback ke bucket publik kalau env ini belum diisi —
// gagal keras (error eksplisit) jauh lebih aman daripada diam-diam
// menulis foto baru ke bucket publik lagi tanpa disadari siapa pun.
let privateBucketName: string | undefined;

function getPrivateBucketName(): string {
  if (privateBucketName === undefined) {
    privateBucketName = process.env.R2_PRIVATE_BUCKET_NAME ?? '';
  }
  if (!privateBucketName) {
    throw new Error(
      'Upload foto penyewa belum dikonfigurasi (R2_PRIVATE_BUCKET_NAME belum diisi di .env) — TIDAK akan fallback ke bucket publik.',
    );
  }
  return privateBucketName;
}

// Mengembalikan KEY saja (bukan URL) — bucket privat tidak punya URL
// publik yang bisa langsung dipakai. Pemanggil (routes/uploads.ts)
// menyimpan key ini ke bookings.customer_photo_key, bukan URL.
export async function uploadToR2Private(key: string, body: Buffer, contentType: string): Promise<string> {
  const s3 = getClient();
  const bucket = getPrivateBucketName();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return key;
}

// 5 menit — cukup untuk satu kali tampil di layar Transaksi Aktif,
// cukup pendek supaya link yang kebetulan bocor (screenshot, history
// browser, dsb) tidak berguna lama-lama. Frontend SELALU minta link
// baru tiap kali foto ditampilkan, tidak pernah menyimpan/memakai ulang
// link lama (lihat TrackingScreen.tsx).
const SIGNED_URL_EXPIRY_SECONDS = 5 * 60;

export async function getCustomerPhotoSignedUrl(key: string): Promise<string> {
  const s3 = getClient();
  const bucket = getPrivateBucketName();

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
}
