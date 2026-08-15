import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
