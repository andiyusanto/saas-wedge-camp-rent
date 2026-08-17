import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Package, Plus, Edit2, Search, Trash2, X, Upload } from 'lucide-react';
import { useItems } from '../hooks/useItems';
import type { Item, ItemInput } from '../hooks/useItems';
import { apiFetch } from '../lib/api';
import { formatIDR } from '../utils/formatters';
import { resizeImageToDataUrl } from '../utils/imageResize';
import { ScrollableRow } from './ScrollableRow';

const CATEGORIES = [
  'Tenda',
  'Carrier & Bag',
  'Sleeping Gear',
  'Cooking Set',
  'Penerangan',
  'Matras & Layalas',
  'Aksesoris Outdoor',
  'Lainnya',
];

const EMPTY_FORM: ItemInput = {
  code: '',
  name: '',
  category: 'Tenda',
  total_units: 5,
  price_per_day: 25000,
  discount_min_days: 5,
  discounted_price_per_day: null,
  image_url: '',
  description: '',
  condition_note: '',
};

function ItemFormModal({
  initial,
  businessId,
  session,
  onSave,
  onClose,
}: {
  initial: ItemInput;
  businessId: string;
  session: Session;
  onSave: (input: ItemInput) => Promise<{ error: string | null }>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ItemInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  function set<K extends keyof ItemInput>(key: K, value: ItemInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleUploadImage(file: File) {
    setUploadingImage(true);
    setError(null);

    try {
      const dataUrl = await resizeImageToDataUrl(file);
      const body = await apiFetch<{ url: string }>(session, '/api/uploads/item-image', {
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Isi nama alat.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const { error: saveError } = await onSave({
      ...form,
      code: form.code?.trim() || null,
      image_url: form.image_url?.trim() || null,
      description: form.description?.trim() || null,
      condition_note: form.condition_note?.trim() || null,
    });

    setSubmitting(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-[#FBFAF4] w-full max-w-lg rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between">
          <h3 className="font-bold text-base">{initial.name ? 'Edit Peralatan Katalog' : 'Tambah Peralatan Baru'}</h3>
          <button onClick={onClose} className="text-white hover:opacity-80">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs sm:text-sm overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Kode Alat</label>
              <input
                type="text"
                placeholder="TND-04"
                value={form.code ?? ''}
                onChange={(e) => set('code', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Kategori</label>
              <select
                value={form.category ?? ''}
                onChange={(e) => set('category', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-[#26302B] mb-1">Nama Alat *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Total Stok *</label>
              <input
                type="number"
                required
                min={1}
                value={form.total_units}
                onChange={(e) => set('total_units', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Sewa /Hari (Rp) *</label>
              <input
                type="number"
                required
                min={0}
                step={1000}
                value={form.price_per_day}
                onChange={(e) => set('price_per_day', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold"
              />
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1] space-y-2">
            <p className="font-semibold text-[#26302B]">Harga setelah sewa lama (opsional)</p>
            <p className="text-[11px] text-[#6E6853]">
              Kosongkan "Harga setelah diskon" kalau alat ini harganya tetap sama berapa pun lama sewanya.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Berlaku setelah (hari)</label>
                <input
                  type="number"
                  min={1}
                  value={form.discount_min_days}
                  onChange={(e) => set('discount_min_days', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Harga setelah diskon (Rp)</label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={form.discounted_price_per_day ?? ''}
                  onChange={(e) => set('discounted_price_per_day', e.target.value ? Number(e.target.value) : null)}
                  placeholder="Sama seperti harga normal"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-[#26302B] mb-1">Foto Alat</label>
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
            <input
              type="url"
              placeholder="atau tempel URL gambar di sini..."
              value={form.image_url ?? ''}
              onChange={(e) => set('image_url', e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#26302B] mb-1">Deskripsi Spesifikasi Singkat</label>
            <textarea
              rows={2}
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#26302B] mb-1">Catatan Kondisi</label>
            <input
              type="text"
              placeholder="Contoh: 6 unit kondisi bagus, 2 baru servis"
              value={form.condition_note ?? ''}
              onChange={(e) => set('condition_note', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
            />
          </div>

          {error && <p className="text-[#A8412E] font-semibold">{error}</p>}

          <div className="pt-3 border-t border-[#DBD5C1] flex items-center justify-end space-x-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-[#DBD5C1] text-[#26302B]">
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-[#2B4739] text-white font-bold disabled:opacity-60"
            >
              Simpan Alat
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ItemCard({ item, onEdit, onDeactivate, onReactivate }: {
  item: Item;
  onEdit: () => void;
  onDeactivate?: () => void;
  onReactivate?: () => void;
}) {
  return (
    <div className="bg-[#FBFAF4] rounded-2xl p-4 border border-[#DBD5C1] shadow-xs flex flex-col justify-between space-y-3 hover:border-[#2B4739]/60 transition">
      <div>
        <div className="flex items-start space-x-3">
          {item.image_url ? (
            <img src={item.image_url} alt={item.name} className="w-16 h-16 rounded-xl object-cover border border-[#DBD5C1] shrink-0 bg-[#F1EEE2]" />
          ) : (
            <div className="w-16 h-16 rounded-xl border border-[#DBD5C1] shrink-0 bg-[#F1EEE2] flex items-center justify-center text-[#6E6853]">
              <Package className="w-6 h-6" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
              {item.code && (
                <span className="px-2 py-0.5 rounded bg-[#2B4739]/10 text-[#2B4739] font-mono text-[11px] font-bold border border-[#2B4739]/20">
                  {item.code}
                </span>
              )}
              {item.category && <span className="text-[10px] text-[#6E6853] font-medium truncate">{item.category}</span>}
            </div>
            <h3 className="font-bold text-sm text-[#26302B] mt-1 line-clamp-1">{item.name}</h3>
            {item.description && <p className="text-xs text-[#6E6853] line-clamp-2 mt-0.5">{item.description}</p>}
          </div>
        </div>

        <div className="mt-3 p-2.5 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1] grid grid-cols-2 gap-2 text-center text-xs">
          <div>
            <p className="text-[10px] text-[#6E6853]">Total Stok</p>
            <p className="font-extrabold text-[#26302B] text-sm">
              {item.total_units} <span className="text-[10px] font-normal">unit</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] text-[#6E6853]">Sewa /Hari</p>
            <p className="font-bold text-[#2B4739] text-xs">{formatIDR(item.price_per_day)}</p>
          </div>
        </div>
        {item.discounted_price_per_day != null && (
          <p className="text-[11px] text-[#6E6853] mt-2">
            Setelah {item.discount_min_days} hari: <strong className="text-[#2B4739]">{formatIDR(item.discounted_price_per_day)}</strong>/hari
          </p>
        )}
        {item.condition_note && <p className="text-[11px] text-[#6E6853] mt-2 italic">{item.condition_note}</p>}
      </div>

      <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#E6E1D2]">
        {onReactivate ? (
          <button
            onClick={onReactivate}
            className="px-3 py-1.5 rounded-lg bg-[#E8EFEA] border border-[#2B4739]/30 text-[#2B4739] text-xs font-semibold transition"
          >
            Aktifkan kembali
          </button>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] text-xs font-semibold flex items-center gap-1 transition"
            >
              <Edit2 className="w-3.5 h-3.5 text-[#2B4739]" />
              Edit
            </button>
            {onDeactivate && (
              <button onClick={onDeactivate} className="p-1.5 rounded-lg text-[#A8412E] hover:bg-[#FAF0EE] transition" title="Nonaktifkan">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ItemsScreen({ businessId, session }: { businessId: string; session: Session }) {
  const { items, inactiveItems, loading, addItem, updateItem, setItemActive } = useItems(businessId);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [modalItem, setModalItem] = useState<Item | 'new' | null>(null);

  const filtered = items.filter((item) => {
    const matchesCategory = selectedCategory === 'Semua' || item.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch = item.name.toLowerCase().includes(q) || (item.code ?? '').toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  async function handleDeactivate(item: Item) {
    if (!window.confirm(`Nonaktifkan "${item.name}"? Alat ini tidak akan muncul lagi di Catat Transaksi.`)) return;
    await setItemActive(item.id, false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
              <Package className="w-5 h-5 text-[#2B4739]" />
              <span>Katalog & Manajemen Stok Peralatan</span>
            </h2>
            <p className="text-xs text-[#6E6853]">Kelola daftar alat kamping, stok fisik toko, dan tarif sewa per hari.</p>
          </div>
          <button
            onClick={() => setModalItem('new')}
            className="px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs shadow-sm transition flex items-center gap-2 shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4 text-[#A65C2A]" />
            <span>Tambah Alat Baru</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-[#E6E1D2]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6E6853]" />
            <input
              type="text"
              placeholder="Cari kode / nama alat..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>
          <ScrollableRow className="sm:w-auto">
            {['Semua', ...CATEGORIES].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition shrink-0 ${
                  selectedCategory === cat
                    ? 'bg-[#2B4739] text-[#FBFAF4] shadow-xs font-bold'
                    : 'bg-[#F1EEE2] text-[#26302B] border border-[#DBD5C1] hover:bg-[#E6E1D2]'
                }`}
              >
                {cat}
              </button>
            ))}
          </ScrollableRow>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[#6E6853]">Memuat...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-[#FBFAF4] rounded-2xl p-8 border border-[#DBD5C1] text-center text-[#6E6853] text-sm">
          Belum ada alat yang cocok. Tambahkan dulu di atas.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => (
            <ItemCard key={item.id} item={item} onEdit={() => setModalItem(item)} onDeactivate={() => handleDeactivate(item)} />
          ))}
        </div>
      )}

      {inactiveItems.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-[#6E6853] mb-2">Alat Nonaktif</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-70">
            {inactiveItems.map((item) => (
              <ItemCard key={item.id} item={item} onEdit={() => {}} onReactivate={() => setItemActive(item.id, true)} />
            ))}
          </div>
        </div>
      )}

      {modalItem && (
        <ItemFormModal
          initial={
            modalItem === 'new'
              ? EMPTY_FORM
              : {
                  code: modalItem.code,
                  name: modalItem.name,
                  category: modalItem.category,
                  total_units: modalItem.total_units,
                  price_per_day: modalItem.price_per_day,
                  discount_min_days: modalItem.discount_min_days,
                  discounted_price_per_day: modalItem.discounted_price_per_day,
                  image_url: modalItem.image_url,
                  description: modalItem.description,
                  condition_note: modalItem.condition_note,
                }
          }
          businessId={businessId}
          session={session}
          onSave={(input) => (modalItem === 'new' ? addItem(input) : updateItem(modalItem.id, input))}
          onClose={() => setModalItem(null)}
        />
      )}
    </div>
  );
}
