// Unit test untuk resolveBankAccountsForDisplay() (koordinator 17 Nov
// 2026, susulan brief Lebih dari Satu Rekening Bank) -- jalur
// kompatibilitas mundur paling rawan: snapshot pesanan LAMA (dari
// sebelum migration 069) cuma punya 3 field flat, snapshot BARU punya
// bank_accounts (array).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBankAccountsForDisplay } from '../paymentSnapshot.js';

test('resolveBankAccountsForDisplay: snapshot BARU dengan bank_accounts -> dipakai apa adanya', () => {
  const result = resolveBankAccountsForDisplay({
    bank_accounts: [
      { bank_name: 'Bank A', account_number: '111', account_holder: 'Budi' },
      { bank_name: 'Bank B', account_number: '222', account_holder: 'Budi' },
    ],
    // Field lama ikut ada (duplikat sengaja, migration 069 bagian 4) --
    // HARUS diabaikan kalau bank_accounts sudah terisi.
    bank_name: 'Bank A',
    bank_account_number: '111',
    bank_account_holder: 'Budi',
  });
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { bank_name: 'Bank A', account_number: '111', account_holder: 'Budi' });
});

test('resolveBankAccountsForDisplay: snapshot LAMA (flat, tanpa bank_accounts) -> fallback array 1 elemen', () => {
  const result = resolveBankAccountsForDisplay({
    bank_name: 'Bank Lama',
    bank_account_number: '999',
    bank_account_holder: 'Siti',
  });
  assert.deepEqual(result, [{ bank_name: 'Bank Lama', account_number: '999', account_holder: 'Siti' }]);
});

test('resolveBankAccountsForDisplay: snapshot LAMA dengan field opsional kosong -> string kosong, bukan undefined', () => {
  const result = resolveBankAccountsForDisplay({ bank_name: 'Bank Lama' });
  assert.deepEqual(result, [{ bank_name: 'Bank Lama', account_number: '', account_holder: '' }]);
});

test('resolveBankAccountsForDisplay: Transfer Bank tidak pernah aktif (tunai/QRIS saja) -> array kosong', () => {
  assert.deepEqual(resolveBankAccountsForDisplay({ qris_image_url: 'https://x' } as never), []);
  assert.deepEqual(resolveBankAccountsForDisplay(null), []);
  assert.deepEqual(resolveBankAccountsForDisplay(undefined), []);
});

test('resolveBankAccountsForDisplay: bank_accounts array KOSONG -> fallback ke flat, bukan dianggap "ada"', () => {
  const result = resolveBankAccountsForDisplay({
    bank_accounts: [],
    bank_name: 'Bank Fallback',
    bank_account_number: '555',
    bank_account_holder: 'Fallback',
  });
  assert.deepEqual(result, [{ bank_name: 'Bank Fallback', account_number: '555', account_holder: 'Fallback' }]);
});
