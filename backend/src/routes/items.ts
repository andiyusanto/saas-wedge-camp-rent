import { Router } from 'express';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createRequestClient } from '../lib/supabaseClient.js';
import { uploadToR2 } from '../lib/r2.js';
import { fetchImageFromUrl, ImageFetchError } from '../lib/imageFetch.js';
import {
  parseImportFile,
  matchExistingItems,
  computeUnitWarnings,
  resolveDayRates,
} from '../lib/itemImport.js';
import type { ExistingItemForMatch, ImportRowResult } from '../lib/itemImport.js';

const router = Router();

const MAX_FILE_BASE64_BYTES = 3 * 1024 * 1024; // sedikit di atas MAX_FILE_BYTES di itemImport.ts, base64 nambah ~33%

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

function decodeFileBase64(fileBase64: unknown, filename: unknown): { buffer: Buffer; filename: string } {
  if (typeof fileBase64 !== 'string' || typeof filename !== 'string' || !filename) {
    throw new Error('Data file tidak lengkap.');
  }
  if (fileBase64.length > MAX_FILE_BASE64_BYTES) {
    throw new Error('Ukuran file lebih dari 2MB.');
  }
  const base64 = fileBase64.includes(',') ? fileBase64.slice(fileBase64.indexOf(',') + 1) : fileBase64;
  const buffer = Buffer.from(base64, 'base64');
  if (!/\.(xlsx|csv)$/i.test(filename)) {
    throw new Error('Format file harus .xlsx atau .csv.');
  }
  return { buffer, filename };
}

const EXISTING_ITEM_FIELDS =
  'id, code, name, category, variant, size, color, total_units, price_per_day, day2_rate, day3_rate, day4_rate, day5_rate, extra_day_rate, readiness_hours, description, deactivated_at';

type PreviewResponseRowData = {
  code: string | null;
  category: string | null;
  variant: string | null;
  size: string | null;
  color: string | null;
  total_units: number;
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
  readiness_hours: number;
  description: string | null;
  photo_url: string | null;
};

type PreviewResponseRow = {
  rowNumber: number;
  name: string;
  status: 'new' | 'update' | 'unchanged' | 'skipped';
  itemId: string | null;
  diff: { field: string; label: string; from: string; to: string }[];
  reactivatable: boolean;
  reason: string | null;
  data: PreviewResponseRowData | null;
};

// data = nilai yang BENAR-BENAR akan disimpan (sel kosong sudah diresolve
// warisan tarif bertingkat oleh parseImportFile(), bukan dihitung ulang di
// sini) — dipakai frontend untuk ringkasan & detail pratinjau (permintaan
// Andi: vendor perlu lihat data sebenarnya, bukan cuma "Baru"/"Diperbarui").
// null untuk baris 'skipped' karena datanya belum tentu valid/lengkap.
function toPreviewRowData(row: ImportRowResult['row']): PreviewResponseRowData {
  return {
    code: row.code,
    category: row.category,
    variant: row.variant,
    size: row.size,
    color: row.color,
    total_units: row.total_units,
    price_per_day: row.price_per_day,
    day2_rate: row.day2_rate,
    day3_rate: row.day3_rate,
    day4_rate: row.day4_rate,
    day5_rate: row.day5_rate,
    extra_day_rate: row.extra_day_rate,
    readiness_hours: row.readiness_hours,
    description: row.description,
    photo_url: row.photo_url,
  };
}

function toPreviewRow(r: ImportRowResult): PreviewResponseRow {
  const base = { rowNumber: r.row.rowNumber, name: r.row.name };
  switch (r.match.kind) {
    case 'new':
      return { ...base, status: 'new', itemId: null, diff: [], reactivatable: false, reason: null, data: toPreviewRowData(r.row) };
    case 'unchanged':
      return {
        ...base,
        status: 'unchanged',
        itemId: r.match.itemId,
        diff: [],
        reactivatable: false,
        reason: null,
        data: toPreviewRowData(r.row),
      };
    case 'update':
      return {
        ...base,
        status: 'update',
        itemId: r.match.itemId,
        diff: r.match.diff,
        reactivatable: r.match.reactivatable,
        reason: null,
        data: toPreviewRowData(r.row),
      };
    case 'skipped':
      return { ...base, status: 'skipped', itemId: null, diff: [], reactivatable: false, reason: r.match.reason, data: null };
  }
}

async function buildPreview(req: Parameters<typeof createRequestClient>[0], businessId: string, buffer: Buffer, filename: string) {
  const supabase = createRequestClient(req);

  const parseResult = await parseImportFile(buffer, filename);
  if (parseResult.fileLevelErrors.length > 0) {
    return { fileLevelErrors: parseResult.fileLevelErrors, rows: [] as ImportRowResult[], warnings: [] as Awaited<ReturnType<typeof computeUnitWarnings>> };
  }

  const { data: existingItems, error } = await supabase.from('items').select(EXISTING_ITEM_FIELDS);
  if (error) throw new Error(error.message);

  const matched = matchExistingItems(parseResult.rows, (existingItems ?? []) as ExistingItemForMatch[]);
  const warnings = await computeUnitWarnings(supabase, matched);

  return { fileLevelErrors: [] as string[], rows: matched, warnings };
}

// Preview — baca & validasi, cocokkan ke alat existing, hitung diff dan
// peringatan unit. TIDAK menyimpan apa pun.
router.post('/items/import/preview', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { businessId, fileBase64, filename } = req.body ?? {};
  if (!businessId) {
    res.status(400).json({ error: 'Data tidak lengkap' });
    return;
  }

  if (!(await requireOwnership(req, businessId))) {
    res.status(403).json({ error: 'Cuma pemilik usaha yang bisa mengimpor data alat' });
    return;
  }

  let decoded;
  try {
    decoded = decodeFileBase64(fileBase64, filename);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  try {
    const preview = await buildPreview(req, businessId, decoded.buffer, decoded.filename);
    if (preview.fileLevelErrors.length > 0) {
      res.status(400).json({ error: preview.fileLevelErrors.join(' ') });
      return;
    }

    res.json({
      rows: preview.rows.map(toPreviewRow),
      warnings: preview.warnings,
      summary: {
        new: preview.rows.filter((r) => r.match.kind === 'new').length,
        updated: preview.rows.filter((r) => r.match.kind === 'update').length,
        unchanged: preview.rows.filter((r) => r.match.kind === 'unchanged').length,
        skipped: preview.rows.filter((r) => r.match.kind === 'skipped').length,
      },
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

type CommitBody = {
  businessId: string;
  fileBase64: string;
  filename: string;
  reactivateItemIds: string[]; // itemId yang user pilih "ya, aktifkan lagi"
  acknowledgedUnitWarning: boolean;
};

// Commit — PARSE ULANG file asli dari awal (tidak percaya hasil preview
// yang dikirim balik client, lihat koreksi Andi 29 Okt: data vendor bisa
// berubah di antara dua panggilan dan payload JSON bisa dimanipulasi).
// Simpan baris demi baris (bukan satu transaksi DB sungguhan — supabase-js
// REST tidak punya transaksi multi-statement), laporan akhir jujur
// menyebut baris yang gagal kalau ada error di tengah jalan.
router.post('/items/import/commit', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const body = (req.body ?? {}) as Partial<CommitBody>;
  const { businessId, reactivateItemIds, acknowledgedUnitWarning } = body;
  if (!businessId) {
    res.status(400).json({ error: 'Data tidak lengkap' });
    return;
  }

  if (!(await requireOwnership(req, businessId))) {
    res.status(403).json({ error: 'Cuma pemilik usaha yang bisa mengimpor data alat' });
    return;
  }

  let decoded;
  try {
    decoded = decodeFileBase64(body.fileBase64, body.filename);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  let preview;
  try {
    preview = await buildPreview(req, businessId, decoded.buffer, decoded.filename);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  if (preview.fileLevelErrors.length > 0) {
    res.status(400).json({ error: preview.fileLevelErrors.join(' ') });
    return;
  }

  // Server sendiri yang menolak commit tanpa centang kalau peringatannya
  // memang ada — bukan cuma validasi UI, supaya tidak bisa dilewati lewat
  // panggilan API langsung.
  if (preview.warnings.length > 0 && !acknowledgedUnitWarning) {
    res.status(400).json({ error: 'Ada peringatan unit yang diturunkan di bawah unit yang sedang disewa — perlu dikonfirmasi dulu.' });
    return;
  }

  const supabase = createRequestClient(req);
  const reactivateSet = new Set(reactivateItemIds ?? []);

  const added: { rowNumber: number; name: string }[] = [];
  const updated: { rowNumber: number; name: string }[] = [];
  const unchanged: { rowNumber: number; name: string }[] = [];
  const skipped: { rowNumber: number; name: string; reason: string }[] = [];
  const failed: { rowNumber: number; name: string; error: string }[] = [];
  const savedItemsForPhotos: { itemId: string; rowNumber: number; name: string; photoUrl: string }[] = [];

  for (const r of preview.rows) {
    if (r.match.kind === 'skipped') {
      skipped.push({ rowNumber: r.row.rowNumber, name: r.row.name, reason: r.match.reason });
      continue;
    }
    if (r.match.kind === 'unchanged') {
      unchanged.push({ rowNumber: r.row.rowNumber, name: r.row.name });
      if (r.row.photo_url) savedItemsForPhotos.push({ itemId: r.match.itemId, rowNumber: r.row.rowNumber, name: r.row.name, photoUrl: r.row.photo_url });
      continue;
    }

    const rates = resolveDayRates(r.row);
    const payload = {
      code: r.row.code,
      category: r.row.category,
      variant: r.row.variant,
      size: r.row.size,
      color: r.row.color,
      total_units: r.row.total_units,
      readiness_hours: r.row.readiness_hours,
      description: r.row.description,
      ...rates,
    };

    if (r.match.kind === 'new') {
      const { data, error } = await supabase
        .from('items')
        .insert({ business_id: businessId, name: r.row.name, ...payload })
        .select('id')
        .single();
      if (error || !data) {
        failed.push({ rowNumber: r.row.rowNumber, name: r.row.name, error: error?.message ?? 'Gagal menyimpan.' });
        continue;
      }
      added.push({ rowNumber: r.row.rowNumber, name: r.row.name });
      if (r.row.photo_url) savedItemsForPhotos.push({ itemId: data.id, rowNumber: r.row.rowNumber, name: r.row.name, photoUrl: r.row.photo_url });
      continue;
    }

    // update
    const updatePayload: Record<string, unknown> = { name: r.row.name, ...payload };
    if (reactivateSet.has(r.match.itemId)) {
      updatePayload.deactivated_at = null;
    }
    const { error } = await supabase.from('items').update(updatePayload).eq('id', r.match.itemId);
    if (error) {
      failed.push({ rowNumber: r.row.rowNumber, name: r.row.name, error: error.message });
      continue;
    }
    updated.push({ rowNumber: r.row.rowNumber, name: r.row.name });
    if (r.row.photo_url) savedItemsForPhotos.push({ itemId: r.match.itemId, rowNumber: r.row.rowNumber, name: r.row.name, photoUrl: r.row.photo_url });
  }

  // Foto diproses TERAKHIR, per alat yang sudah tersimpan — kalau gagal,
  // data alatnya tetap tersimpan (lihat alur poin 5, disetujui Andi).
  const photoFailed: { rowNumber: number; name: string; error: string }[] = [];
  const photoOk: { rowNumber: number; name: string }[] = [];

  for (const item of savedItemsForPhotos) {
    try {
      const fetched = await fetchImageFromUrl(item.photoUrl);
      const resized = await sharp(fetched.buffer).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const key = `items/${businessId}/${crypto.randomUUID()}.webp`;
      const url = await uploadToR2(key, resized, 'image/webp');
      const { error } = await supabase.from('items').update({ image_url: url }).eq('id', item.itemId);
      if (error) throw new Error(error.message);
      photoOk.push({ rowNumber: item.rowNumber, name: item.name });
    } catch (err) {
      // Error dari fetchImageFromUrl() sudah bahasa vendor (lihat imageFetch.ts).
      // Error LAIN (sharp gagal decode, upload R2 gagal, update DB gagal) BELUM
      // tentu aman ditampilkan apa adanya — detail teknisnya cuma ke log server,
      // vendor dapat pesan generik yang tetap actionable.
      const message = err instanceof ImageFetchError ? err.message : 'Foto gagal diproses, coba unggah manual lewat form alat.';
      if (!(err instanceof ImageFetchError)) {
        console.error('[itemImport] Gagal proses foto baris', item.rowNumber, item.photoUrl, err);
      }
      photoFailed.push({ rowNumber: item.rowNumber, name: item.name, error: message });
    }
  }

  res.json({
    added,
    updated,
    unchanged,
    skipped,
    failed,
    photos: { ok: photoOk, failed: photoFailed },
  });
});

export default router;
