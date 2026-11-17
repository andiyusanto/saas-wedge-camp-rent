import type { Bundle } from '../hooks/useBundles';
import type { AvailabilityItem, AvailabilityStatus } from '../hooks/useAvailability';

// Kalender Ketersediaan: sisa paket per hari = min over komponen, floor(sisa
// komponen hari itu / jumlah per paket) -- rumus SAMA PERSIS dengan
// bundleRemaining() di routes/etalase.ts (JS inline di HTML Etalase publik,
// tidak bisa diimpor ke React, jadi diketik ulang di sini sebagai fungsi TS
// murni). Status warna pakai ambang yang SAMA dengan alat satuan
// (computeAvailabilityStatus di backend/src/lib/availability.ts,
// LOW_STOCK_RATIO=0.2) -- diduplikasi di sini untuk alasan yang sama (Kalender
// tidak punya endpoint baru untuk paket, murni derivasi di frontend).
const LOW_STOCK_RATIO = 0.2;

export function computeBundleStatus(remaining: number, totalUnits: number): AvailabilityStatus {
  if (remaining <= 0) return 'penuh';
  const threshold = Math.max(1, Math.floor(totalUnits * LOW_STOCK_RATIO));
  return remaining <= threshold ? 'sisa_sedikit' : 'tersedia';
}

export type BundleAvailabilityDay = {
  remaining: number;
  status: AvailabilityStatus;
  // Nama komponen yang jadi pembatas (buat tooltip "terbatas: X"); null
  // kalau tidak ada komponen limitatif unik (semua sisa sama, atau tanpa
  // komponen sama sekali).
  limitingComponentName: string | null;
  // Opsi B Tahap 2 (brief 17 Nov 2026) -- true kalau komponen pembatas
  // SEDANG terkunci oleh transaksi aktif yang sudah telat (item.overdue_bookings
  // tidak kosong). Karena telat memblokir TANPA BATAS WAKTU, status ini
  // berlaku sama untuk semua hari yang ditampilkan, bukan dihitung ulang
  // per tanggal secara terpisah.
  limitingComponentOverdue: boolean;
};

export type BundleAvailability = {
  bundleId: string;
  days: BundleAvailabilityDay[];
  // true kalau SEMUA komponen masih ada & aktif di daftar alat yang
  // diberikan -- kalau false, paket ini TIDAK BOLEH ditampilkan sama
  // sekali (brief: "Paket dengan komponen nonaktif: tidak tampil").
  allComponentsActive: boolean;
};

/**
 * Hitung ketersediaan satu paket per hari dari data `useAvailability()` yang
 * SUDAH ADA (items per hari, per komponen) -- tanpa RPC/endpoint baru.
 */
export function computeBundleAvailability(bundle: Bundle, availabilityItems: AvailabilityItem[]): BundleAvailability {
  const itemsById = new Map(availabilityItems.map((item) => [item.id, item]));
  const components = bundle.bundle_items;

  const allComponentsActive = components.length > 0 && components.every((c) => itemsById.has(c.item_id));
  if (!allComponentsActive) {
    return { bundleId: bundle.id, days: [], allComponentsActive: false };
  }

  const totalUnitsPerBundle = Math.min(
    ...components.map((c) => Math.floor(itemsById.get(c.item_id)!.total_units / c.quantity)),
  );

  const dayCount = itemsById.get(components[0].item_id)!.remaining.length;
  const days: BundleAvailabilityDay[] = [];
  for (let i = 0; i < dayCount; i++) {
    let min = Infinity;
    let limitingComponentName: string | null = null;
    let limitingComponentOverdue = false;
    let tie = false;
    for (const c of components) {
      const item = itemsById.get(c.item_id)!;
      const remainingForComponent = Math.floor(Math.max(0, item.remaining[i]) / c.quantity);
      if (remainingForComponent < min) {
        min = remainingForComponent;
        limitingComponentName = item.name;
        limitingComponentOverdue = (item.overdue_bookings?.length ?? 0) > 0;
        tie = false;
      } else if (remainingForComponent === min) {
        tie = true;
      }
    }
    const remaining = min === Infinity ? 0 : Math.max(0, min);
    days.push({
      remaining,
      status: computeBundleStatus(remaining, totalUnitsPerBundle),
      limitingComponentName: tie ? null : limitingComponentName,
      limitingComponentOverdue: tie ? false : limitingComponentOverdue,
    });
  }

  return { bundleId: bundle.id, days, allComponentsActive: true };
}

/**
 * Harga hari-1 paket, buat baris info "Mulai Rp X /hari" di Kalender --
 * TIDAK butuh tarif hari ke-2..5/extra_day_rate (AvailabilityItem tidak
 * membawanya) karena tarif hari-1 komponen = AvailabilityItem.price_per_day
 * persis (sama seperti field pertama combinedComponentRates() di
 * formatters.ts, tanpa perlu tingkat lain). Potongan harga (persen/nominal)
 * tetap diterapkan, pola sama applyBundleDiscount() -- dibulatkan ke rupiah
 * terdekat.
 */
export function computeBundleDayOnePrice(bundle: Bundle, availabilityItems: AvailabilityItem[]): number {
  if (bundle.pricing_mode === 'sendiri') return bundle.price_per_day ?? 0;

  const itemsById = new Map(availabilityItems.map((item) => [item.id, item]));
  const raw = bundle.bundle_items.reduce((sum, c) => sum + c.quantity * (itemsById.get(c.item_id)?.price_per_day ?? 0), 0);

  if (!bundle.discount_type || !bundle.discount_value) return raw;
  return Math.round(
    bundle.discount_type === 'percent' ? Math.max(0, raw * (1 - bundle.discount_value / 100)) : Math.max(0, raw - bundle.discount_value),
  );
}

/** Foto kartu paket: bundle.image_url, fallback ke foto komponen pertama (pola sama Etalase), lalu null (ikon). */
export function resolveBundleImageUrl(bundle: Bundle, availabilityItems: AvailabilityItem[]): string | null {
  if (bundle.image_url) return bundle.image_url;
  const firstComponent = bundle.bundle_items[0];
  if (!firstComponent) return null;
  const item = availabilityItems.find((i) => i.id === firstComponent.item_id);
  return item?.image_url ?? null;
}
