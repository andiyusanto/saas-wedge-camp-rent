import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ShoppingBag, Plus, X, Power, Upload } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { useSaleItems } from '../hooks/useSaleItems';
import type { SaleItem, SaleItemInput } from '../hooks/useSaleItems';
import { formatIDR } from '../utils/formatters';
import { resizeImageToDataUrl } from '../utils/imageResize';
import { apiFetch } from '../lib/api';

// Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
// usulan Campease Outdoor: baterai, jas hujan, hand warmer, dkk, dijual
// terpisah dari alat SEWA. Sengaja ringan -- tanpa modal/HPP/laba,
// pembelian stok, barcode, atau Etalase (lihat CLAUDE.md bagian 6).
// Member boleh tulis (digerbang `writable`, pola sama items/bundles),
// dirender sebagai sub-tab ketiga di ItemsScreen.tsx (lihat tab
// "Alat"/"Paket"/"Barang Jual" di sana).

function emptySaleItemInput(): SaleItemInput {
  return { name: '', image_url: null, price: 0, stock: 0, low_stock_threshold: null };
}

function SaleItemFormModal({
  businessId,
  session,
  initial,
  onClose,
  onSaved,
}: {
  businessId: string;
  session: Session;
  initial: SaleItem | 'new';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { addSaleItem, updateSaleItem } = useSaleItems(businessId);
  const isNew = initial === 'new';
  const [uploadingImage, setUploadingImage] = useState(false);

  const [form, setForm] = useState<SaleItemInput>(() =>
    isNew
      ? emptySaleItemInput()
      : {
          name: initial.name,
          image_url: initial.image_url,
          price: initial.price,
          stock: initial.stock,
          low_stock_threshold: initial.low_stock_threshold,
        },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof SaleItemInput>(key: K, value: SaleItemInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleUploadImage(file: File) {
    setUploadingImage(true);
    setError(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      const body = await apiFetch<{ url: string }>(session, '/api/uploads/sale-item-image', {
        method: 'POST',
        body: JSON.stringify({ businessId, image: dataUrl }),
      });
      set('image_url', body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!form.name.trim()) {
      setError('Nama barang wajib diisi.');
      return;
    }
    if (!(Number(form.price) >= 0)) {
      setError('Harga jual tidak valid.');
      return;
    }
    if (!Number.isInteger(Number(form.stock)) || Number(form.stock) < 0) {
      setError('Stok harus bilangan bulat, tidak boleh negatif.');
      return;
    }
    setSaving(true);
    const payload: SaleItemInput = { ...form, name: form.name.trim() };
    const result = isNew ? await addSaleItem(payload) : await updateSaleItem(initial.id, payload);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-md rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold">{isNew ? 'Tambah Barang Jual' : `Ubah ${initial.name}`}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs sm:text-sm">
          {error && <p className="text-[#A8412E] font-semibold bg-[#A8412E]/10 p-2.5 rounded-lg">{error}</p>}

          <div>
            <label className="block font-bold text-[#26302B] mb-1">Nama Barang</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="mis. Baterai AA"
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>

          <div>
            <label className="block font-bold text-[#26302B] mb-1">Foto (opsional)</label>
            <div className="flex items-center gap-2">
              {form.image_url && (
                <img src={form.image_url} alt="Pratinjau" className="h-14 w-14 shrink-0 object-cover rounded-lg border border-[#DBD5C1]" />
              )}
              <label className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-[#DBD5C1] px-3 py-2.5 text-xs font-semibold text-[#6E6853] hover:bg-[#F1EEE2] cursor-pointer transition">
                <Upload className="w-4 h-4" />
                {uploadingImage ? 'Mengunggah...' : 'Upload Gambar'}
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingImage}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadImage(file);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <label className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="font-bold text-[#26302B]">Harga Jual</span>
              <input
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => set('price', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
            </label>
            <label className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="font-bold text-[#26302B]">Stok Sekarang</span>
              <input
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => set('stock', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
            </label>
          </div>
          {!isNew && (
            <p className="text-[11px] text-[#A65C2A]">
              Koreksi stok di sini mengganti angkanya LANGSUNG (nilai absolut) — kalau cuma mau menambah stok baru
              datang, pakai tombol "+ Tambah stok" di daftar supaya tidak menimpa pengurangan stok yang terjadi
              bersamaan dari transaksi lain.
            </p>
          )}

          <div>
            <label className="block font-bold text-[#26302B] mb-1">Batas Stok Menipis (opsional)</label>
            <input
              type="number"
              min={0}
              value={form.low_stock_threshold ?? ''}
              onChange={(e) => set('low_stock_threshold', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="mis. 5 — badge 'Stok menipis' muncul kalau sisa segini atau kurang"
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>
        </div>

        <div className="p-4 border-t border-[#DBD5C1] shrink-0">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-md transition disabled:opacity-60"
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}

function AddStockModal({
  saleItem,
  onClose,
  onAdd,
}: {
  saleItem: SaleItem;
  onClose: () => void;
  onAdd: (qty: number) => Promise<{ error: string | null }>;
}) {
  const [qty, setQty] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) {
      setError('Jumlah harus bilangan bulat lebih dari 0.');
      return;
    }
    setSaving(true);
    const result = await onAdd(n);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-xs rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between">
          <h2 className="text-base font-bold">+ Tambah Stok {saleItem.name}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 text-xs sm:text-sm">
          <p className="text-[#6E6853]">Stok sekarang: <strong className="text-[#26302B]">{saleItem.stock}</strong></p>
          {error && <p className="text-[#A8412E] font-semibold bg-[#A8412E]/10 p-2.5 rounded-lg">{error}</p>}
          <label className="block">
            <span className="font-bold text-[#26302B]">Jumlah stok baru datang</span>
            <input
              type="number"
              min={1}
              autoFocus
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-md transition disabled:opacity-60"
          >
            {saving ? 'Menyimpan...' : 'Tambahkan'}
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}

export function BarangJualScreen({
  businessId,
  session,
  writable = true,
}: {
  businessId: string;
  session: Session;
  writable?: boolean;
}) {
  const { saleItems, inactiveSaleItems, loading, setSaleItemActive, addStock } = useSaleItems(businessId);
  const [modalItem, setModalItem] = useState<SaleItem | 'new' | null>(null);
  const [addStockTarget, setAddStockTarget] = useState<SaleItem | null>(null);

  if (loading) return <p className="text-center text-[#6E6853] py-6">Memuat...</p>;

  function stockBadge(item: SaleItem): { text: string; className: string } | null {
    if (item.stock <= 0) return { text: 'Habis', className: 'bg-[#A8412E]/10 text-[#A8412E]' };
    if (item.low_stock_threshold != null && item.stock <= item.low_stock_threshold) {
      return { text: 'Stok menipis', className: 'bg-[#A65C2A]/10 text-[#A65C2A]' };
    }
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Pola sama dengan toolbar Alat (ItemsScreen.tsx)/Paket
          (BundlesScreen.tsx) -- cuma satu tombol tambah, dibuat responsif
          supaya tidak sempit-sempit di 360px. */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs text-[#6E6853]">
          Barang habis pakai yang dijual-belikan (baterai, jas hujan, dsb) — terpisah dari alat sewa, stok otomatis
          berkurang saat transaksi disimpan.
        </p>
        <button
          onClick={() => setModalItem('new')}
          disabled={!writable}
          title={!writable ? 'Masa aktif langganan sudah habis — hubungi Sewalog untuk memperpanjang.' : undefined}
          className="px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs shadow-sm transition flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
        >
          <Plus className="w-4 h-4 text-[#A65C2A]" />
          <span>Tambah Barang</span>
        </button>
      </div>

      {saleItems.length === 0 && inactiveSaleItems.length === 0 && (
        <p className="text-center text-[#6E6853] py-6 italic bg-white/50 rounded-lg border border-dashed border-[#DBD5C1]">
          Belum ada barang jual. Tambah barang (mis. "Baterai AA") untuk mulai mencatat penjualannya di transaksi.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {[...saleItems, ...inactiveSaleItems].map((item) => {
          const deactivated = !!item.deactivated_at;
          const badge = stockBadge(item);
          return (
            <div key={item.id} className={`p-3 rounded-xl border border-[#DBD5C1] bg-white space-y-1.5 ${deactivated ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between">
                <p className="font-bold text-[#26302B] flex items-center gap-1.5">
                  <ShoppingBag className="w-4 h-4 text-[#2B4739]" /> {item.name}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setModalItem(item)} disabled={!writable} className="text-[11px] font-bold text-[#2B4739] disabled:opacity-50">
                    Ubah
                  </button>
                  <button
                    onClick={() => setSaleItemActive(item.id, deactivated)}
                    disabled={!writable}
                    title={deactivated ? 'Aktifkan' : 'Nonaktifkan'}
                    className="disabled:opacity-50"
                  >
                    <Power className={`w-4 h-4 ${deactivated ? 'text-[#6E6853]' : 'text-[#A8412E]'}`} />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-[#26302B]">
                {formatIDR(item.price)} · Stok: <strong>{item.stock}</strong>
              </p>
              {badge && <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>{badge.text}</span>}
              {deactivated && <p className="text-[11px] text-[#6E6853] font-semibold italic">Nonaktif</p>}
              {!deactivated && writable && (
                <button
                  onClick={() => setAddStockTarget(item)}
                  className="text-[11px] font-bold text-[#2B4739] underline underline-offset-2"
                >
                  + Tambah stok
                </button>
              )}
            </div>
          );
        })}
      </div>

      {modalItem && (
        <SaleItemFormModal
          businessId={businessId}
          session={session}
          initial={modalItem}
          onClose={() => setModalItem(null)}
          onSaved={() => setModalItem(null)}
        />
      )}

      {addStockTarget && (
        <AddStockModal
          saleItem={addStockTarget}
          onClose={() => setAddStockTarget(null)}
          onAdd={(qty) => addStock(addStockTarget.id, qty)}
        />
      )}
    </div>
  );
}
