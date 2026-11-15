// Unit test untuk Ubah Alat (migration 061, brief 14 Nov 2026) —
// mergeBookingItemsForUpdate(): alat existing pakai tarif SNAPSHOT
// lama apa adanya, alat baru pakai tarif katalog SAAT INI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBookingItemsForUpdate, type ExistingBookingItemRow, type CatalogItemRow } from '../bookingItems.js';

// Alat A sudah ada di booking dengan tarif SNAPSHOT lama (katalog
// sekarang sudah berbeda, sengaja — supaya tes membuktikan snapshot
// LAMA yang dipakai, bukan katalog sekarang).
const existingItemA: ExistingBookingItemRow = {
  item_id: 'item-a',
  quantity: 1,
  price_at_booking: 30_000, // tarif snapshot lama
  day2_rate_at_booking: 20_000,
  day3_rate_at_booking: 10_000,
  day4_rate_at_booking: 10_000,
  day5_rate_at_booking: 10_000,
  extra_day_rate_at_booking: 10_000,
};

const catalogItemA: CatalogItemRow = {
  id: 'item-a',
  price_per_day: 50_000, // katalog SEKARANG sudah naik -- tidak boleh dipakai untuk alat existing
  day2_rate: 50_000,
  day3_rate: 50_000,
  day4_rate: 50_000,
  day5_rate: 50_000,
  extra_day_rate: 50_000,
};

const catalogItemB: CatalogItemRow = {
  id: 'item-b',
  price_per_day: 15_000,
  day2_rate: 10_000,
  day3_rate: 10_000,
  day4_rate: 10_000,
  day5_rate: 10_000,
  extra_day_rate: 10_000,
};

test('alat existing tetap pakai tarif SNAPSHOT lama, bukan katalog sekarang', () => {
  const result = mergeBookingItemsForUpdate(
    [{ item_id: 'item-a', quantity: 1 }],
    [existingItemA],
    [catalogItemA],
    3, // 3 hari
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].price_at_booking, 30_000); // snapshot lama, BUKAN 50_000 katalog sekarang
  // 3 hari: 30rb + 20rb + 10rb = 60rb
  assert.equal(result.items[0].subtotal, 60_000);
});

test('alat baru (belum pernah ada di booking) pakai tarif katalog SAAT INI', () => {
  const result = mergeBookingItemsForUpdate(
    [{ item_id: 'item-b', quantity: 2 }],
    [existingItemA], // item-b belum ada di existing
    [catalogItemA, catalogItemB],
    2, // 2 hari
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].price_at_booking, 15_000); // dari katalog
  // 2 hari x 2 unit: (15rb + 10rb) * 2 = 50rb
  assert.equal(result.items[0].subtotal, 50_000);
});

test('campuran: alat existing (snapshot) + alat baru (katalog) dalam satu panggilan', () => {
  const result = mergeBookingItemsForUpdate(
    [
      { item_id: 'item-a', quantity: 1 },
      { item_id: 'item-b', quantity: 1 },
    ],
    [existingItemA],
    [catalogItemA, catalogItemB],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const a = result.items.find((i) => i.item_id === 'item-a')!;
  const b = result.items.find((i) => i.item_id === 'item-b')!;
  assert.equal(a.price_at_booking, 30_000);
  assert.equal(b.price_at_booking, 15_000);
});

test('ubah jumlah alat existing TIDAK mengubah tarif snapshot-nya', () => {
  const result = mergeBookingItemsForUpdate([{ item_id: 'item-a', quantity: 5 }], [existingItemA], [catalogItemA], 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0].price_at_booking, 30_000);
  assert.equal(result.items[0].subtotal, 30_000 * 5);
});

test('item_id tidak ditemukan di existing maupun katalog -> error', () => {
  const result = mergeBookingItemsForUpdate([{ item_id: 'item-ghost', quantity: 1 }], [existingItemA], [catalogItemA], 1);
  assert.equal(result.ok, false);
});

test('daftar alat kosong -> error "minimal satu alat"', () => {
  const result = mergeBookingItemsForUpdate([], [existingItemA], [catalogItemA], 1);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /minimal satu alat/i);
});

test('quantity bukan bilangan bulat positif -> error', () => {
  assert.equal(mergeBookingItemsForUpdate([{ item_id: 'item-a', quantity: 0 }], [existingItemA], [catalogItemA], 1).ok, false);
  assert.equal(
    mergeBookingItemsForUpdate([{ item_id: 'item-a', quantity: 1.5 }], [existingItemA], [catalogItemA], 1).ok,
    false,
  );
  assert.equal(
    mergeBookingItemsForUpdate([{ item_id: 'item-a', quantity: -1 }], [existingItemA], [catalogItemA], 1).ok,
    false,
  );
});

test('menghapus alat (tidak ikut dikirim di requested) -> tidak muncul di hasil merge', () => {
  const result = mergeBookingItemsForUpdate([{ item_id: 'item-b', quantity: 1 }], [existingItemA], [catalogItemA, catalogItemB], 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.find((i) => i.item_id === 'item-a'), undefined);
});

// Paket Alat Tahap 1 (brief 15 Nov 2026, migration 064) -- aturan
// pelepasan penanda bundle (koordinator 15 Nov 2026): grup instance
// yang TIDAK disentuh sama sekali tetap mempertahankan penanda; begitu
// SATU baris grup berubah quantity atau dihapus, SEMUA baris sisa grup
// itu dilepas (bundle_* -> null).
const bundleComponentX: ExistingBookingItemRow = {
  item_id: 'tenda',
  quantity: 1,
  price_at_booking: 30_000,
  day2_rate_at_booking: 20_000,
  day3_rate_at_booking: 10_000,
  day4_rate_at_booking: 10_000,
  day5_rate_at_booking: 10_000,
  extra_day_rate_at_booking: 10_000,
  bundle_id: 'bundle-1',
  bundle_instance_id: 'instance-1',
  bundle_name: 'Paket Tektok',
  bundle_quantity: 1,
};
const bundleComponentY: ExistingBookingItemRow = {
  item_id: 'carrier',
  quantity: 1,
  price_at_booking: 20_000,
  day2_rate_at_booking: 20_000,
  day3_rate_at_booking: 20_000,
  day4_rate_at_booking: 20_000,
  day5_rate_at_booking: 20_000,
  extra_day_rate_at_booking: 20_000,
  bundle_id: 'bundle-1',
  bundle_instance_id: 'instance-1',
  bundle_name: 'Paket Tektok',
  bundle_quantity: 1,
};

test('grup paket TIDAK disentuh sama sekali -> penanda dipertahankan di semua baris', () => {
  const result = mergeBookingItemsForUpdate(
    [
      { item_id: 'tenda', quantity: 1, bundle_instance_id: 'instance-1' },
      { item_id: 'carrier', quantity: 1, bundle_instance_id: 'instance-1' },
    ],
    [bundleComponentX, bundleComponentY],
    [],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const item of result.items) {
    assert.equal(item.bundle_id, 'bundle-1');
    assert.equal(item.bundle_instance_id, 'instance-1');
    assert.equal(item.bundle_name, 'Paket Tektok');
  }
});

test('satu baris grup paket diubah quantity -> penanda dilepas di SEMUA baris sisa grup', () => {
  const result = mergeBookingItemsForUpdate(
    [
      // bundle_instance_id tetap dikirim (supaya server bisa menemukan
      // snapshot rates baris existing-nya) meski quantity-nya diubah --
      // server sendiri yang MEMUTUSKAN pelepasan penanda lewat
      // groupsToRelease, bukan klien yang berhenti mengirim instance id.
      { item_id: 'tenda', quantity: 2, bundle_instance_id: 'instance-1' }, // tenda berubah dari 1 -> 2
      { item_id: 'carrier', quantity: 1, bundle_instance_id: 'instance-1' },
    ],
    [bundleComponentX, bundleComponentY],
    [],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const item of result.items) {
    assert.equal(item.bundle_id, null);
    assert.equal(item.bundle_instance_id, null);
    assert.equal(item.bundle_name, null);
  }
});

test('satu baris grup paket DIHAPUS (tidak ikut dikirim) -> penanda dilepas di baris yang tersisa', () => {
  const result = mergeBookingItemsForUpdate(
    [{ item_id: 'tenda', quantity: 1, bundle_instance_id: 'instance-1' }], // carrier dihapus
    [bundleComponentX, bundleComponentY],
    [],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0].item_id, 'tenda');
  assert.equal(result.items[0].bundle_id, null);
});

test('alat BARU yang ditambahkan lewat Ubah Alat tidak pernah dapat penanda bundle', () => {
  const result = mergeBookingItemsForUpdate(
    [
      { item_id: 'tenda', quantity: 1, bundle_instance_id: 'instance-1' },
      { item_id: 'carrier', quantity: 1, bundle_instance_id: 'instance-1' },
      { item_id: 'item-b', quantity: 1 },
    ],
    [bundleComponentX, bundleComponentY],
    [catalogItemB],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const newItem = result.items.find((i) => i.item_id === 'item-b')!;
  assert.equal(newItem.bundle_id, null);
  // Grup paket asli (tenda+carrier) tidak disentuh -> tetap dipertahankan.
  assert.equal(result.items.find((i) => i.item_id === 'tenda')!.bundle_id, 'bundle-1');
});

// Skenario WAJIB koordinator 15 Nov 2026: pelanggan memilih paket LALU
// menambah alat lain yang item_id-nya SAMA dengan salah satu komponen
// paket (mis. paket berisi 1 matras, pelanggan tambah 1 matras lagi,
// harga beda -- jadi harus TETAP 2 baris, bukan digabung).
const bundleMatras: ExistingBookingItemRow = {
  item_id: 'matras',
  quantity: 1,
  price_at_booking: 15_000, // tarif TERSKALA paket (rasio != 1, beda dari plain)
  day2_rate_at_booking: 15_000,
  day3_rate_at_booking: 15_000,
  day4_rate_at_booking: 15_000,
  day5_rate_at_booking: 15_000,
  extra_day_rate_at_booking: 15_000,
  bundle_id: 'bundle-1',
  bundle_instance_id: 'instance-1',
  bundle_name: 'Paket Tektok',
  bundle_quantity: 1,
};
const plainMatrasTambahan: ExistingBookingItemRow = {
  item_id: 'matras',
  quantity: 1,
  price_at_booking: 20_000, // tarif KATALOG ASLI (beda dari harga dalam paket)
  day2_rate_at_booking: 20_000,
  day3_rate_at_booking: 20_000,
  day4_rate_at_booking: 20_000,
  day5_rate_at_booking: 20_000,
  extra_day_rate_at_booking: 20_000,
  bundle_id: null,
  bundle_instance_id: null,
  bundle_name: null,
  bundle_quantity: null,
};

test('dua baris item_id SAMA (komponen paket + alat tambahan biasa) tidak saling menimpa', () => {
  const result = mergeBookingItemsForUpdate(
    [
      { item_id: 'matras', quantity: 1, bundle_instance_id: 'instance-1' }, // baris paket, tidak disentuh
      { item_id: 'matras', quantity: 1 }, // baris tambahan biasa, tidak disentuh
    ],
    [bundleMatras, plainMatrasTambahan],
    [],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 2);
  const bundleLine = result.items.find((i) => i.bundle_id === 'bundle-1');
  const plainLine = result.items.find((i) => i.bundle_id === null);
  assert.ok(bundleLine, 'baris paket harus tetap ada');
  assert.ok(plainLine, 'baris tambahan biasa harus tetap ada');
  assert.equal(bundleLine!.price_at_booking, 15_000); // tarif paket, tidak tertimpa
  assert.equal(plainLine!.price_at_booking, 20_000); // tarif katalog asli, tidak tertimpa
});

test('menambah alat tambahan ke booking berisi paket -> baris baru tanpa penanda, paket tetap utuh', () => {
  const result = mergeBookingItemsForUpdate(
    [
      { item_id: 'tenda', quantity: 1, bundle_instance_id: 'instance-1' },
      { item_id: 'carrier', quantity: 1, bundle_instance_id: 'instance-1' },
      { item_id: 'matras', quantity: 1 }, // alat tambahan baru, item_id BERBEDA dari komponen paket di sini
    ],
    [bundleComponentX, bundleComponentY],
    [{ id: 'matras', price_per_day: 20_000, day2_rate: 20_000, day3_rate: 20_000, day4_rate: 20_000, day5_rate: 20_000, extra_day_rate: 20_000 }],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.find((i) => i.item_id === 'tenda')!.bundle_id, 'bundle-1');
  assert.equal(result.items.find((i) => i.item_id === 'carrier')!.bundle_id, 'bundle-1');
  assert.equal(result.items.find((i) => i.item_id === 'matras')!.bundle_id, null);
});

test('menghapus alat tambahan (bukan komponen paket) -> penanda paket tetap utuh', () => {
  // Paket tenda+carrier (instance-1) + tambahan matras plain -> matras dihapus.
  const result = mergeBookingItemsForUpdate(
    [
      { item_id: 'tenda', quantity: 1, bundle_instance_id: 'instance-1' },
      { item_id: 'carrier', quantity: 1, bundle_instance_id: 'instance-1' },
    ],
    [bundleComponentX, bundleComponentY, { ...plainMatrasTambahan }],
    [],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 2);
  assert.equal(result.items.find((i) => i.item_id === 'tenda')!.bundle_id, 'bundle-1');
  assert.equal(result.items.find((i) => i.item_id === 'carrier')!.bundle_id, 'bundle-1');
});

test('override total manual pada transaksi paket+tambahan -> merge tidak menimpa (total dihitung di layer PATCH, bukan di sini)', () => {
  // mergeBookingItemsForUpdate hanya menghitung subtotal PER BARIS;
  // override total_price ditegakkan di routes/trackings.ts (newTotalPrice
  // = total_price ?? sum(merged.items.subtotal)) -- tes ini memastikan
  // subtotal per baris tidak berubah terlepas dari override di layer atas.
  const result = mergeBookingItemsForUpdate(
    [
      { item_id: 'tenda', quantity: 1, bundle_instance_id: 'instance-1' },
      { item_id: 'carrier', quantity: 1, bundle_instance_id: 'instance-1' },
      { item_id: 'matras', quantity: 1 },
    ],
    [bundleComponentX, bundleComponentY],
    [{ id: 'matras', price_per_day: 20_000, day2_rate: 20_000, day3_rate: 20_000, day4_rate: 20_000, day5_rate: 20_000, extra_day_rate: 20_000 }],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const computedSum = result.items.reduce((s, i) => s + i.subtotal, 0);
  assert.equal(computedSum, 30_000 + 20_000 + 20_000); // tenda+carrier snapshot (1 hari) + matras katalog
});

// Skenario WAJIB koordinator (komponen paket dikurangi/dihapus): jumlah
// alokasi BARIS SISA + porsi yang dihapus harus persis sama dengan total
// paket semula -- dibuktikan lewat allocateBundlePrice (pricing.test.ts
// punya tes alokasi umum; di sini dibuktikan di level merge: baris sisa
// grup yang DILEPAS tetap pakai snapshot *_at_booking RATIO-nya sendiri
// (tidak direcompute ke tarif katalog), jadi subtotal baris sisa TIDAK
// berubah akibat baris lain di grup yang sama dihapus).
test('komponen paket dihapus -> baris SISA tetap pakai snapshot rasio alokasinya sendiri (subtotal tidak berubah)', () => {
  const result = mergeBookingItemsForUpdate(
    [{ item_id: 'tenda', quantity: 1, bundle_instance_id: 'instance-1' }], // carrier (komponen lain) dihapus
    [bundleComponentX, bundleComponentY],
    [],
    1,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  // tenda snapshot (1 hari) = 30_000, TIDAK berubah walau carrier dihapus
  // dari grup yang sama -- bukti "harga teralokasi" tenda independen dari
  // komponen lain di grupnya.
  assert.equal(result.items[0].subtotal, 30_000);
  assert.equal(result.items[0].bundle_id, null); // tapi penanda tetap dilepas (grup tidak intact lagi)
});

// Skenario WAJIB koordinator ("Alat Dalam Paket Dikurangi", Ubah Alat
// poin B): kuantitas komponen DIKURANGI (bukan dihapus total) -> total
// turun PERSIS proporsional (snapshot *_at_booking sudah ratio-scaled
// sejak POST /bookings, lihat pricing.test.ts
// computeBundleComponentRatesSnapshot -- subtotal = quantity baru ×
// computeItemRentalPrice(scaledRates, days), linear terhadap quantity).
const bundleHeadlamp2x: ExistingBookingItemRow = {
  item_id: 'headlamp',
  quantity: 2,
  price_at_booking: 2_500, // sudah tarif TERSKALA paket (rasio 0.5 dari katalog 5000)
  day2_rate_at_booking: 2_500,
  day3_rate_at_booking: 2_500,
  day4_rate_at_booking: 2_500,
  day5_rate_at_booking: 2_500,
  extra_day_rate_at_booking: 2_500,
  bundle_id: 'bundle-1',
  bundle_instance_id: 'instance-2',
  bundle_name: 'Paket Tektok',
  bundle_quantity: 1,
};

test('kuantitas komponen paket DIKURANGI (2 -> 1) -> subtotal turun PERSIS proporsional, penanda dilepas', () => {
  const result = mergeBookingItemsForUpdate(
    [{ item_id: 'headlamp', quantity: 1, bundle_instance_id: 'instance-2' }],
    [bundleHeadlamp2x],
    [],
    1, // 1 hari
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // 1 hari x 1 unit x 2500 = 2500 -- PERSIS separuh dari subtotal asli
  // (1 hari x 2 unit x 2500 = 5000), linear terhadap quantity baru.
  assert.equal(result.items[0].subtotal, 2_500);
  assert.equal(result.items[0].bundle_id, null); // label dilepas karena quantity berubah
});
