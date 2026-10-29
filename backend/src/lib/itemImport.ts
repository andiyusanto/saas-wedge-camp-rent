import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ItemDayRates } from './pricing.js';
import { fetchActiveBookingItems, usedUnitsOn } from './availability.js';
import { todayInWIB, addDays } from './dates.js';

// Impor data alat lewat Excel/CSV (menu Katalog & Stok Alat) — disetujui
// Andi 29 Okt. Parsing dipisah dari endpoint (routes/items.ts) supaya satu
// fungsi yang sama dipakai di /preview DAN /commit — commit WAJIB parse
// ulang file asli dari awal (bukan percaya hasil preview yang dikirim
// balik client), karena data vendor bisa berubah di antara dua panggilan
// dan payload JSON dari client bisa dimanipulasi.

export const MAX_IMPORT_ROWS = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const REQUIRED_HEADERS = ['Nama alat', 'Jumlah unit', 'Harga hari 1'] as const;
const ALL_HEADERS = [
  'Nama alat',
  'Kode',
  'Kategori',
  'Varian',
  'Ukuran',
  'Warna',
  'Jumlah unit',
  'Harga hari 1',
  'Harga hari 2',
  'Harga hari 3',
  'Harga hari 4',
  'Harga hari 5',
  'Harga hari 6 dst',
  'Jeda persiapan (jam)',
  'Deskripsi',
  'Link foto',
] as const;

export type ParsedRow = {
  rowNumber: number; // nomor baris di file (termasuk header), untuk pesan error ke user
  name: string;
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

export type ImportMatch =
  | { kind: 'new' }
  | { kind: 'update'; itemId: string; diff: { field: string; label: string; from: string; to: string }[]; reactivatable: boolean }
  | { kind: 'unchanged'; itemId: string }
  | { kind: 'skipped'; reason: string };

export type ImportRowResult = { row: ParsedRow; match: ImportMatch };

const EMPTY_PARSED_ROW: ParsedRow = {
  rowNumber: 0,
  name: '',
  code: null,
  category: null,
  variant: null,
  size: null,
  color: null,
  total_units: 0,
  price_per_day: 0,
  day2_rate: 0,
  day3_rate: 0,
  day4_rate: 0,
  day5_rate: 0,
  extra_day_rate: 0,
  readiness_hours: 0,
  description: null,
  photo_url: null,
};

export type ImportParseResult = {
  rows: ImportRowResult[];
  fileLevelErrors: string[]; // mis. "lebih dari 500 baris", header wajib hilang
};

function cleanNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const str = String(raw).trim();
  if (!str) return null;
  // "Rp30.000" / "Rp 30.000,50" / "30000" — buang semua kecuali digit, koma, titik
  // lalu normalisasi: titik sebagai pemisah ribuan dibuang, koma jadi desimal.
  const cleaned = str.replace(/[^0-9.,-]/g, '');
  if (!cleaned) return null;
  const hasComma = cleaned.includes(',');
  const normalized = hasComma ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/(?<=\d)\.(?=\d{3}(\D|$))/g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function normalizeText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  return str === '' ? null : str;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchKeyFor(row: { code: string | null; name: string; variant: string | null; size: string | null; color: string | null }): {
  type: 'code' | 'composite';
  key: string;
} {
  if (row.code && row.code.trim()) {
    return { type: 'code', key: normalizeKey(row.code) };
  }
  return {
    type: 'composite',
    key: normalizeKey([row.name, row.variant ?? '', row.size ?? '', row.color ?? ''].join('|')),
  };
}

// Deteksi delimiter CSV Excel-Indonesia (";") vs default (",") — dilihat
// dari baris pertama, bukan diasumsikan.
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// exceljs 4.4.0 CRASH (dibuktikan lewat trace, bukan asumsi) saat membaca
// .xlsx yang punya cell comment bergaya VML lama (xl/comments/*.xml +
// xl/drawings/*.vml) — bug di worksheet-xform.js reconcile(), bukan cuma
// soal template Sewalog sendiri: vendor sering menambah catatan sendiri di
// Excel, dan file ekspor dari Google Sheets yang punya "notes" juga bisa
// membawa struktur serupa. Dibuang programatik DI SINI (sebelum diserahkan
// ke exceljs) supaya file seperti itu tetap bisa diimpor — bukan sekadar
// gagal dengan pesan error, dan bukan cuma fix manual sekali pakai di
// template kita sendiri (sudah dilakukan terpisah, lihat frontend/public/
// template-data-alat.xlsx).
async function stripLegacyCellComments(buffer: Buffer): Promise<Buffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return buffer; // bukan file .xlsx/zip yang valid — biarkan exceljs sendiri yang menolaknya dengan pesannya
  }

  const commentFiles = Object.keys(zip.files).filter((name) => /^xl\/comments.*\.xml$/i.test(name));
  const vmlFiles = Object.keys(zip.files).filter((name) => /^xl\/drawings\/.*vmlDrawing.*\.vml$/i.test(name));
  if (commentFiles.length === 0 && vmlFiles.length === 0) {
    return buffer; // tidak ada comment sama sekali, tidak perlu diapa-apakan
  }

  for (const name of [...commentFiles, ...vmlFiles]) zip.remove(name);

  const sheetFiles = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  for (const sheetName of sheetFiles) {
    const sheetXml = await zip.file(sheetName)!.async('string');
    const cleanedSheet = sheetXml.replace(/<legacyDrawing\b[^>]*\/>/g, '');
    if (cleanedSheet !== sheetXml) zip.file(sheetName, cleanedSheet);

    const relsName = `xl/worksheets/_rels/${sheetName.split('/').pop()}.rels`;
    const relsFile = zip.file(relsName);
    if (!relsFile) continue;
    const relsXml = await relsFile.async('string');
    const cleanedRels = relsXml.replace(
      /<Relationship\b(?:(?!\/>)[\s\S])*?Type="[^"]*\/(?:comments|vmlDrawing)"(?:(?!\/>)[\s\S])*?\/>/g,
      '',
    );
    const remainingRelationships = (cleanedRels.match(/<Relationship\b/g) ?? []).length;
    if (remainingRelationships === 0) {
      zip.remove(relsName);
    } else if (cleanedRels !== relsXml) {
      zip.file(relsName, cleanedRels);
    }
  }

  const contentTypesFile = zip.file('[Content_Types].xml');
  if (contentTypesFile) {
    const contentTypesXml = await contentTypesFile.async('string');
    const cleanedContentTypes = contentTypesXml.replace(
      /<Override\b(?:(?!\/>)[\s\S])*?PartName="\/xl\/comments[^"]*"(?:(?!\/>)[\s\S])*?\/>/g,
      '',
    );
    if (cleanedContentTypes !== contentTypesXml) zip.file('[Content_Types].xml', cleanedContentTypes);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

async function parseWorkbookRows(buffer: Buffer, isCsv: boolean): Promise<{ headers: string[]; rows: unknown[][] }> {
  if (isCsv) {
    const text = buffer.toString('utf-8').replace(/^﻿/, '');
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
    const headers = splitCsvLine(lines[0], delimiter).map((h) => h.trim());
    const rows = lines.slice(1).map((l) => splitCsvLine(l, delimiter));
    return { headers, rows };
  }

  const sanitizedBuffer = await stripLegacyCellComments(buffer);

  const workbook = new ExcelJS.Workbook();
  // Ketidakcocokan tipe Buffer vs ArrayBufferLike antara @types/node versi
  // ini dan tipe exceljs sendiri (tidak berarti apa-apa secara runtime,
  // sama-sama Buffer Node asli) — exceljs belum update tipenya.
  await workbook.xlsx.load(sanitizedBuffer as any);
  const sheet = workbook.getWorksheet('Data Alat') ?? workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '').trim();
  });

  const rows: unknown[][] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      let v = cell.value;
      if (v && typeof v === 'object' && 'text' in (v as any)) v = (v as any).text; // rich text
      if (v && typeof v === 'object' && 'result' in (v as any)) v = (v as any).result; // formula
      values[colNumber - 1] = v;
    });
    if (values.some((v) => v !== undefined && v !== null && String(v).trim() !== '')) {
      rows.push(values);
    }
  });

  return { headers, rows };
}

export async function parseImportFile(
  buffer: Buffer,
  filename: string,
): Promise<ImportParseResult> {
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return { rows: [], fileLevelErrors: ['Ukuran file lebih dari 2MB.'] };
  }

  const isCsv = filename.toLowerCase().endsWith('.csv');
  let headers: string[];
  let rawRows: unknown[][];
  try {
    const parsed = await parseWorkbookRows(buffer, isCsv);
    headers = parsed.headers;
    rawRows = parsed.rows;
  } catch (err) {
    // Pesan error internal (exceljs/zip) tidak berarti apa-apa buat vendor
    // dan berisiko membocorkan detail implementasi — dicatat ke log server
    // saja untuk didiagnosis, pesan ke vendor tetap generik dan actionable.
    console.error('[itemImport] Gagal parsing file:', filename, err);
    return {
      rows: [],
      fileLevelErrors: ['File tidak bisa dibaca. Coba simpan ulang sebagai .xlsx atau .csv dari template Sewalog.'],
    };
  }

  const fileLevelErrors: string[] = [];
  // Header kolom wajib di template dibubuhi "*" ("Nama alat*") — dibuang
  // sebelum dibandingkan, bukan di normalizeKey() yang juga dipakai untuk
  // kunci dedup nama/kode alat (data isian, bukan header).
  const normalizeHeader = (s: string) => normalizeKey(s).replace(/\*\s*$/, '');
  const colIndex: Record<string, number> = {};
  for (const h of ALL_HEADERS) {
    const idx = headers.findIndex((x) => normalizeHeader(x) === normalizeHeader(h));
    if (idx >= 0) colIndex[h] = idx;
  }

  const missingRequired = REQUIRED_HEADERS.filter((h) => colIndex[h] === undefined);
  if (missingRequired.length > 0) {
    fileLevelErrors.push(`Kolom wajib tidak ditemukan: ${missingRequired.join(', ')}.`);
    return { rows: [], fileLevelErrors };
  }

  if (rawRows.length > MAX_IMPORT_ROWS) {
    fileLevelErrors.push(`File berisi ${rawRows.length} baris, melebihi batas ${MAX_IMPORT_ROWS} baris per impor.`);
    return { rows: [], fileLevelErrors };
  }

  const cell = (r: unknown[], header: string) => (colIndex[header] !== undefined ? r[colIndex[header]] : undefined);

  const parsedRows: (ParsedRow | { rowNumber: number; name: string; error: string })[] = [];

  rawRows.forEach((r, i) => {
    const rowNumber = i + 2; // +1 header, +1 ke-1-based
    const name = normalizeText(cell(r, 'Nama alat'));
    const totalUnits = cleanNumber(cell(r, 'Jumlah unit'));
    const priceDay1 = cleanNumber(cell(r, 'Harga hari 1'));

    if (!name) {
      parsedRows.push({ rowNumber, name: '', error: 'Nama alat wajib diisi.' });
      return;
    }
    if (totalUnits === null || totalUnits < 0) {
      parsedRows.push({ rowNumber, name, error: 'Jumlah unit wajib diisi dan berupa angka.' });
      return;
    }
    if (priceDay1 === null || priceDay1 < 0) {
      parsedRows.push({ rowNumber, name, error: 'Harga hari 1 wajib diisi dan berupa angka.' });
      return;
    }

    const day2 = cleanNumber(cell(r, 'Harga hari 2')) ?? priceDay1;
    const day3 = cleanNumber(cell(r, 'Harga hari 3')) ?? day2;
    const day4 = cleanNumber(cell(r, 'Harga hari 4')) ?? day3;
    const day5 = cleanNumber(cell(r, 'Harga hari 5')) ?? day4;
    const extra = cleanNumber(cell(r, 'Harga hari 6 dst')) ?? day5;
    const readinessHours = cleanNumber(cell(r, 'Jeda persiapan (jam)')) ?? 0;

    parsedRows.push({
      rowNumber,
      name,
      code: normalizeText(cell(r, 'Kode')),
      category: normalizeText(cell(r, 'Kategori')),
      variant: normalizeText(cell(r, 'Varian')),
      size: normalizeText(cell(r, 'Ukuran')),
      color: normalizeText(cell(r, 'Warna')),
      total_units: totalUnits,
      price_per_day: priceDay1,
      day2_rate: day2,
      day3_rate: day3,
      day4_rate: day4,
      day5_rate: day5,
      extra_day_rate: extra,
      readiness_hours: readinessHours,
      description: normalizeText(cell(r, 'Deskripsi')),
      photo_url: normalizeText(cell(r, 'Link foto')),
    });
  });

  // Deteksi duplikat kunci (Kode, atau gabungan nama+varian+ukuran+warna)
  // DI DALAM FILE itu sendiri — baris-baris itu semua ditandai error,
  // bukan cuma salah satu, karena tidak ada cara aman memutuskan mana
  // yang "benar" di antara mereka.
  const keyCount = new Map<string, number[]>();
  parsedRows.forEach((r, idx) => {
    if ('error' in r) return;
    const { key } = matchKeyFor(r);
    keyCount.set(key, [...(keyCount.get(key) ?? []), idx]);
  });
  const duplicateIndexes = new Set<number>();
  for (const indexes of keyCount.values()) {
    if (indexes.length > 1) indexes.forEach((i) => duplicateIndexes.add(i));
  }

  const validRows: ParsedRow[] = [];
  const results: ImportRowResult[] = [];

  parsedRows.forEach((r, idx) => {
    if ('error' in r) {
      results.push({
        row: { ...EMPTY_PARSED_ROW, rowNumber: r.rowNumber, name: r.name },
        match: { kind: 'skipped', reason: r.error },
      });
      return;
    }
    if (duplicateIndexes.has(idx)) {
      results.push({ row: r, match: { kind: 'skipped', reason: 'Kode/kunci alat ini dobel di dalam file.' } });
      return;
    }
    validRows.push(r);
    results.push({ row: r, match: { kind: 'new' } }); // placeholder, diisi matchExistingItems()
  });

  return { rows: results, fileLevelErrors };
}

export type ExistingItemForMatch = {
  id: string;
  code: string | null;
  name: string;
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
  deactivated_at: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  code: 'Kode',
  category: 'Kategori',
  variant: 'Varian',
  size: 'Ukuran',
  color: 'Warna',
  total_units: 'Jumlah unit',
  price_per_day: 'Harga hari 1',
  day2_rate: 'Harga hari 2',
  day3_rate: 'Harga hari 3',
  day4_rate: 'Harga hari 4',
  day5_rate: 'Harga hari 5',
  extra_day_rate: 'Harga hari 6 dst',
  readiness_hours: 'Jeda persiapan (jam)',
  description: 'Deskripsi',
};

function fmt(v: unknown): string {
  return v === null || v === undefined || v === '' ? '(kosong)' : String(v);
}

// Mencocokkan baris file ke alat existing milik business yang sama, lalu
// menghitung diff per field. Sel KOSONG di file tidak dianggap "beda" dan
// tidak menimpa nilai lama — dicek di sini (bukan dibiarkan ke commit).
export function matchExistingItems(rowResults: ImportRowResult[], existingItems: ExistingItemForMatch[]): ImportRowResult[] {
  const byCode = new Map<string, ExistingItemForMatch[]>();
  const byComposite = new Map<string, ExistingItemForMatch[]>();
  for (const item of existingItems) {
    if (item.code && item.code.trim()) {
      const k = normalizeKey(item.code);
      byCode.set(k, [...(byCode.get(k) ?? []), item]);
    }
    const compositeKey = normalizeKey([item.name, item.variant ?? '', item.size ?? '', item.color ?? ''].join('|'));
    byComposite.set(compositeKey, [...(byComposite.get(compositeKey) ?? []), item]);
  }

  return rowResults.map((r) => {
    if (r.match.kind === 'skipped') return r;

    const { type, key } = matchKeyFor(r.row);
    const candidates = type === 'code' ? byCode.get(key) ?? [] : byComposite.get(key) ?? [];

    if (candidates.length === 0) {
      return { row: r.row, match: { kind: 'new' } };
    }
    if (candidates.length > 1) {
      return { row: r.row, match: { kind: 'skipped', reason: `Cocok dengan ${candidates.length} alat sekaligus, perlu dicek manual.` } };
    }

    const existing = candidates[0];
    const fieldMap: [keyof ParsedRow, keyof ExistingItemForMatch][] = [
      ['code', 'code'],
      ['category', 'category'],
      ['variant', 'variant'],
      ['size', 'size'],
      ['color', 'color'],
      ['total_units', 'total_units'],
      ['price_per_day', 'price_per_day'],
      ['day2_rate', 'day2_rate'],
      ['day3_rate', 'day3_rate'],
      ['day4_rate', 'day4_rate'],
      ['day5_rate', 'day5_rate'],
      ['extra_day_rate', 'extra_day_rate'],
      ['readiness_hours', 'readiness_hours'],
      ['description', 'description'],
    ];

    const diff: { field: string; label: string; from: string; to: string }[] = [];
    for (const [rowField, existingField] of fieldMap) {
      const newVal = (r.row as any)[rowField];
      if (newVal === null || newVal === undefined) continue; // sel kosong, tidak menimpa
      const oldVal = existing[existingField];
      if (String(newVal) !== String(oldVal ?? '')) {
        diff.push({ field: rowField as string, label: FIELD_LABELS[rowField as string] ?? rowField, from: fmt(oldVal), to: fmt(newVal) });
      }
    }

    if (diff.length === 0) {
      return { row: r.row, match: { kind: 'unchanged', itemId: existing.id } };
    }

    return {
      row: r.row,
      match: { kind: 'update', itemId: existing.id, diff, reactivatable: existing.deactivated_at !== null },
    };
  });
}

export type UnitWarning = { rowNumber: number; name: string; itemId: string | null; currentlyUsed: number; newTotalUnits: number };

// Peringatan "unit diturunkan di bawah unit yang sedang disewa/dipesan" —
// pakai logika availability yang SAMA dengan Kalender Ketersediaan
// (usedUnitsOn), bukan dihitung ulang terpisah. Diperiksa untuk hari ini
// s.d. 30 hari ke depan (jendela yang sama dipakai CalendarScreen/
// routes/availability.ts) — cukup untuk menangkap booking dipesan/aktif
// yang akan kena dampak penurunan stok.
export async function computeUnitWarnings(
  supabase: SupabaseClient,
  rowResults: ImportRowResult[],
): Promise<UnitWarning[]> {
  const toCheck = rowResults.filter((r) => r.match.kind === 'update') as { row: ParsedRow; match: Extract<ImportMatch, { kind: 'update' }> }[];
  if (toCheck.length === 0) return [];

  const bookingItems = await fetchActiveBookingItems(supabase);
  const today = todayInWIB();
  const dateWindow = Array.from({ length: 30 }, (_, i) => addDays(today, i));

  const warnings: UnitWarning[] = [];
  for (const { row, match } of toCheck) {
    const maxUsed = Math.max(0, ...dateWindow.map((d) => usedUnitsOn(bookingItems, match.itemId, d, row.readiness_hours)));
    if (maxUsed > row.total_units) {
      warnings.push({ rowNumber: row.rowNumber, name: row.name, itemId: match.itemId, currentlyUsed: maxUsed, newTotalUnits: row.total_units });
    }
  }
  return warnings;
}

export function resolveDayRates(row: ParsedRow): ItemDayRates {
  return {
    price_per_day: row.price_per_day,
    day2_rate: row.day2_rate,
    day3_rate: row.day3_rate,
    day4_rate: row.day4_rate,
    day5_rate: row.day5_rate,
    extra_day_rate: row.extra_day_rate,
  };
}
