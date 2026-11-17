// Unit test validasi rekening bank (koordinator 17 Nov 2026, susulan
// brief Lebih dari Satu Rekening Bank) -- diekstrak dari
// EtalaseOnlineScreen.tsx supaya bisa diuji tanpa React.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBankAccount, validateBankAccounts } from '../bankAccount.js';

function acc(overrides: Partial<{ bank_name: string; account_number: string; account_holder: string }>) {
  return { bank_name: 'BCA', account_number: '123 456 789', account_holder: 'Budi', ...overrides };
}

test('validateBankAccount: rekening lengkap dan valid -> null', () => {
  assert.equal(validateBankAccount(acc({})), null);
});

test('validateBankAccount: nama bank kosong -> ditolak', () => {
  assert.notEqual(validateBankAccount(acc({ bank_name: '' })), null);
  assert.notEqual(validateBankAccount(acc({ bank_name: '   ' })), null);
});

test('validateBankAccount: nama pemilik kosong -> ditolak', () => {
  assert.notEqual(validateBankAccount(acc({ account_holder: '' })), null);
});

test('validateBankAccount: nomor rekening kosong -> ditolak', () => {
  assert.notEqual(validateBankAccount(acc({ account_number: '' })), null);
});

test('validateBankAccount: nomor rekening mengandung huruf/simbol lain -> ditolak', () => {
  assert.notEqual(validateBankAccount(acc({ account_number: '123-ABC' })), null);
  assert.notEqual(validateBankAccount(acc({ account_number: '123/456' })), null);
});

test('validateBankAccount: nomor rekening boleh angka, spasi, strip (kombinasi apa pun)', () => {
  assert.equal(validateBankAccount(acc({ account_number: '000-111-222' })), null);
  assert.equal(validateBankAccount(acc({ account_number: '0001112223' })), null);
  assert.equal(validateBankAccount(acc({ account_number: '000 111 222' })), null);
});

test('validateBankAccounts: array kosong -> ditolak (transfer aktif wajib minimal 1)', () => {
  assert.notEqual(validateBankAccounts([]), null);
});

test('validateBankAccounts: 1, 3, dan 5 rekening valid semua -> null', () => {
  assert.equal(validateBankAccounts([acc({})]), null);
  assert.equal(validateBankAccounts([acc({}), acc({ bank_name: 'Mandiri' }), acc({ bank_name: 'BNI' })]), null);
  assert.equal(
    validateBankAccounts([acc({}), acc({ bank_name: 'B2' }), acc({ bank_name: 'B3' }), acc({ bank_name: 'B4' }), acc({ bank_name: 'B5' })]),
    null,
  );
});

test('validateBankAccounts: satu rekening tidak valid di tengah daftar -> ditolak', () => {
  assert.notEqual(validateBankAccounts([acc({}), acc({ bank_name: '' }), acc({})]), null);
});
