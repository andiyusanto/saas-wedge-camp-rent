// Unit test encoder ESC/POS minimal (Cetak Printer Thermal v1, brief 16 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEscposBytes, sanitizeAscii, bytesToBase64 } from '../escpos.js';

test('buildEscposBytes diawali init (ESC @)', () => {
  const bytes = buildEscposBytes([{ kind: 'text', text: 'Halo' }]);
  assert.equal(bytes[0], 0x1b);
  assert.equal(bytes[1], 0x40);
});

test('buildEscposBytes diakhiri feed lalu full cut (GS V 1)', () => {
  const bytes = buildEscposBytes([{ kind: 'text', text: 'Halo' }]);
  const tail = Array.from(bytes.slice(-6));
  assert.deepEqual(tail, [0x1b, 0x64, 4, 0x1d, 0x56, 0x01]);
});

test('feed eksplisit mengeluarkan ESC d n', () => {
  const bytes = buildEscposBytes([{ kind: 'feed', lines: 3 }]);
  assert.ok(Array.from(bytes).includes(0x1b));
  const idx = Array.from(bytes).findIndex((b, i) => b === 0x1b && bytes[i + 1] === 0x64 && bytes[i + 2] === 3);
  assert.ok(idx >= 0, 'ESC d 3 tidak ditemukan');
});

test('sanitizeAscii mengganti karakter non-ASCII umum', () => {
  assert.equal(sanitizeAscii('Paket A ×2'), 'Paket A x2');
  assert.equal(sanitizeAscii('“kutip” – strip'), '"kutip" - strip');
  assert.equal(sanitizeAscii('Berhasil ✓'), 'Berhasil OK');
});

test('sanitizeAscii mempertahankan ASCII biasa apa adanya', () => {
  assert.equal(sanitizeAscii('Rp12.555 (2x)'), 'Rp12.555 (2x)');
});

test('bytesToBase64 menghasilkan base64 yang valid untuk bytes non-teks', () => {
  const bytes = new Uint8Array([0x1b, 0x40, 0x00, 0xff]);
  const b64 = bytesToBase64(bytes);
  assert.match(b64, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(Buffer.from(b64, 'base64').length, 4);
});
