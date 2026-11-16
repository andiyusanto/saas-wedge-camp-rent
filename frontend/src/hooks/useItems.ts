import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type Item = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  variant: string | null;
  size: string | null;
  color: string | null;
  total_units: number;
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
  readiness_hours: number;
  image_url: string | null;
  description: string | null;
  condition_note: string | null;
  deactivated_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  deactivated_by: string | null;
};

export type ItemInput = {
  code: string | null;
  name: string;
  category: string | null;
  variant: string | null;
  size: string | null;
  color: string | null;
  total_units: number;
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
  readiness_hours: number;
  image_url: string | null;
  description: string | null;
  condition_note: string | null;
};

const SELECT_FIELDS =
  'id, code, name, category, variant, size, color, total_units, price_per_day, day2_rate, day3_rate, day4_rate, day5_rate, extra_day_rate, readiness_hours, image_url, description, condition_note, deactivated_at, created_at, created_by, updated_at, updated_by, deactivated_by';

export function useItems(businessId: string | undefined) {
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setAllItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data } = await supabase.from('items').select(SELECT_FIELDS).order('name');

    setAllItems(data ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addItem(input: ItemInput) {
    if (!supabase || !businessId) return { error: 'Belum ada usaha' };

    const { error } = await supabase.from('items').insert({ business_id: businessId, ...input });

    if (!error) await refresh();

    return { error: error?.message ?? null };
  }

  async function updateItem(id: string, input: ItemInput) {
    if (!supabase) return { error: 'Belum ada usaha' };

    const { error } = await supabase.from('items').update(input).eq('id', id);

    if (!error) await refresh();

    return { error: error?.message ?? null };
  }

  async function setItemActive(id: string, active: boolean) {
    if (!supabase) return { error: 'Belum ada usaha' };

    const { error } = await supabase
      .from('items')
      .update({ deactivated_at: active ? null : new Date().toISOString() })
      .eq('id', id);

    if (!error) await refresh();

    return { error: error?.message ?? null };
  }

  // Memoized -- lihat catatan di useBundles.ts (bug "Maximum update depth
  // exceeded" ditemukan 16 Nov 2026 akibat pola .filter() polos yang
  // membuat referensi array baru tiap render, dipakai sebagai dependency
  // useEffect di tempat lain). Dijaga preventif di sini juga.
  const items = useMemo(() => allItems.filter((i) => !i.deactivated_at), [allItems]);
  const inactiveItems = useMemo(() => allItems.filter((i) => i.deactivated_at), [allItems]);

  return { items, inactiveItems, loading, refresh, addItem, updateItem, setItemActive };
}
