import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type Item = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  total_units: number;
  price_per_day: number;
  discount_min_days: number;
  discounted_price_per_day: number | null;
  image_url: string | null;
  description: string | null;
  condition_note: string | null;
  deactivated_at: string | null;
};

export type ItemInput = {
  code: string | null;
  name: string;
  category: string | null;
  total_units: number;
  price_per_day: number;
  discount_min_days: number;
  discounted_price_per_day: number | null;
  image_url: string | null;
  description: string | null;
  condition_note: string | null;
};

const SELECT_FIELDS =
  'id, code, name, category, total_units, price_per_day, discount_min_days, discounted_price_per_day, image_url, description, condition_note, deactivated_at';

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

  const items = allItems.filter((i) => !i.deactivated_at);
  const inactiveItems = allItems.filter((i) => i.deactivated_at);

  return { items, inactiveItems, loading, refresh, addItem, updateItem, setItemActive };
}
