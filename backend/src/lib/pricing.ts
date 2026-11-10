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
  return items.reduce((sum, bi) => {
    if (bi.day2_rate_at_booking == null) {
      return sum + bi.quantity * bi.price_at_booking * days;
    }
    const rates: ItemDayRates = {
      price_per_day: bi.price_at_booking,
      day2_rate: bi.day2_rate_at_booking,
      day3_rate: bi.day3_rate_at_booking!,
      day4_rate: bi.day4_rate_at_booking!,
      day5_rate: bi.day5_rate_at_booking!,
      extra_day_rate: bi.extra_day_rate_at_booking!,
    };
    return sum + bi.quantity * computeItemRentalPrice(rates, days);
  }, 0);
}
