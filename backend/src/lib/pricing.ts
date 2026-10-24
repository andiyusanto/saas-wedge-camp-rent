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
