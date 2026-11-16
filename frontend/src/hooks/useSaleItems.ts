import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
// CRUD katalog barang jual lewat Supabase langsung dari frontend (RLS
// member-write digerbang business_is_writable, pola sama useBundles.ts/
// useItems.ts). Penambahan stok ("+ Tambah stok") TIDAK lewat update
// langsung -- itu lewat RPC add_sale_item_stock (lihat addStock di
// bawah), supaya tidak menimpa pengurangan stok bersamaan dari transaksi
// (catatan koordinator 16 Nov 2026). Koreksi manual di form Edit (field
// Stok) TETAP update langsung (nilai absolut) -- disengaja, dijelaskan
// di Panduan.

export type SaleItem = {
  id: string;
  name: string;
  image_url: string | null;
  price: number;
  stock: number;
  low_stock_threshold: number | null;
  deactivated_at: string | null;
  created_at: string;
};

export type SaleItemInput = {
  name: string;
  image_url: string | null;
  price: number;
  stock: number;
  low_stock_threshold: number | null;
};

const SELECT_FIELDS = 'id, name, image_url, price, stock, low_stock_threshold, deactivated_at, created_at';

export function useSaleItems(businessId: string | undefined) {
  const [allSaleItems, setAllSaleItems] = useState<SaleItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setAllSaleItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data } = await supabase.from('sale_items').select(SELECT_FIELDS).order('name');

    setAllSaleItems((data as unknown as SaleItem[]) ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addSaleItem(input: SaleItemInput) {
    if (!supabase || !businessId) return { error: 'Belum ada usaha' };
    const { error } = await supabase.from('sale_items').insert({ business_id: businessId, ...input });
    if (error) return { error: error.message };
    await refresh();
    return { error: null };
  }

  async function updateSaleItem(id: string, input: SaleItemInput) {
    if (!supabase) return { error: 'Belum ada usaha' };
    const { error } = await supabase.from('sale_items').update(input).eq('id', id);
    if (error) return { error: error.message };
    await refresh();
    return { error: null };
  }

  async function setSaleItemActive(id: string, active: boolean) {
    if (!supabase) return { error: 'Belum ada usaha' };
    const { error } = await supabase
      .from('sale_items')
      .update({ deactivated_at: active ? null : new Date().toISOString() })
      .eq('id', id);
    if (!error) await refresh();
    return { error: error?.message ?? null };
  }

  // "+ Tambah stok" -- RPC atomik (stock = stock + p_qty), bukan update
  // langsung (lihat catatan di atas berkas).
  async function addStock(id: string, qty: number) {
    if (!supabase) return { error: 'Belum ada usaha' };
    const { error } = await supabase.rpc('add_sale_item_stock', { p_sale_item_id: id, p_qty: qty });
    if (error) return { error: error.message };
    await refresh();
    return { error: null };
  }

  // Memoized (bukan .filter() polos) -- pola sama useBundles.ts, ditutup
  // setelah ketemu bug "Maximum update depth exceeded" di sana (referensi
  // array baru tiap render bisa memicu loop kalau dipakai sebagai
  // dependency useEffect di tempat lain). Tidak ada efek yang memakai ini
  // sebagai dependency SAAT INI, tapi dijaga preventif supaya konsisten.
  const saleItems = useMemo(() => allSaleItems.filter((s) => !s.deactivated_at), [allSaleItems]);
  const inactiveSaleItems = useMemo(() => allSaleItems.filter((s) => s.deactivated_at), [allSaleItems]);

  return { saleItems, inactiveSaleItems, loading, refresh, addSaleItem, updateSaleItem, setSaleItemActive, addStock };
}
