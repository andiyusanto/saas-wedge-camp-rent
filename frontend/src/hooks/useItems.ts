import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type Item = {
  id: string;
  name: string;
  category: string | null;
  total_units: number;
  price_per_day: number;
};

export function useItems(businessId: string | undefined) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from('items')
      .select('id, name, category, total_units, price_per_day')
      .order('name');

    setItems(data ?? []);
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

  return { items, loading, refresh, addItem };
}
