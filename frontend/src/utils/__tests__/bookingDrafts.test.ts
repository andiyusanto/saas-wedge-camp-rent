// Draf Transaksi / Keranjang (brief 23 Nov 2026) -- unit test serialisasi/
// deserialisasi, maks draf + eviction draf tertua, kedaluwarsa, dan
// localStorage gagal/penuh (harus tidak melempar, form tetap jalan tanpa
// draf). Node test env tidak punya localStorage bawaan -- dipolyfill
// dengan fake in-memory Map sebelum modul diimpor (fungsi di
// useBookingDrafts.ts cuma membaca `localStorage` di DALAM body fungsi,
// jadi urutan import vs polyfill tidak masalah).
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeStorage {
  private store = new Map<string, string>();
  shouldThrow = false;
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.shouldThrow) throw new Error('QuotaExceededError');
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const fake = new FakeStorage();
(globalThis as any).localStorage = fake;

const {
  saveBookingDraft,
  listBookingDrafts,
  getBookingDraft,
  deleteBookingDraft,
  deleteAllBookingDrafts,
  clearAllBookingDraftsOnLogout,
  isDraftDataMeaningless,
} = await import('../../hooks/useBookingDrafts.js');

function blankData(overrides: Partial<Parameters<typeof saveBookingDraft>[5]> = {}) {
  return {
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    selectedCustomerId: null,
    applyDiscount: true,
    startDate: '2026-11-24',
    endDate: '2026-11-25',
    pickedUpNow: false,
    quantities: {},
    bundleQuantities: {},
    bundleInstanceIds: {},
    bundleComponentOverrides: {},
    saleQuantities: {},
    depositType: 'ktp',
    depositNote: '',
    depositAmount: '',
    noDepositConfirmed: false,
    dpPaid: '0',
    dpMethod: '',
    autoOpenWA: true,
    hadPhoto: false,
    ...overrides,
  };
}

test('isDraftDataMeaningless: kosong beneran -> true, ada nama/alat -> false', () => {
  assert.equal(isDraftDataMeaningless(blankData()), true);
  assert.equal(isDraftDataMeaningless(blankData({ customerName: 'Budi' })), false);
  assert.equal(isDraftDataMeaningless(blankData({ quantities: { 'item-1': 1 } })), false);
  assert.equal(isDraftDataMeaningless(blankData({ bundleQuantities: { 'b-1': 1 } })), false);
  assert.equal(isDraftDataMeaningless(blankData({ saleQuantities: { 's-1': 1 } })), false);
});

test('saveBookingDraft + getBookingDraft: round-trip serialisasi/deserialisasi utuh', () => {
  fake.shouldThrow = false;
  deleteAllBookingDrafts('biz-rt');
  const data = blankData({ customerName: 'Rina', quantities: { 'item-1': 2 } });
  const { id, persisted } = saveBookingDraft('biz-rt', null, 'Rina', 2, 150000, data);
  assert.equal(persisted, true);
  const loaded = getBookingDraft('biz-rt', id);
  assert.ok(loaded);
  assert.deepEqual(loaded!.data, data);
  assert.equal(loaded!.label, 'Rina');
  assert.equal(loaded!.totalPreview, 150000);
});

test('saveBookingDraft dengan existingId: UPDATE di tempat, bukan bikin baris baru', () => {
  deleteAllBookingDrafts('biz-update');
  const { id } = saveBookingDraft('biz-update', null, 'Budi', 1, 50000, blankData({ customerName: 'Budi' }));
  saveBookingDraft('biz-update', id, 'Budi', 2, 90000, blankData({ customerName: 'Budi', quantities: { x: 1 } }));
  const list = listBookingDrafts('biz-update');
  assert.equal(list.length, 1);
  assert.equal(list[0].totalPreview, 90000);
});

test('maks 10 draf -- draf tertua dibuang (eviction), bukan ditolak', () => {
  deleteAllBookingDrafts('biz-evict');
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const { id } = saveBookingDraft('biz-evict', null, `Pelanggan ${i}`, 1, 1000, blankData({ customerName: `Pelanggan ${i}` }));
    ids.push(id);
  }
  const { evictedLabel } = saveBookingDraft('biz-evict', null, 'Pelanggan ke-11', 1, 1000, blankData({ customerName: 'Pelanggan ke-11' }));
  const list = listBookingDrafts('biz-evict');
  assert.equal(list.length, 10);
  assert.equal(evictedLabel, 'Pelanggan 0');
  assert.ok(!list.some((d) => d.id === ids[0]));
});

test('draf kedaluwarsa (>3 hari) dibersihkan otomatis saat dibaca', () => {
  deleteAllBookingDrafts('biz-expiry');
  const { id } = saveBookingDraft('biz-expiry', null, 'Lama', 1, 1000, blankData());
  // Paksa updatedAt jadi 4 hari lalu langsung di storage (tanpa API publik
  // untuk itu -- baca+tulis manual lewat key yang sama dengan modul).
  const raw = JSON.parse(fake.getItem('sewalog_booking_drafts_v1')!);
  raw['biz-expiry'][0].updatedAt = Date.now() - 4 * 24 * 60 * 60 * 1000;
  fake.setItem('sewalog_booking_drafts_v1', JSON.stringify(raw));
  const list = listBookingDrafts('biz-expiry');
  assert.equal(list.length, 0);
  assert.equal(getBookingDraft('biz-expiry', id), null);
});

test('deleteBookingDraft: cuma menghapus draf yang dipilih', () => {
  deleteAllBookingDrafts('biz-del');
  const { id: id1 } = saveBookingDraft('biz-del', null, 'A', 1, 1, blankData({ customerName: 'A' }));
  const { id: id2 } = saveBookingDraft('biz-del', null, 'B', 1, 1, blankData({ customerName: 'B' }));
  deleteBookingDraft('biz-del', id1);
  const list = listBookingDrafts('biz-del');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id2);
});

test('draf business lain tidak terlihat (terisolasi per business)', () => {
  deleteAllBookingDrafts('biz-a');
  deleteAllBookingDrafts('biz-b');
  saveBookingDraft('biz-a', null, 'A', 1, 1, blankData({ customerName: 'A' }));
  assert.equal(listBookingDrafts('biz-b').length, 0);
  assert.equal(listBookingDrafts('biz-a').length, 1);
});

test('clearAllBookingDraftsOnLogout: menghapus draf LINTAS semua business', () => {
  deleteAllBookingDrafts('biz-x');
  deleteAllBookingDrafts('biz-y');
  saveBookingDraft('biz-x', null, 'X', 1, 1, blankData({ customerName: 'X' }));
  saveBookingDraft('biz-y', null, 'Y', 1, 1, blankData({ customerName: 'Y' }));
  clearAllBookingDraftsOnLogout();
  assert.equal(listBookingDrafts('biz-x').length, 0);
  assert.equal(listBookingDrafts('biz-y').length, 0);
});

test('localStorage gagal/penuh saat menyimpan: tidak melempar, persisted=false', () => {
  deleteAllBookingDrafts('biz-fail');
  fake.shouldThrow = false; // izinkan delete di atas dulu
  fake.shouldThrow = true;
  assert.doesNotThrow(() => {
    const { persisted } = saveBookingDraft('biz-fail', null, 'Gagal', 1, 1, blankData({ customerName: 'Gagal' }));
    assert.equal(persisted, false);
  });
  fake.shouldThrow = false;
});
