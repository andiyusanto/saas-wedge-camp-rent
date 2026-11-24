import type { RentalDayMode, DurationLabelStyle } from './formatters';

// "Pilih Skema Sewa" (brief 24 Nov 2026) -- memetakan kombinasi setelan
// business SEKARANG ke salah satu dari 3 opsi sederhana di kartu "Skema
// Sewa Kamu", atau `null` ("Skema kustom") kalau kombinasinya tidak
// cocok PERSIS dengan definisi opsi manapun -- owner tetap bisa atur
// manual lewat Pengaturan Lanjutan, TIDAK dipaksa pilih salah satu.
//
// Tabel definisi EKSPLISIT (koreksi koordinator poin 5):
//
// | Opsi        | rental_day_mode    | duration_label_style | min_rental_days | max_rental_days        |
// |-------------|--------------------|-----------------------|-----------------|--------------------------
// | per_hari    | per_hari_kalender  | 'hari' atau null      | null            | null                    |
// | per_malam   | per_malam          | 'hari' atau null      | null            | null                    |
// | paket (N)   | per_hari_kalender  | 'hari_malam'          | N (>=2)         | null ATAU sama dengan N |
// | (lainnya)   | —                  | —                     | —               | —  -> kustom (null)     |

export type RentalSchemeSettings = {
  rental_day_mode: RentalDayMode;
  duration_label_style: DurationLabelStyle;
  min_rental_days: number | null;
  max_rental_days: number | null;
};

export type RentalSchemeOption =
  | { kind: 'per_hari' }
  | { kind: 'per_malam' }
  | { kind: 'paket'; days: number; maxMode: 'tanpa_batas' | 'hanya_paket' }
  | { kind: 'kustom' };

function isPlainHariLabel(style: DurationLabelStyle): boolean {
  return style === 'hari' || style === null;
}

export function deriveSchemeOption(s: RentalSchemeSettings): RentalSchemeOption {
  if (
    s.rental_day_mode === 'per_hari_kalender' &&
    isPlainHariLabel(s.duration_label_style) &&
    s.min_rental_days === null &&
    s.max_rental_days === null
  ) {
    return { kind: 'per_hari' };
  }

  if (
    s.rental_day_mode === 'per_malam' &&
    isPlainHariLabel(s.duration_label_style) &&
    s.min_rental_days === null &&
    s.max_rental_days === null
  ) {
    return { kind: 'per_malam' };
  }

  if (
    s.rental_day_mode === 'per_hari_kalender' &&
    s.duration_label_style === 'hari_malam' &&
    s.min_rental_days !== null &&
    s.min_rental_days >= 2 &&
    (s.max_rental_days === null || s.max_rental_days === s.min_rental_days)
  ) {
    return {
      kind: 'paket',
      days: s.min_rental_days,
      maxMode: s.max_rental_days === null ? 'tanpa_batas' : 'hanya_paket',
    };
  }

  return { kind: 'kustom' };
}

// Field yang ditulis saat opsi dipilih dan Disimpan -- dipakai untuk
// membangun ringkasan "Yang akan diatur: ..." DAN payload Simpan,
// SATU sumber kebenaran supaya ringkasan tidak pernah berbeda dari
// yang sungguhan ditulis ke DB.
export function settingsForSchemeOption(
  option: Exclude<RentalSchemeOption, { kind: 'kustom' }>,
): RentalSchemeSettings {
  if (option.kind === 'per_hari') {
    return { rental_day_mode: 'per_hari_kalender', duration_label_style: 'hari', min_rental_days: null, max_rental_days: null };
  }
  if (option.kind === 'per_malam') {
    return { rental_day_mode: 'per_malam', duration_label_style: 'hari', min_rental_days: null, max_rental_days: null };
  }
  return {
    rental_day_mode: 'per_hari_kalender',
    duration_label_style: 'hari_malam',
    min_rental_days: option.days,
    max_rental_days: option.maxMode === 'hanya_paket' ? option.days : null,
  };
}
