import { computeBookingItemSubtotal, type BookingItemRatesSnapshot } from './pricing.js';

// Ubah Alat (transaksi "Siap Diambil", migration 061, brief 14 Nov
// 2026) -- menggabungkan daftar alat yang DIMINTA (item_id+quantity
// saja, dari klien, TIDAK PERNAH dipercaya soal harga) dengan alat yang
// SUDAH ADA di booking (pakai tarif SNAPSHOT lama apa adanya, TIDAK
// di-re-snapshot meski quantity-nya berubah) dan katalog alat SAAT INI
// (untuk alat yang BENAR-BENAR BARU, belum pernah ada di booking ini --
// snapshot tarif katalog sekarang, pola sama POST /bookings). Fungsi
// murni (tidak menyentuh DB) supaya bisa diuji tanpa Express/Supabase.

export type ExistingBookingItemRow = {
  item_id: string;
  quantity: number;
  price_at_booking: number;
  day2_rate_at_booking: number | null;
  day3_rate_at_booking: number | null;
  day4_rate_at_booking: number | null;
  day5_rate_at_booking: number | null;
  extra_day_rate_at_booking: number | null;
};

export type CatalogItemRow = {
  id: string;
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
};

export type RequestedBookingItem = { item_id: string; quantity: number };

export type MergedBookingItem = BookingItemRatesSnapshot & { item_id: string; subtotal: number };

export type MergeResult = { ok: true; items: MergedBookingItem[] } | { ok: false; error: string };

export function mergeBookingItemsForUpdate(
  requested: RequestedBookingItem[],
  existing: ExistingBookingItemRow[],
  catalog: CatalogItemRow[],
  days: number,
): MergeResult {
  if (requested.length === 0) {
    return { ok: false, error: 'Minimal satu alat harus tersisa.' };
  }

  const existingById = new Map(existing.map((e) => [e.item_id, e]));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  const items: MergedBookingItem[] = [];
  for (const req of requested) {
    if (!Number.isInteger(req.quantity) || req.quantity < 1) {
      return { ok: false, error: 'Jumlah alat tidak valid.' };
    }

    const prior = existingById.get(req.item_id);
    const rates: BookingItemRatesSnapshot | null = prior
      ? {
          quantity: req.quantity,
          price_at_booking: prior.price_at_booking,
          day2_rate_at_booking: prior.day2_rate_at_booking,
          day3_rate_at_booking: prior.day3_rate_at_booking,
          day4_rate_at_booking: prior.day4_rate_at_booking,
          day5_rate_at_booking: prior.day5_rate_at_booking,
          extra_day_rate_at_booking: prior.extra_day_rate_at_booking,
        }
      : (() => {
          const catalogItem = catalogById.get(req.item_id);
          if (!catalogItem) return null;
          return {
            quantity: req.quantity,
            price_at_booking: catalogItem.price_per_day,
            day2_rate_at_booking: catalogItem.day2_rate,
            day3_rate_at_booking: catalogItem.day3_rate,
            day4_rate_at_booking: catalogItem.day4_rate,
            day5_rate_at_booking: catalogItem.day5_rate,
            extra_day_rate_at_booking: catalogItem.extra_day_rate,
          };
        })();

    if (!rates) {
      return { ok: false, error: 'Alat tidak ditemukan.' };
    }

    items.push({ item_id: req.item_id, ...rates, subtotal: computeBookingItemSubtotal(rates, days) });
  }

  return { ok: true, items };
}
