import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Paket Alat ("resep"), Tahap 1 (brief 15 Nov 2026, migration 064) --
// CRUD katalog paket lewat Supabase langsung dari frontend (RLS owner-
// only untuk tulis, pola sama useItems.ts), BUKAN lewat Express --
// konsisten dengan katalog alat yang juga tidak punya route backend
// khusus.

export type BundleComponentRow = {
  id: string;
  item_id: string;
  quantity: number;
};

export type Bundle = {
  id: string;
  name: string;
  image_url: string | null;
  description: string | null;
  category: string | null;
  pricing_mode: 'ikuti_alat' | 'sendiri';
  price_per_day: number | null;
  day2_rate: number | null;
  day3_rate: number | null;
  day4_rate: number | null;
  day5_rate: number | null;
  extra_day_rate: number | null;
  discount_type: 'percent' | 'nominal' | null;
  discount_value: number | null;
  deactivated_at: string | null;
  created_at: string;
  bundle_items: BundleComponentRow[];
};

export type BundleComponentInput = { item_id: string; quantity: number };

export type BundleInput = {
  name: string;
  image_url: string | null;
  description: string | null;
  category: string | null;
  pricing_mode: 'ikuti_alat' | 'sendiri';
  price_per_day: number | null;
  day2_rate: number | null;
  day3_rate: number | null;
  day4_rate: number | null;
  day5_rate: number | null;
  extra_day_rate: number | null;
  discount_type: 'percent' | 'nominal' | null;
  discount_value: number | null;
  components: BundleComponentInput[];
};

const SELECT_FIELDS =
  'id, name, image_url, description, category, pricing_mode, price_per_day, day2_rate, day3_rate, day4_rate, day5_rate, extra_day_rate, discount_type, discount_value, deactivated_at, created_at, bundle_items(id, item_id, quantity)';

function validateComponents(components: BundleComponentInput[]): string | null {
  if (components.length === 0) return 'Paket harus punya minimal satu alat.';
  const totalUnits = components.reduce((sum, c) => sum + c.quantity, 0);
  if (components.length < 2 && totalUnits < 2) {
    return 'Paket harus punya minimal 2 alat, atau 1 alat dengan jumlah minimal 2.';
  }
  return null;
}

export function useBundles(businessId: string | undefined) {
  const [allBundles, setAllBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setAllBundles([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    // Urutan komponen (item_id) WAJIB deterministik dan SAMA DI SEMUA
    // RUNTIME (Etalase/get_public_page, Express bookingRequests.ts, dan
    // prefill Konfirmasi) -- allocateBundlePrice() melempar sisa
    // pembulatan rupiah ke komponen PERTAMA, jadi urutan yang beda bisa
    // menghasilkan alokasi beda walau totalnya sama (catatan koordinator
    // 16 Nov 2026, Paket Alat Tahap 2).
    const { data } = await supabase
      .from('bundles')
      .select(SELECT_FIELDS)
      .order('name')
      .order('item_id', { foreignTable: 'bundle_items' });

    setAllBundles((data as unknown as Bundle[]) ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addBundle(input: BundleInput) {
    if (!supabase || !businessId) return { error: 'Belum ada usaha' };

    const componentError = validateComponents(input.components);
    if (componentError) return { error: componentError };

    const { components, ...bundleFields } = input;
    const { data: bundleRow, error: bundleError } = await supabase
      .from('bundles')
      .insert({ business_id: businessId, ...bundleFields })
      .select('id')
      .single();

    if (bundleError || !bundleRow) return { error: bundleError?.message ?? 'Gagal menyimpan paket' };

    const { error: itemsError } = await supabase
      .from('bundle_items')
      .insert(components.map((c) => ({ bundle_id: bundleRow.id, business_id: businessId, item_id: c.item_id, quantity: c.quantity })));

    if (itemsError) {
      await supabase.from('bundles').delete().eq('id', bundleRow.id);
      return { error: itemsError.message };
    }

    await refresh();
    return { error: null };
  }

  // Komponen diganti total (hapus semua baris bundle_items lama, insert
  // ulang) -- lebih simpel daripada diff per baris, dan tidak masalah
  // konsistensi karena booking_items existing menyimpan SNAPSHOT-nya
  // sendiri (bundle_name/rates), tidak pernah baca bundle_items live.
  async function updateBundle(id: string, input: BundleInput) {
    if (!supabase || !businessId) return { error: 'Belum ada usaha' };

    const componentError = validateComponents(input.components);
    if (componentError) return { error: componentError };

    const { components, ...bundleFields } = input;
    const { error: bundleError } = await supabase.from('bundles').update(bundleFields).eq('id', id);
    if (bundleError) return { error: bundleError.message };

    const { error: deleteError } = await supabase.from('bundle_items').delete().eq('bundle_id', id);
    if (deleteError) return { error: deleteError.message };

    const { error: itemsError } = await supabase
      .from('bundle_items')
      .insert(components.map((c) => ({ bundle_id: id, business_id: businessId, item_id: c.item_id, quantity: c.quantity })));
    if (itemsError) return { error: itemsError.message };

    await refresh();
    return { error: null };
  }

  async function setBundleActive(id: string, active: boolean) {
    if (!supabase) return { error: 'Belum ada usaha' };

    const { error } = await supabase
      .from('bundles')
      .update({ deactivated_at: active ? null : new Date().toISOString() })
      .eq('id', id);

    if (!error) await refresh();

    return { error: error?.message ?? null };
  }

  // Bug ditemukan saat E2E Barang Jual (16 Nov 2026): .filter() di sini
  // TANPA useMemo membuat array BARU setiap kali hook ini dipanggil --
  // NewBookingModal.tsx memakai `bundles` sebagai dependency useEffect
  // prefill (Paket Alat Tahap 2, perbaikan race kondisi loading), jadi
  // referensi baru terus-menerus memicu useEffect itu berulang tiap
  // render apa pun (termasuk sekadar klik stepper alat/barang jual lain)
  // -> "Maximum update depth exceeded". useMemo di sini membuat referensi
  // STABIL selama `allBundles` sungguhan tidak berubah.
  const bundles = useMemo(() => allBundles.filter((b) => !b.deactivated_at), [allBundles]);
  const inactiveBundles = useMemo(() => allBundles.filter((b) => b.deactivated_at), [allBundles]);

  return { bundles, inactiveBundles, loading, refresh, addBundle, updateBundle, setBundleActive };
}
