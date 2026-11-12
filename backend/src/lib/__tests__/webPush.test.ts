// Unit test notifikasi push (v1) — research/brief-notifikasi-push-2026-11.md.
// Dua hal yang WAJIB benar tanpa perlu mock web-push/supabase: isi
// payload (format tanggal dd-mm, TANPA nomor WA/harga/alamat) dan kapan
// subscription dihapus (404/410 saja).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNewOrderPayload, shouldRemoveSubscription } from '../webPush.js';

test('buildNewOrderPayload: format dd-mm, tanpa nomor WA/harga/alamat', () => {
  const payload = buildNewOrderPayload({
    customerName: 'Budi Santoso',
    itemCount: 3,
    startDate: '2026-11-15',
    endDate: '2026-11-18',
  });

  assert.equal(payload.title, 'Pesanan baru dari Etalase Online');
  assert.equal(payload.body, 'Budi Santoso · 3 alat · 15-11 → 18-11');
  assert.doesNotMatch(payload.body, /\d{8,}/); // tidak ada nomor telepon
  assert.doesNotMatch(payload.body, /rp|rupiah/i); // tidak ada harga
});

test('buildNewOrderPayload: tanggal tahun baru tetap dd-mm (bukan ikut tahun)', () => {
  const payload = buildNewOrderPayload({
    customerName: 'Siti',
    itemCount: 1,
    startDate: '2026-12-31',
    endDate: '2027-01-02',
  });
  assert.equal(payload.body, 'Siti · 1 alat · 31-12 → 02-01');
});

test('shouldRemoveSubscription: hapus hanya untuk 404/410', () => {
  assert.equal(shouldRemoveSubscription(404), true);
  assert.equal(shouldRemoveSubscription(410), true);
  assert.equal(shouldRemoveSubscription(500), false);
  assert.equal(shouldRemoveSubscription(400), false);
  assert.equal(shouldRemoveSubscription(undefined), false);
});
