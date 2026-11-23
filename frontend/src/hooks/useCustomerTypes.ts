import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Jenis Pelanggan (Member/Mitra/dst), brief 23 Nov 2026, migration 073 --
// CRUD lewat Supabase langsung dari frontend, pola sama useSaleItems.ts.
// RLS: select member, insert/update OWNER-ONLY (is_owner_of, bukan
// business_is_writable -- ini pengaturan di Kelola Usaha, sama seperti
// late_fee_mode dkk, bukan "kerja" seperti items/bundles). Tidak ada
// delete -- soft-delete via deactivated_at (customers.customer_type_id
// adalah FK, tidak boleh pernah yatim).

export type CustomerType = {
  id: string;
  name: string;
  discount_percent: number;
  discount_applies_to_sale_items: boolean;
  deactivated_at: string | null;
  created_at: string;
};

export type CustomerTypeInput = {
  name: string;
  discount_percent: number;
  discount_applies_to_sale_items: boolean;
};

const SELECT_FIELDS = 'id, name, discount_percent, discount_applies_to_sale_items, deactivated_at, created_at';

// Maks ~5 jenis per usaha (brief) -- ditegakkan di UI saja, bukan
// constraint DB (beda dari bank_accounts migration 069 yang punya
// alasan khusus array+concurrency).
export const MAX_CUSTOMER_TYPES = 5;

export function useCustomerTypes(businessId: string | undefined) {
  const [allTypes, setAllTypes] = useState<CustomerType[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setAllTypes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase.from('customer_types').select(SELECT_FIELDS).order('name');
    setAllTypes((data as unknown as CustomerType[]) ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addCustomerType(input: CustomerTypeInput) {
    if (!supabase || !businessId) return { error: 'Belum ada usaha' };
    const { error } = await supabase.from('customer_types').insert({ business_id: businessId, ...input });
    if (error) return { error: error.message };
    await refresh();
    return { error: null };
  }

  async function updateCustomerType(id: string, input: CustomerTypeInput) {
    if (!supabase) return { error: 'Belum ada usaha' };
    const { error } = await supabase.from('customer_types').update(input).eq('id', id);
    if (error) return { error: error.message };
    await refresh();
    return { error: null };
  }

  async function setCustomerTypeActive(id: string, active: boolean) {
    if (!supabase) return { error: 'Belum ada usaha' };
    const { error } = await supabase
      .from('customer_types')
      .update({ deactivated_at: active ? null : new Date().toISOString() })
      .eq('id', id);
    if (!error) await refresh();
    return { error: error?.message ?? null };
  }

  const customerTypes = useMemo(() => allTypes.filter((t) => !t.deactivated_at), [allTypes]);
  const inactiveCustomerTypes = useMemo(() => allTypes.filter((t) => t.deactivated_at), [allTypes]);

  return { customerTypes, inactiveCustomerTypes, loading, refresh, addCustomerType, updateCustomerType, setCustomerTypeActive };
}
