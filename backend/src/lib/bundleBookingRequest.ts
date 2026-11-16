// Fungsi murni untuk Pesanan Online (Paket Alat Tahap 2, brief 16 Nov
// 2026, research/brief-paket-alat-tahap-2-etalase-2026-11.md) -- diekstrak
// dari routes/bookingRequests.ts supaya bisa diuji tanpa Express/Supabase
// (pola sama lib/bookingItems.ts untuk Ubah Alat). Memecah baris keranjang
// paket jadi baris per komponen SERVER-SIDE dari resep get_public_page.bundles
// -- client anon tidak pernah dipercaya soal komposisi paket sama sekali.
import crypto from 'node:crypto';
import { computeItemRentalPrice, combinedComponentRates, applyBundleDiscount, allocateBundlePrice } from './pricing.js';
import type { ItemDayRates, BundleComponent } from './pricing.js';

export const MAX_ITEMS_PER_REQUEST = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SubmitItemInput = { item_id: string; quantity: number };
// Entri keranjang BISA berupa paket ({bundle_id, quantity}, quantity =
// jumlah INSTANCE paket), bukan cuma alat satuan.
export type SubmitBundleInput = { bundle_id: string; quantity: number };

// Review -c1 (ronde ketiga) #2: tanpa ini, quantity negatif/pecahan/string
// ("-5", 2.5) lolos lewat perbandingan `quantity > remaining` (mis. -5 >
// 4 = false, lolos validasi stok), merusak estimatedPrice, lalu baru
// gagal belakangan dengan error RPC mentah. Divalidasi per baris SEBELUM
// apa pun lain diproses: item_id/bundle_id harus UUID (persis salah
// satu, tidak boleh dua-duanya/tidak ada keduanya), quantity harus
// integer 1-20.
export function validateSubmitRows(raw: unknown): { items: SubmitItemInput[]; bundles: SubmitBundleInput[] } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: SubmitItemInput[] = [];
  const bundles: SubmitBundleInput[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) return null;
    const r = row as Record<string, unknown>;
    if (
      typeof r.quantity !== 'number' || !Number.isInteger(r.quantity) ||
      r.quantity < 1 || r.quantity > MAX_ITEMS_PER_REQUEST
    ) {
      return null;
    }
    const hasItem = typeof r.item_id === 'string';
    const hasBundle = typeof r.bundle_id === 'string';
    if (hasItem === hasBundle) return null; // wajib persis salah satu
    if (hasItem) {
      if (!UUID_RE.test(r.item_id as string)) return null;
      items.push({ item_id: r.item_id as string, quantity: r.quantity });
    } else {
      if (!UUID_RE.test(r.bundle_id as string)) return null;
      bundles.push({ bundle_id: r.bundle_id as string, quantity: r.quantity });
    }
  }
  return { items, bundles };
}

// Review -c1 (ronde ketiga) #1: [{A,3},{A,3}] masing-masing lolos cek
// remaining=4 per baris, padahal total sungguhan (6) melebihi. Digabung
// per item_id/bundle_id (dijumlahkan) SEBELUM validasi stok/harga/batas
// apa pun.
export function mergeDuplicateItems(rows: SubmitItemInput[]): SubmitItemInput[] {
  const merged = new Map<string, number>();
  for (const row of rows) {
    merged.set(row.item_id, (merged.get(row.item_id) ?? 0) + row.quantity);
  }
  return Array.from(merged.entries()).map(([item_id, quantity]) => ({ item_id, quantity }));
}

export function mergeDuplicateBundles(rows: SubmitBundleInput[]): SubmitBundleInput[] {
  const merged = new Map<string, number>();
  for (const row of rows) {
    merged.set(row.bundle_id, (merged.get(row.bundle_id) ?? 0) + row.quantity);
  }
  return Array.from(merged.entries()).map(([bundle_id, quantity]) => ({ bundle_id, quantity }));
}

// Bentuk bundles[] dari get_public_page (migration 065) — sudah difilter
// aktif DAN semua komponennya aktif di dalam RPC itu sendiri, dan
// components SUDAH TERURUT item_id (deterministik, sama dengan
// useBundles.ts/Tahap 1 — lihat catatan koordinator 16 Nov 2026 soal
// urutan alokasi).
export type PublicPageBundleComponent = {
  item_id: string;
  quantity: number;
  name: string;
};
export type PublicPageBundle = {
  id: string;
  name: string;
  pricing_mode: 'ikuti_alat' | 'sendiri';
  price_per_day: number | null;
  day2_rate: number | null;
  day3_rate: number | null;
  day4_rate: number | null;
  day5_rate: number | null;
  extra_day_rate: number | null;
  discount_type: 'percent' | 'nominal' | null;
  discount_value: number | null;
  components: PublicPageBundleComponent[];
};

// Baris jadi dikirim ke create_booking_request — penanda bundle_* null
// untuk alat satuan, terisi untuk komponen hasil pemecahan paket (pola
// sama booking_items Tahap 1, migration 064).
export type ExplodedRow = {
  item_id: string;
  quantity: number;
  bundle_id: string | null;
  bundle_instance_id: string | null;
  bundle_name: string | null;
  bundle_quantity: number | null;
};

// Memecah SATU baris keranjang paket (bundle_id + jumlah instance) jadi
// baris per komponen, meniru explodeBundleToComponents() NewBookingModal.tsx
// (Tahap 1) tapi di server dan TANPA override (client anon tidak bisa
// mengubah komposisi paket sama sekali, beda dari staf di Catat
// Transaksi). SATU bundle_instance_id dipakai untuk SEMUA baris
// komponen dari baris keranjang ini (menggabung seluruh instance jadi
// satu kelompok "Paket X ×N" di struk/status pesanan, pola sama Tahap 1).
export function explodeBundleRow(
  bundle: PublicPageBundle,
  catalogItemsByItemId: Map<string, ItemDayRates>,
  bundleQty: number,
  days: number,
): { rows: ExplodedRow[]; subtotal: number } | { error: string } {
  const components: BundleComponent[] = [];
  for (const c of bundle.components) {
    const catalogRates = catalogItemsByItemId.get(c.item_id);
    if (!catalogRates) return { error: `Paket "${bundle.name}" berisi alat yang tidak valid.` };
    components.push({ item_id: c.item_id, quantityPerBundle: c.quantity, catalogRates });
  }
  if (components.length === 0) return { error: `Paket "${bundle.name}" tidak punya komponen.` };

  const effectiveRates: ItemDayRates =
    bundle.pricing_mode === 'sendiri'
      ? {
          price_per_day: bundle.price_per_day ?? 0,
          day2_rate: bundle.day2_rate ?? 0,
          day3_rate: bundle.day3_rate ?? 0,
          day4_rate: bundle.day4_rate ?? 0,
          day5_rate: bundle.day5_rate ?? 0,
          extra_day_rate: bundle.extra_day_rate ?? 0,
        }
      : applyBundleDiscount(combinedComponentRates(components), bundle.discount_type, bundle.discount_value);

  const totalPerInstance = computeItemRentalPrice(effectiveRates, days);
  const totalForAllInstances = totalPerInstance * bundleQty;
  const allocated = allocateBundlePrice(components, totalForAllInstances, days);
  const instanceId = crypto.randomUUID();

  const rows: ExplodedRow[] = [];
  let subtotal = 0;
  for (const c of components) {
    const quantity = c.quantityPerBundle * bundleQty;
    // Catatan koordinator 16 Nov 2026 (a): komponen × jumlah paket bisa
    // melewati batas 1-20 per baris walau jumlah paketnya sendiri valid
    // (mis. matras ×2 per paket × 11 paket = 22) — ditolak di sini
    // dengan pesan jelas, SEBELUM RPC (yang akan menolak dengan pesan
    // generik "qty di luar batas" yang membingungkan pelanggan).
    if (quantity > MAX_ITEMS_PER_REQUEST) {
      return { error: `Jumlah paket "${bundle.name}" terlalu banyak untuk satu pesanan (maksimal ${MAX_ITEMS_PER_REQUEST} unit per alat).` };
    }
    const allocatedComponent = allocated.find((a) => a.item_id === c.item_id);
    const rowSubtotal = allocatedComponent?.subtotalPerInstance ?? 0;
    subtotal += rowSubtotal;
    rows.push({
      item_id: c.item_id,
      quantity,
      bundle_id: bundle.id,
      bundle_instance_id: instanceId,
      bundle_name: bundle.name,
      bundle_quantity: bundleQty,
    });
  }
  return { rows, subtotal };
}
