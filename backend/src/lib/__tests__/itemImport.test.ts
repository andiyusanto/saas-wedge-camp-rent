// Unit test untuk parsing impor alat (backend/src/lib/itemImport.ts) --
// review -c1 10 Nov 2026: replika persis bug tombol "Paket N hari" di
// ItemsScreen.tsx (packageDays.test.ts) -- sel Harga hari 2..6 yang
// kosong mewarisi tarif hari SEBELUMNYA, termasuk kalau itu 0. Baris
// paket "100000, 0, 0, 0, (kosong), 20000": Harga hari 5 ikut jadi 0
// (bukan 20000), sewa 5 hari = harga paket dan denda telat hari
// pertama Rp0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportFile } from '../itemImport.js';

const HEADER =
  'Nama alat*,Kode,Kategori,Varian,Ukuran,Warna,Jumlah unit*,Harga hari 1*,Harga hari 2,Harga hari 3,Harga hari 4,Harga hari 5,Harga hari 6 dst,Jeda persiapan (jam),Deskripsi,Link foto';

function csv(rows: string[]): Buffer {
  return Buffer.from([HEADER, ...rows].join('\n'), 'utf-8');
}

test('baris paket dengan sel kosong mewarisi Rp0 -> dapat peringatan, bukan error', async () => {
  // Paket 4 hari Rp100.000, hari 2-4 = 0 eksplisit, hari 5 DIKOSONGKAN
  // (bukan diisi 20000), hari 6 dst = 20000.
  const row = 'Paket QA,PKT-QA,Paket,,,,2,100000,0,0,0,,20000,0,,';
  const result = await parseImportFile(csv([row]), 'test.csv');

  assert.equal(result.fileLevelErrors.length, 0);
  assert.equal(result.rows.length, 1);
  const parsed = result.rows[0];
  assert.equal(parsed.match.kind, 'new'); // bukan 'skipped' -- peringatan tidak menolak baris
  assert.equal(parsed.row.day5_rate, 0); // mewarisi hari 4 (bug yang direplikasi)
  assert.equal(parsed.row.extra_day_rate, 20000);
  assert.ok(parsed.row.warning, 'baris ini harus punya warning');
  assert.match(parsed.row.warning!, /Rp0/);
});

test('baris paket diisi lengkap (tanpa sel kosong di tengah) -> tidak ada peringatan', async () => {
  const row = 'Paket QA Lengkap,PKT-QA2,Paket,,,,2,100000,0,0,0,20000,20000,0,,';
  const result = await parseImportFile(csv([row]), 'test.csv');

  const parsed = result.rows[0];
  assert.equal(parsed.row.day5_rate, 20000);
  assert.equal(parsed.row.warning, null);
});

test('alat flat biasa (semua kosong kecuali hari 1) -> tidak ada peringatan', async () => {
  const row = 'Headlamp QA,HL-QA,Penerangan,,,,10,5000,,,,,,0,,';
  const result = await parseImportFile(csv([row]), 'test.csv');

  const parsed = result.rows[0];
  assert.equal(parsed.row.day5_rate, 5000); // mewarisi rantai, tapi semuanya > 0 dari awal -- wajar
  assert.equal(parsed.row.warning, null);
});

test('tarif minus di Harga hari 2..6 ditolak sebagai error, bukan diam-diam dipakai', async () => {
  const row = 'Alat Minus,ALT-QA,Tas,,,,1,25000,-1000,,,,,0,,';
  const result = await parseImportFile(csv([row]), 'test.csv');

  const parsed = result.rows[0];
  assert.equal(parsed.match.kind, 'skipped');
  assert.match((parsed.match as { reason: string }).reason, /Harga hari 2.*minus/);
});

test('Jeda persiapan minus ditolak sebagai error', async () => {
  const row = 'Alat Jeda Minus,ALT-QA2,Tas,,,,1,25000,,,,,,-5,,';
  const result = await parseImportFile(csv([row]), 'test.csv');

  const parsed = result.rows[0];
  assert.equal(parsed.match.kind, 'skipped');
  assert.match((parsed.match as { reason: string }).reason, /Jeda persiapan.*minus/);
});
