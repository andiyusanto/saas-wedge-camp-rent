import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidPaymentPlanValue, isPaymentMethodActiveForPage, sanitizePaymentPlan } from '../paymentPlan.js';

test('isValidPaymentPlanValue: hanya transfer/qris/cash yang valid', () => {
  assert.equal(isValidPaymentPlanValue('transfer'), true);
  assert.equal(isValidPaymentPlanValue('qris'), true);
  assert.equal(isValidPaymentPlanValue('cash'), true);
  assert.equal(isValidPaymentPlanValue('tunai'), false); // vocabulary BEDA (dp_method), bukan payment_plan
  assert.equal(isValidPaymentPlanValue(''), false);
  assert.equal(isValidPaymentPlanValue(null), false);
  assert.equal(isValidPaymentPlanValue(undefined), false);
  assert.equal(isValidPaymentPlanValue(123), false);
});

test('isPaymentMethodActiveForPage: ditolak kalau cara bayar itu tidak aktif di rental', () => {
  const page = { pay_transfer_enabled: true, pay_qris_enabled: false, pay_cash_enabled: false };
  assert.equal(isPaymentMethodActiveForPage('transfer', page), true);
  assert.equal(isPaymentMethodActiveForPage('qris', page), false);
  assert.equal(isPaymentMethodActiveForPage('cash', page), false);
});

test('isPaymentMethodActiveForPage: nilai tidak valid selalu ditolak apa pun pengaturan rentalnya', () => {
  const allEnabled = { pay_transfer_enabled: true, pay_qris_enabled: true, pay_cash_enabled: true };
  assert.equal(isPaymentMethodActiveForPage('bitcoin', allEnabled), false);
  assert.equal(isPaymentMethodActiveForPage('', allEnabled), false);
  assert.equal(isPaymentMethodActiveForPage(null, allEnabled), false);
});

test('sanitizePaymentPlan: nilai valid diteruskan, nilai tidak valid jadi null', () => {
  assert.equal(sanitizePaymentPlan('qris'), 'qris');
  assert.equal(sanitizePaymentPlan('tunai'), null);
  assert.equal(sanitizePaymentPlan(undefined), null);
  assert.equal(sanitizePaymentPlan(''), null);
});
