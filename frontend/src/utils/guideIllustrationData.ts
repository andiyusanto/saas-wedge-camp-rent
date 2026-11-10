// Data mentah untuk 6 ilustrasi di Panduan (components/guideIllustrations.tsx)
// — dipisah dari komponen React-nya (tanpa JSX/import React sama sekali)
// supaya file yang sama bisa diimpor APA ADANYA oleh unit test di backend
// (backend/src/lib/__tests__/guideIllustrations.test.ts, lewat tsx, lintas
// package) yang membandingkannya dengan fungsi hitung ASLI
// (computeTieredLateFee, computeItemRentalPrice, rentalDuration) — supaya
// Panduan tidak pernah diam-diam beda dari aplikasi.

export const LATE_FEE_EXAMPLE = {
  toleranceHours: 2,
  rentDuration: 4, // paket 4 hari (per_malam)
  rates: {
    price_per_day: 100_000,
    day2_rate: 0,
    day3_rate: 0,
    day4_rate: 0,
    day5_rate: 20_000,
    extra_day_rate: 20_000,
  },
  dueAtLabel: 'Jum 10:00',
  points: [
    { label: 'Jum 11:30', note: 'dalam toleransi', hoursLate: 1.5, fee: 0, inTolerance: true },
    { label: 'Jum 15:00', note: '½ hari telat', hoursLate: 5, fee: 10_000, inTolerance: false },
    { label: 'Sab 09:00', note: '1 hari telat', hoursLate: 23, fee: 20_000, inTolerance: false },
    { label: 'Sab 20:00', note: '1½ hari telat', hoursLate: 34, fee: 30_000, inTolerance: false },
    { label: 'Min 12:00', note: '2 hari telat', hoursLate: 50, fee: 40_000, inTolerance: false },
  ],
};

export const PACKAGE_DAYS_EXAMPLE = {
  packagePrice: 100_000,
  packageDays: 4,
  overRate: 20_000,
  rates: {
    price_per_day: 100_000,
    day2_rate: 0,
    day3_rate: 0,
    day4_rate: 0,
    day5_rate: 20_000,
    extra_day_rate: 20_000,
  },
  totals: [
    { days: 4, total: 100_000 },
    { days: 5, total: 120_000 },
    { days: 6, total: 140_000 },
  ],
};

export const DURATION_MODE_EXAMPLE = {
  startDate: '2026-11-07', // Sabtu
  endDate: '2026-11-08', // Minggu
  perMalam: 1,
  perHariKalender: 2,
};

export const TIERED_PRICE_EXAMPLE = {
  rates: [
    { day: 1, price: 30_000 },
    { day: 2, price: 20_000 },
    { day: 3, price: 10_000 },
  ],
  // ItemDayRates lengkap, buat computeItemRentalPrice (day4/day5/extra
  // ikut day3 -- cuma dipakai kalau hitung lebih dari 3 hari, di luar
  // contoh ini yang cuma sampai hari 3).
  fullRates: {
    price_per_day: 30_000,
    day2_rate: 20_000,
    day3_rate: 10_000,
    day4_rate: 10_000,
    day5_rate: 10_000,
    extra_day_rate: 10_000,
  },
  total3Days: 60_000,
};

export const READINESS_EXAMPLE = {
  readinessHours: 48,
  returnDateStr: '2026-11-09', // Senin
  days: [
    { label: 'Senin', dateStr: '2026-11-09', status: 'Kembali · terblokir' },
    { label: 'Selasa', dateStr: '2026-11-10', status: 'Terblokir' },
    { label: 'Rabu', dateStr: '2026-11-11', status: 'Tersedia' },
  ],
};
