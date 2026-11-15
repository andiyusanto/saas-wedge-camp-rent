import { useMemo, useState } from 'react';
import { Package, Plus, X, Power } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { useItems } from '../hooks/useItems';
import { useBundles } from '../hooks/useBundles';
import type { Bundle, BundleComponentInput, BundleInput } from '../hooks/useBundles';
import { formatIDR } from '../utils/formatters';

// Paket Alat Tahap 1 (brief 15 Nov 2026, migration 064) — Katalog Paket.
// **Keputusan Andi 15 Nov 2026** (revisi dari rencana awal "owner-only"):
// paket mengikuti pola ITEMS (migration 044) -- member (karyawan) BOLEH
// membuat/mengubah/menonaktifkan paket, bukan cuma owner. Satu-satunya
// gerbang yang relevan adalah `writable` (rencana langganan hanya-baca),
// pola sama `ItemsScreen.tsx` -- tombol di sini TIDAK digerbang `role`.
// Dirender sebagai sub-tab di dalam ItemsScreen.tsx (lihat tab
// "Alat"/"Paket" di sana), bukan screen/route terpisah -- paket adalah
// fitur sekunder terhadap katalog alat, sesuai "progressive disclosure"
// (CLAUDE.md bagian 5).

function emptyBundleInput(): BundleInput {
  return {
    name: '',
    image_url: null,
    description: null,
    category: null,
    pricing_mode: 'ikuti_alat',
    price_per_day: null,
    day2_rate: null,
    day3_rate: null,
    day4_rate: null,
    day5_rate: null,
    extra_day_rate: null,
    discount_type: null,
    discount_value: null,
    components: [],
  };
}

function BundleFormModal({
  businessId,
  initial,
  onClose,
  onSaved,
}: {
  businessId: string;
  initial: Bundle | 'new';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { items } = useItems(businessId);
  const { addBundle, updateBundle } = useBundles(businessId);
  const isNew = initial === 'new';

  const [form, setForm] = useState<BundleInput>(() =>
    isNew
      ? emptyBundleInput()
      : {
          name: initial.name,
          image_url: initial.image_url,
          description: initial.description,
          category: initial.category,
          pricing_mode: initial.pricing_mode,
          price_per_day: initial.price_per_day,
          day2_rate: initial.day2_rate,
          day3_rate: initial.day3_rate,
          day4_rate: initial.day4_rate,
          day5_rate: initial.day5_rate,
          extra_day_rate: initial.extra_day_rate,
          discount_type: initial.discount_type,
          discount_value: initial.discount_value,
          components: initial.bundle_items.map((bi) => ({ item_id: bi.item_id, quantity: bi.quantity })),
        },
  );
  const [itemSearch, setItemSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, itemSearch]);

  function componentQty(itemId: string): number {
    return form.components.find((c) => c.item_id === itemId)?.quantity ?? 0;
  }

  function setComponentQty(itemId: string, quantity: number) {
    setForm((prev) => {
      const components: BundleComponentInput[] = prev.components.filter((c) => c.item_id !== itemId);
      if (quantity > 0) components.push({ item_id: itemId, quantity });
      return { ...prev, components };
    });
  }

  async function handleSubmit() {
    setError(null);
    if (!form.name.trim()) {
      setError('Nama paket wajib diisi.');
      return;
    }
    if (form.pricing_mode === 'sendiri' && !(Number(form.price_per_day) > 0)) {
      setError('Harga Sewa/Hari wajib diisi (lebih dari 0) untuk mode "Harga paket sendiri".');
      return;
    }
    setSaving(true);
    const payload: BundleInput = {
      ...form,
      name: form.name.trim(),
    };
    const result = isNew ? await addBundle(payload) : await updateBundle(initial.id, payload);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-lg rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold">{isNew ? 'Tambah Paket Baru' : `Ubah Paket ${initial.name}`}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs sm:text-sm">
          {error && <p className="text-[#A8412E] font-semibold bg-[#A8412E]/10 p-2.5 rounded-lg">{error}</p>}

          <div>
            <label className="block font-bold text-[#26302B] mb-1">Nama Paket</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="mis. Paket Tektok"
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>

          <div>
            <label className="block font-bold text-[#26302B] mb-1">Deskripsi singkat (opsional)</label>
            <input
              type="text"
              value={form.description ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value || null }))}
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </div>

          <div className="space-y-2 bg-[#F1EEE2] p-3 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B]">Isi Paket (minimal 2 alat, atau 1 alat jumlah ≥2)</h3>
            <input
              type="text"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder="Cari alat..."
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {filteredItems.map((item) => {
                const qty = componentQty(item.id);
                return (
                  <div key={item.id} className="flex items-center justify-between p-2 rounded-lg bg-white border border-[#DBD5C1]">
                    <label className="flex-1 min-w-0 pr-2 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qty > 0}
                        onChange={(e) => setComponentQty(item.id, e.target.checked ? 1 : 0)}
                        className="w-4 h-4 accent-[#2B4739] shrink-0"
                      />
                      <span className="font-semibold text-[#26302B] truncate">{item.name}</span>
                    </label>
                    {qty > 0 && (
                      <div className="flex items-center gap-1 bg-[#F1EEE2] rounded-lg p-1 border border-[#DBD5C1] shrink-0">
                        <button type="button" onClick={() => setComponentQty(item.id, Math.max(0, qty - 1))} className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B]">
                          −
                        </button>
                        <span className="w-6 text-center font-bold text-[#26302B]">{qty}</span>
                        <button type="button" onClick={() => setComponentQty(item.id, qty + 1)} className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B]">
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 bg-[#F1EEE2] p-3 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B]">Cara Harga Paket</h3>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                checked={form.pricing_mode === 'ikuti_alat'}
                onChange={() => setForm((p) => ({ ...p, pricing_mode: 'ikuti_alat', price_per_day: null, day2_rate: null, day3_rate: null, day4_rate: null, day5_rate: null, extra_day_rate: null }))}
                className="mt-0.5 accent-[#2B4739]"
              />
              <span>
                <span className="font-bold text-[#26302B]">Ikuti harga alat</span>
                <p className="text-[#6E6853]">Total = jumlah tarif tiap alat komponen (otomatis ikut perubahan harga katalog), dengan potongan opsional di bawah.</p>
              </span>
            </label>
            {form.pricing_mode === 'ikuti_alat' && (
              <div className="pl-6 flex items-center gap-2">
                <select
                  value={form.discount_type ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, discount_type: (e.target.value || null) as 'percent' | 'nominal' | null }))}
                  className="px-2 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
                >
                  <option value="">Tanpa potongan</option>
                  <option value="percent">Potongan persen</option>
                  <option value="nominal">Potongan per hari (Rp)</option>
                </select>
                {form.discount_type && (
                  <input
                    type="number"
                    min={0}
                    value={form.discount_value ?? ''}
                    onChange={(e) => setForm((p) => ({ ...p, discount_value: e.target.value === '' ? null : Number(e.target.value) }))}
                    placeholder={form.discount_type === 'percent' ? '%' : 'Rp/hari'}
                    className="w-28 px-2 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
                  />
                )}
              </div>
            )}

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                checked={form.pricing_mode === 'sendiri'}
                onChange={() => setForm((p) => ({ ...p, pricing_mode: 'sendiri', discount_type: null, discount_value: null, price_per_day: p.price_per_day ?? 0 }))}
                className="mt-0.5 accent-[#2B4739]"
              />
              <span>
                <span className="font-bold text-[#26302B]">Harga paket sendiri</span>
                <p className="text-[#6E6853]">Nominal tetap per hari, bisa bertingkat (sama seperti harga alat satuan).</p>
              </span>
            </label>
            {form.pricing_mode === 'sendiri' && (
              <div className="pl-6 grid grid-cols-2 gap-2">
                {([
                  ['price_per_day', 'Hari 1'],
                  ['day2_rate', 'Hari 2'],
                  ['day3_rate', 'Hari 3'],
                  ['day4_rate', 'Hari 4'],
                  ['day5_rate', 'Hari 5'],
                  ['extra_day_rate', 'Hari 6+'],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-[10px] text-[#6E6853] font-semibold">{label}</label>
                    <input
                      type="number"
                      min={0}
                      value={form[key] ?? ''}
                      onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value === '' ? null : Number(e.target.value) }))}
                      placeholder={key === 'price_per_day' ? 'wajib' : 'kosong = warisi'}
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B]"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-[#DBD5C1] shrink-0 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#DBD5C1] text-[#26302B] font-bold text-xs">
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan Paket'}
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}

export function BundlesScreen({
  businessId,
  writable = true,
}: {
  businessId: string;
  writable?: boolean;
}) {
  const { items } = useItems(businessId);
  const { bundles, inactiveBundles, loading, setBundleActive } = useBundles(businessId);
  const [modalBundle, setModalBundle] = useState<Bundle | 'new' | null>(null);

  function componentSummary(bundle: Bundle): string {
    return bundle.bundle_items.map((bi) => `${items.find((i) => i.id === bi.item_id)?.name ?? '(alat dihapus)'} ×${bi.quantity}`).join(', ');
  }

  function hasDeactivatedComponent(bundle: Bundle): boolean {
    return bundle.bundle_items.some((bi) => !items.some((i) => i.id === bi.item_id));
  }

  if (loading) return <p className="text-center text-[#6E6853] py-6">Memuat...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#6E6853]">
          Paket dipecah jadi alat satuan saat transaksi dibuat — stok tetap tersambung ke komponennya, bukan stok sendiri.
        </p>
        <button
          onClick={() => setModalBundle('new')}
          disabled={!writable}
          title={!writable ? 'Masa aktif langganan sudah habis — hubungi Sewalog untuk memperpanjang.' : undefined}
          className="px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs shadow-sm transition flex items-center gap-2 disabled:opacity-50 shrink-0"
        >
          <Plus className="w-4 h-4 text-[#A65C2A]" />
          <span>Tambah Paket</span>
        </button>
      </div>

      {bundles.length === 0 && inactiveBundles.length === 0 && (
        <p className="text-center text-[#6E6853] py-6 italic bg-white/50 rounded-lg border border-dashed border-[#DBD5C1]">
          Belum ada paket. Buat paket (mis. "Paket Tektok") dari gabungan alat yang sudah ada di katalog.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {[...bundles, ...inactiveBundles].map((bundle) => {
          const deactivated = !!bundle.deactivated_at;
          const warn = hasDeactivatedComponent(bundle);
          return (
            <div key={bundle.id} className={`p-3 rounded-xl border border-[#DBD5C1] bg-white space-y-1.5 ${deactivated ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between">
                <p className="font-bold text-[#26302B] flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-[#2B4739]" /> {bundle.name}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setModalBundle(bundle)} disabled={!writable} className="text-[11px] font-bold text-[#2B4739] disabled:opacity-50">
                    Ubah
                  </button>
                  <button
                    onClick={() => setBundleActive(bundle.id, deactivated)}
                    disabled={!writable}
                    title={deactivated ? 'Aktifkan' : 'Nonaktifkan'}
                    className="disabled:opacity-50"
                  >
                    <Power className={`w-4 h-4 ${deactivated ? 'text-[#6E6853]' : 'text-[#A8412E]'}`} />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-[#6E6853]">{componentSummary(bundle)}</p>
              <p className="text-[11px] text-[#26302B]">
                {bundle.pricing_mode === 'sendiri' ? (
                  <>Harga sendiri: <strong>{formatIDR(bundle.price_per_day ?? 0)}</strong>/hari</>
                ) : (
                  <>
                    Ikuti harga alat
                    {bundle.discount_type && bundle.discount_value
                      ? ` − potongan ${bundle.discount_type === 'percent' ? `${bundle.discount_value}%` : formatIDR(bundle.discount_value) + '/hari'}`
                      : ''}
                  </>
                )}
              </p>
              {deactivated && <p className="text-[11px] text-[#6E6853] font-semibold italic">Nonaktif</p>}
              {!deactivated && warn && (
                <p className="text-[11px] text-[#A65C2A] font-semibold">Salah satu alat di paket ini sudah nonaktif — paket tidak bisa dipilih di Catat Transaksi.</p>
              )}
            </div>
          );
        })}
      </div>

      {modalBundle && (
        <BundleFormModal
          businessId={businessId}
          initial={modalBundle}
          onClose={() => setModalBundle(null)}
          onSaved={() => setModalBundle(null)}
        />
      )}
    </div>
  );
}
