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
    let tie = false;
    for (const c of components) {
      const item = itemsById.get(c.item_id)!;
      const remainingForComponent = Math.floor(Math.max(0, item.remaining[i]) / c.quantity);
      if (remainingForComponent < min) {
        min = remainingForComponent;
        limitingComponentName = item.name;
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
    });
  }

  return { bundleId: bundle.id, days, allComponentsActive: true };
}
