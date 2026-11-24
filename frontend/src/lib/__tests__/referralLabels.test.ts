import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFERRAL_STATUS_LABEL } from '../referralLabels';
import type { ReferralRow } from '../../hooks/useReferrals';

// Keputusan Andi 24 Nov 2026: batas 10 bonus referral/tahun DIHAPUS
// (migration 075) -- ajakan ke-11 dst tetap berstatus 'siap_diklaim'
// persis seperti ajakan pertama, tidak ada status/label "melewati batas"
// yang boleh tampil lagi di mana pun. Logika cap-nya sendiri ada di SQL
// (apply_referral_signup_bonus), jadi yang diverifikasi di sini adalah
// KONTRAK TAMPILAN frontend: label untuk status apa pun (termasuk baris
// lama 'melewati_batas' yang masih ada di CHECK constraint tapi tidak
// terpakai) tidak pernah berbeda dari status "sudah daftar" biasa.
function buildReferralRow(overrides: Partial<ReferralRow>): ReferralRow {
  return {
    id: 'r-1',
    referred_business_name: 'Rental Contoh',
    status: 'siap_diklaim',
    created_at: '2026-11-24T00:00:00Z',
    first_payment_at: null,
    claimed_at: null,
    ...overrides,
  };
}

test('ajakan ke-11+ (tanpa batas tahunan) tetap diberi label "Bonus siap diklaim"', () => {
  const manyReferrals: ReferralRow[] = Array.from({ length: 15 }, (_, i) =>
    buildReferralRow({ id: `r-${i + 1}`, status: 'siap_diklaim' }),
  );

  for (const row of manyReferrals) {
    assert.equal(REFERRAL_STATUS_LABEL[row.status], 'Bonus siap diklaim');
  }
});

test('status legacy "melewati_batas" tidak punya label sendiri -- jatuh ke teks "sudah daftar"', () => {
  assert.equal(REFERRAL_STATUS_LABEL.melewati_batas, REFERRAL_STATUS_LABEL.terdaftar);
});

test('tidak ada status apa pun yang berlabel menyebut "batas"', () => {
  for (const label of Object.values(REFERRAL_STATUS_LABEL)) {
    assert.ok(!label.toLowerCase().includes('batas'), `label "${label}" tidak boleh menyebut "batas"`);
  }
});
