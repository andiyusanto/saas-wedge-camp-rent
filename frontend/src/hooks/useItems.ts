import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type Item = {
  id: string;
  name: string;
  category: string | null;
  total_units: number;
  price_per_day: number;
  deactivated_at: string | null;
};

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
    const { data } = await supabase
      .from('items')
      .select('id, name, category, total_units, price_per_day, deactivated_at')
      .order('name');

    setAllItems(data ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addItem(input: {
    name: string;
    total_units: number;
    price_per_day: number;
  }) {
    if (!supabase || !businessId) return { error: 'Belum ada usaha' };

    const { error } = await supabase.from('items').insert({
      business_id: businessId,
      name: input.name,
      total_units: input.total_units,
      price_per_day: input.price_per_day,
    });

    if (!error) await refresh();

    return { error: error?.message ?? null };
  }

  async function updateItem(
    id: string,
    input: { name: string; total_units: number; price_per_day: number },
  ) {
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
