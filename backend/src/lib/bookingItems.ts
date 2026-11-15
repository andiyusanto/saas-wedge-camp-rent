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
  bundle_id?: string | null;
  bundle_instance_id?: string | null;
  bundle_name?: string | null;
  bundle_quantity?: number | null;
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

// Paket Alat Tahap 1 (brief 15 Nov 2026, migration 064) -- koordinator
// 15 Nov 2026 poin penting: item_id yang sama bisa muncul di DUA baris
// booking_items berbeda dalam satu booking (satu komponen paket, satu
// alat tambahan biasa -- harganya BEDA, jadi harus tetap 2 baris, TIDAK
// digabung). bundle_instance_id (null untuk baris biasa) jadi bagian
// dari KUNCI pencocokan existing<->requested, BUKAN cuma item_id --
// tanpa ini, Map keyed by item_id saja akan menghilangkan satu baris
// (collision) begitu item yang sama ada di dua baris.
export type RequestedBookingItem = { item_id: string; quantity: number; bundle_instance_id?: string | null };

export type MergedBookingItem = BookingItemRatesSnapshot & {
  item_id: string;
  subtotal: number;
  bundle_id: string | null;
  bundle_instance_id: string | null;
  bundle_name: string | null;
  bundle_quantity: number | null;
};

export type MergeResult = { ok: true; items: MergedBookingItem[] } | { ok: false; error: string };

function rowKey(itemId: string, bundleInstanceId: string | null | undefined): string {
  return `${itemId}::${bundleInstanceId ?? ''}`;
}

// Aturan pelepasan penanda paket (Ubah Alat, koordinator 15 Nov 2026):
// untuk tiap bundle_instance_id yang ADA di existing, bandingkan ke
// baris existing-nya SENDIRI (bukan ke bundle_items SEKARANG, yang bisa
// sudah berubah) -- kalau SEMUA baris grup itu (dicocokkan per KUNCI
// item_id+bundle_instance_id, bukan item_id saja -- lihat komentar
// RequestedBookingItem) PERSIS SAMA quantity-nya di requested, penanda
// dipertahankan; begitu SATU SAJA baris grup berubah quantity atau
// dihapus, penanda dilepas (null) untuk SEMUA baris SISA grup itu --
// supaya struk tidak menampilkan "Paket X" yang resepnya sudah tidak
// lengkap/berubah.
function groupsToRelease(requested: RequestedBookingItem[], existing: ExistingBookingItemRow[]): Set<string> {
  const requestedByKey = new Map(requested.map((r) => [rowKey(r.item_id, r.bundle_instance_id), r.quantity]));
  const existingByInstance = new Map<string, ExistingBookingItemRow[]>();
  for (const e of existing) {
    if (!e.bundle_instance_id) continue;
    const group = existingByInstance.get(e.bundle_instance_id) ?? [];
    group.push(e);
    existingByInstance.set(e.bundle_instance_id, group);
  }

  const release = new Set<string>();
  for (const [instanceId, group] of existingByInstance) {
    const intact = group.every((row) => requestedByKey.get(rowKey(row.item_id, row.bundle_instance_id)) === row.quantity);
    if (!intact) release.add(instanceId);
  }
  return release;
}

export function mergeBookingItemsForUpdate(
  requested: RequestedBookingItem[],
  existing: ExistingBookingItemRow[],
  catalog: CatalogItemRow[],
  days: number,
): MergeResult {
  if (requested.length === 0) {
    return { ok: false, error: 'Minimal satu alat harus tersisa.' };
  }

  const existingByKey = new Map(existing.map((e) => [rowKey(e.item_id, e.bundle_instance_id), e]));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const releasedInstances = groupsToRelease(requested, existing);

  const items: MergedBookingItem[] = [];
  for (const req of requested) {
    if (!Number.isInteger(req.quantity) || req.quantity < 1) {
      return { ok: false, error: 'Jumlah alat tidak valid.' };
    }

    // Dicocokkan lewat KUNCI (item_id + bundle_instance_id) -- bukan
    // item_id saja -- supaya baris komponen paket dan baris alat biasa
    // yang item_id-nya sama tidak saling menimpa (lihat komentar di atas).
    // Kalau requested mengaku bundle_instance_id tapi tidak ada baris
    // existing yang cocok (mis. klien mengirim instance id palsu),
    // fallback ke pencarian TANPA bundle_instance_id supaya tetap
    // diperlakukan sebagai alat biasa (aman, bukan exploit -- baris
    // hasilnya tidak akan dapat penanda bundle karena prior.bundle_instance_id
    // akan null/tidak match sehingga keepsBundle di bawah otomatis false).
    const prior = existingByKey.get(rowKey(req.item_id, req.bundle_instance_id)) ?? existingByKey.get(rowKey(req.item_id, null));
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

    // Alat BENAR-BENAR BARU (tidak ada di existing, dicocokkan per
    // KUNCI yang sama seperti di atas) tidak pernah dapat penanda
    // bundle, terlepas dari releasedInstances atau apa pun yang dikirim
    // klien soal bundle_instance_id.
    const matchedByBundleKey = prior && prior.bundle_instance_id === (req.bundle_instance_id ?? null);
    const keepsBundle = matchedByBundleKey && prior!.bundle_instance_id != null && !releasedInstances.has(prior!.bundle_instance_id!);

    items.push({
      item_id: req.item_id,
      ...rates,
      subtotal: computeBookingItemSubtotal(rates, days),
      bundle_id: keepsBundle ? prior!.bundle_id ?? null : null,
      bundle_instance_id: keepsBundle ? prior!.bundle_instance_id ?? null : null,
      bundle_name: keepsBundle ? prior!.bundle_name ?? null : null,
      bundle_quantity: keepsBundle ? prior!.bundle_quantity ?? null : null,
    });
  }

  return { ok: true, items };
}
