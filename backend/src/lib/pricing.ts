// Salinan backend dari computeItemRentalPrice() — lihat
// frontend/src/utils/formatters.ts untuk penjelasan semantik lengkap
// (tarif PER HARI itu sendiri, bukan total kumulatif ala Bilbo) dan
// migrations/034_tiered_daily_pricing.sql untuk alasan kolom. Dipakai
// oleh lib/penalty.ts (denda keterlambatan bertingkat) dan
// lib/demoReset.ts (data demo) — satu definisi per runtime, jaga tetap
// sinkron dengan salinan frontend & scripts/seed-demo.mjs (beda runtime,
// tidak bisa saling import).
export type ItemDayRates = {
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
};

function dailyRateForDay(rates: ItemDayRates, day: number): number {
  switch (day) {
    case 1:
      return rates.price_per_day;
    case 2:
      return rates.day2_rate;
    case 3:
      return rates.day3_rate;
    case 4:
      return rates.day4_rate;
    case 5:
      return rates.day5_rate;
    default:
      return rates.extra_day_rate;
  }
}

export function computeItemRentalPrice(rates: ItemDayRates, days: number): number {
  if (days <= 0) return 0;
  let total = 0;
  for (let day = 1; day <= Math.min(days, 5); day++) total += dailyRateForDay(rates, day);
  if (days > 5) total += (days - 5) * rates.extra_day_rate;
  return total;
}

// Total booking dari tarif SNAPSHOT booking_items.*_at_booking untuk N
// hari (Tahap 2, migration 055 — Ubah Jadwal/Perpanjang, dipakai saat
// jumlah hari berubah). Baris lama (day2_rate_at_booking null, dari
// sebelum migration 034) fallback ke tarif flat price_at_booking * days,
// perilaku sama seperti sebelum harga bertingkat ada.
export type BookingItemRatesSnapshot = {
  quantity: number;
  price_at_booking: number;
  day2_rate_at_booking: number | null;
  day3_rate_at_booking: number | null;
  day4_rate_at_booking: number | null;
  day5_rate_at_booking: number | null;
  extra_day_rate_at_booking: number | null;
};

export function computeBookingTotalPrice(items: BookingItemRatesSnapshot[], days: number): number {
  return items.reduce((sum, bi) => sum + computeBookingItemSubtotal(bi, days), 0);
}

// Subtotal SATU baris booking_items untuk N hari — diekstrak dari
// computeBookingTotalPrice() (Tahap 2, migration 055) supaya tidak ada
// dua tempat yang menduplikasi rumus "day2_rate_at_booking null ->
// fallback flat" yang sama. Dipakai `updateBookingItemSubtotals`
// (Ubah Jadwal/Perpanjang, routes/trackings.ts) dan `mergeBookingItemsForUpdate`
// (Ubah Alat, lib/bookingItems.ts, brief 14 Nov 2026).
// Paket Alat Tahap 1 (brief 15 Nov 2026, migration 064) -- harga paket
// dialokasikan ke tiap komponen supaya booking_items.subtotal tetap
// terisi per baris (struk, denda telat, Perpanjang/Ubah Jadwal semuanya
// baca booking_items, tidak tahu soal "paket" sama sekali). Dipanggil
// SEKALI per instance paket (bundle_quantity dikalikan DI LUAR fungsi
// ini, lihat routes/bookings.ts) -- rates di sini adalah tarif per 1
// instance resep.
export type BundleComponent = {
  item_id: string;
  quantityPerBundle: number;
  catalogRates: ItemDayRates;
};

export type AllocatedComponent = { item_id: string; subtotalPerInstance: number };

// Tarif gabungan komponen per tingkat hari, dipakai basis mode
// 'ikuti_alat' (dengan potongan opsional per tingkat) DAN basis
// proporsi alokasi di kedua mode.
export function combinedComponentRates(components: BundleComponent[]): ItemDayRates {
  const sum = (key: keyof ItemDayRates) =>
    components.reduce((total, c) => total + c.catalogRates[key] * c.quantityPerBundle, 0);
  return {
    price_per_day: sum('price_per_day'),
    day2_rate: sum('day2_rate'),
    day3_rate: sum('day3_rate'),
    day4_rate: sum('day4_rate'),
    day5_rate: sum('day5_rate'),
    extra_day_rate: sum('extra_day_rate'),
  };
}

// Potongan mode 'ikuti_alat' -- PER TINGKAT HARI (bukan ke total akhir
// N-hari sekaligus), supaya konsisten dengan "day-rate adalah satuan
// utama" yang dipakai di seluruh sistem harga bertingkat (034).
export function applyBundleDiscount(
  rates: ItemDayRates,
  discountType: 'percent' | 'nominal' | null,
  discountValue: number | null,
): ItemDayRates {
  if (!discountType || !discountValue) return rates;
  const apply = (v: number) => (discountType === 'percent' ? Math.max(0, v * (1 - discountValue / 100)) : Math.max(0, v - discountValue));
  return {
    price_per_day: apply(rates.price_per_day),
    day2_rate: apply(rates.day2_rate),
    day3_rate: apply(rates.day3_rate),
    day4_rate: apply(rates.day4_rate),
    day5_rate: apply(rates.day5_rate),
    extra_day_rate: apply(rates.extra_day_rate),
  };
}

// Alokasi totalPerInstance (hasil computeItemRentalPrice atas tarif
// paket -- ikuti_alat setelah diskon, atau sendiri -- untuk N hari) ke
// tiap komponen, proporsional terhadap harga KATALOG ASLI mandiri
// komponen itu untuk N hari yang sama. Sisa pembulatan rupiah -> komponen
// PERTAMA (urutan resep), sesuai saran brief.
export function allocateBundlePrice(
  components: BundleComponent[],
  totalPerInstance: number,
  days: number,
): AllocatedComponent[] {
  const standalone = components.map((c) => computeItemRentalPrice(c.catalogRates, days) * c.quantityPerBundle);
  const standaloneSum = standalone.reduce((a, b) => a + b, 0);

  if (standaloneSum <= 0) {
    // Semua komponen Rp0 (jarang, mis. seluruhnya gratis) -- bagi rata.
    const equal = Math.floor(totalPerInstance / components.length);
    const result = components.map((c) => ({ item_id: c.item_id, subtotalPerInstance: equal }));
    result[0].subtotalPerInstance += totalPerInstance - equal * components.length;
    return result;
  }

  const raw = standalone.map((s) => Math.floor((s / standaloneSum) * totalPerInstance));
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const remainder = totalPerInstance - rawSum;

  return components.map((c, i) => ({
    item_id: c.item_id,
    subtotalPerInstance: raw[i] + (i === 0 ? remainder : 0),
  }));
}

// Snapshot tarif *_at_booking untuk baris berpenanda paket (koordinator
// 15 Nov 2026) -- BUKAN tarif katalog asli komponen, melainkan tarif
// katalog dikali RASIO alokasi (subtotal paket yang diterima dari klien
// dibagi harga katalog mandiri komponen untuk N hari yang sama). Supaya
// komputeBookingItemSubtotal(ini, N) persis mereproduksi subtotal paket
// yang dialokasikan, dan untuk N+k hari (Perpanjang/Ubah Jadwal) hasilnya
// tetap proporsional terhadap "harga paket", bukan melompat ke harga
// katalog alat satuan. ratio dihitung sekali dari quantity+days+subtotal
// SAAT transaksi dibuat -- fallback ratio=0 kalau katalog komponen Rp0
// (tidak ada basis untuk menghitung rasio, konsisten dengan "gratis").
export function computeBundleComponentRatesSnapshot(
  catalogRates: ItemDayRates,
  quantity: number,
  days: number,
  subtotal: number,
): ItemDayRates {
  const standaloneTotal = quantity * computeItemRentalPrice(catalogRates, days);
  const ratio = standaloneTotal > 0 ? subtotal / standaloneTotal : 0;
  return {
    price_per_day: catalogRates.price_per_day * ratio,
    day2_rate: catalogRates.day2_rate * ratio,
    day3_rate: catalogRates.day3_rate * ratio,
    day4_rate: catalogRates.day4_rate * ratio,
    day5_rate: catalogRates.day5_rate * ratio,
    extra_day_rate: catalogRates.extra_day_rate * ratio,
  };
}

export function computeBookingItemSubtotal(item: BookingItemRatesSnapshot, days: number): number {
  if (item.day2_rate_at_booking == null) {
    return item.quantity * item.price_at_booking * days;
  }
  const rates: ItemDayRates = {
    price_per_day: item.price_at_booking,
    day2_rate: item.day2_rate_at_booking,
    day3_rate: item.day3_rate_at_booking!,
    day4_rate: item.day4_rate_at_booking!,
    day5_rate: item.day5_rate_at_booking!,
    extra_day_rate: item.extra_day_rate_at_booking!,
  };
  return item.quantity * computeItemRentalPrice(rates, days);
}
