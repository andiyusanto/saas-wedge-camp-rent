import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSchemeOption, settingsForSchemeOption, type RentalSchemeSettings } from '../rentalScheme';

// Tabel definisi eksplisit (koreksi koordinator poin 5, brief Pilih
// Skema Sewa 24 Nov 2026) -- tiap baris: input setelan -> opsi yang
// HARUS terdeteksi.
const TABLE: { label: string; input: RentalSchemeSettings; expectedKind: string }[] = [
  {
    label: 'per_hari: mode per_hari_kalender, label hari, tanpa min/max',
    input: { rental_day_mode: 'per_hari_kalender', duration_label_style: 'hari', min_rental_days: null, max_rental_days: null },
    expectedKind: 'per_hari',
  },
  {
    label: 'per_hari: label null ditafsirkan sama seperti "hari" (default lama, migration 072)',
    input: { rental_day_mode: 'per_hari_kalender', duration_label_style: null, min_rental_days: null, max_rental_days: null },
    expectedKind: 'per_hari',
  },
  {
    label: 'per_malam: mode per_malam, label hari, tanpa min/max',
    input: { rental_day_mode: 'per_malam', duration_label_style: 'hari', min_rental_days: null, max_rental_days: null },
    expectedKind: 'per_malam',
  },
  {
    label: 'paket N=3, maksimal kosong (tanpa batas)',
    input: { rental_day_mode: 'per_hari_kalender', duration_label_style: 'hari_malam', min_rental_days: 3, max_rental_days: null },
    expectedKind: 'paket',
  },
  {
    label: 'paket N=3, maksimal = N (hanya paket ini)',
    input: { rental_day_mode: 'per_hari_kalender', duration_label_style: 'hari_malam', min_rental_days: 3, max_rental_days: 3 },
    expectedKind: 'paket',
  },
  {
    label: 'paket N=2 (batas bawah valid)',
    input: { rental_day_mode: 'per_hari_kalender', duration_label_style: 'hari_malam', min_rental_days: 2, max_rental_days: null },
    expectedKind: 'paket',
  },
  // --- Kustom ---
  {
    label: 'kustom: per_malam TAPI punya min_rental_days (kombinasi tidak cocok opsi manapun)',
    input: { rental_day_mode: 'per_malam', duration_label_style: 'hari', min_rental_days: 3, max_rental_days: null },
    expectedKind: 'kustom',
  },
  {
    label: 'kustom: per_hari_kalender + label hari_malam TAPI min_rental_days null (bukan paket sungguhan)',
    input: { rental_day_mode: 'per_hari_kalender', duration_label_style: 'hari_malam', min_rental_days: null, max_rental_days: null },
    expectedKind: 'kustom',
  },
  {
    label: 'kustom: paket N=3 tapi maksimal beda dari N (mis. 5) -- bukan "tanpa batas" atau "hanya paket ini"',
    input: { rental_day_mode: 'per_hari_kalender', duration_label_style: 'hari_malam', min_rental_days: 3, max_rental_days: 5 },
    expectedKind: 'kustom',
  },
  {
    label: 'kustom: min_rental_days = 1 (di bawah ambang paket, brief minimal praktis adalah >=2 hari)',
    input: { rental_day_mode: 'per_hari_kalender', duration_label_style: 'hari_malam', min_rental_days: 1, max_rental_days: null },
    expectedKind: 'kustom',
  },
];

for (const row of TABLE) {
  test(`deriveSchemeOption: ${row.label}`, () => {
    assert.equal(deriveSchemeOption(row.input).kind, row.expectedKind);
  });
}

test('settingsForSchemeOption: per_hari menulis setelan yang benar', () => {
  assert.deepEqual(settingsForSchemeOption({ kind: 'per_hari' }), {
    rental_day_mode: 'per_hari_kalender',
    duration_label_style: 'hari',
    min_rental_days: null,
    max_rental_days: null,
  });
});

test('settingsForSchemeOption: paket N=3 tanpa batas vs hanya paket ini', () => {
  assert.deepEqual(settingsForSchemeOption({ kind: 'paket', days: 3, maxMode: 'tanpa_batas' }), {
    rental_day_mode: 'per_hari_kalender',
    duration_label_style: 'hari_malam',
    min_rental_days: 3,
    max_rental_days: null,
  });
  assert.deepEqual(settingsForSchemeOption({ kind: 'paket', days: 3, maxMode: 'hanya_paket' }), {
    rental_day_mode: 'per_hari_kalender',
    duration_label_style: 'hari_malam',
    min_rental_days: 3,
    max_rental_days: 3,
  });
});

test('round-trip: settingsForSchemeOption(opt) lalu deriveSchemeOption kembali ke opsi yang sama', () => {
  const options = [
    { kind: 'per_hari' as const },
    { kind: 'per_malam' as const },
    { kind: 'paket' as const, days: 2, maxMode: 'tanpa_batas' as const },
    { kind: 'paket' as const, days: 5, maxMode: 'hanya_paket' as const },
  ];
  for (const opt of options) {
    const settings = settingsForSchemeOption(opt);
    assert.equal(deriveSchemeOption(settings).kind, opt.kind);
  }
});
