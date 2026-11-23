import { useState } from 'react';
import { Tag, Plus, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { useCustomerTypes, MAX_CUSTOMER_TYPES } from '../hooks/useCustomerTypes';
import type { CustomerType, CustomerTypeInput } from '../hooks/useCustomerTypes';

// Jenis Pelanggan (Member/Mitra/dst) -- Kelola Usaha, OWNER-ONLY (seluruh
// tab "Kelola Usaha" sudah digerbang role==='owner' di App.tsx, tidak
// perlu gerbang tambahan di sini). Brief 23 Nov 2026, migration 073.
export function CustomerTypesSection({ businessId }: { businessId: string }) {
  const { customerTypes, inactiveCustomerTypes, loading, addCustomerType, updateCustomerType, setCustomerTypeActive } =
    useCustomerTypes(businessId);
  const [editing, setEditing] = useState<CustomerType | 'new' | null>(null);
  const [name, setName] = useState('');
  const [percent, setPercent] = useState('10');
  const [appliesToSaleItems, setAppliesToSaleItems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function openNew() {
    setEditing('new');
    setName('');
    setPercent('10');
    setAppliesToSaleItems(false);
    setError(null);
  }

  function openEdit(t: CustomerType) {
    setEditing(t);
    setName(t.name);
    setPercent(String(t.discount_percent));
    setAppliesToSaleItems(t.discount_applies_to_sale_items);
    setError(null);
  }

  async function handleSave() {
    const percentNum = Number(percent);
    if (!name.trim()) {
      setError('Nama jenis wajib diisi.');
      return;
    }
    if (!(percentNum >= 0 && percentNum <= 100) || !Number.isInteger(percentNum)) {
      setError('Persen diskon harus bilangan bulat 0-100.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const input: CustomerTypeInput = { name: name.trim(), discount_percent: percentNum, discount_applies_to_sale_items: appliesToSaleItems };
    const { error: err } =
      editing === 'new' ? await addCustomerType(input) : await updateCustomerType((editing as CustomerType).id, input);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    setEditing(null);
  }

  if (loading) return null;

  return (
    <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
      <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
        <Tag className="w-5 h-5 text-[#2B4739]" />
        <span>Jenis Pelanggan</span>
      </h2>
      <p className="text-xs text-[#6E6853]">
        Mis. "Member" 10% atau "Mitra" 15% -- diterapkan otomatis saat Catat Transaksi kalau pelanggan diberi jenis
        ini (bisa dilepas per transaksi). Diskon HANYA untuk total sewa alat+paket, TIDAK untuk denda telat/rusak-
        hilang/barang jual (kecuali toggle "Diskon juga untuk barang jual" diaktifkan).
      </p>

      <div className="space-y-2">
        {customerTypes.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-[#26302B]">
                {t.name} <span className="text-[#2B4739] font-bold">-{t.discount_percent}%</span>
              </p>
              {t.discount_applies_to_sale_items && <p className="text-[#6E6853]">Berlaku juga untuk barang jual</p>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => openEdit(t)} className="p-2 rounded-lg bg-white border border-[#DBD5C1] text-[#2B4739] hover:bg-[#E8EFEA] transition">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCustomerTypeActive(t.id, false)}
                className="p-2 rounded-lg bg-white border border-[#DBD5C1] text-[#A8412E] hover:bg-[#FAF0EE] transition"
                title="Nonaktifkan"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {customerTypes.length === 0 && <p className="text-xs text-[#6E6853] italic">Belum ada jenis pelanggan.</p>}
      </div>

      {inactiveCustomerTypes.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-[#E6E1D2]">
          <p className="text-xs font-semibold text-[#6E6853]">Nonaktif</p>
          {inactiveCustomerTypes.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-white border border-[#DBD5C1] text-xs opacity-70">
              <p className="text-[#6E6853]">{t.name} (-{t.discount_percent}%)</p>
              <button onClick={() => setCustomerTypeActive(t.id, true)} className="p-2 rounded-lg bg-[#F1EEE2] text-[#2B4739]" title="Aktifkan lagi">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing === null && customerTypes.length < MAX_CUSTOMER_TYPES && (
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#2B4739] text-xs font-semibold hover:bg-[#E8EFEA] transition"
        >
          <Plus className="w-3.5 h-3.5" /> Tambah Jenis
        </button>
      )}
      {customerTypes.length >= MAX_CUSTOMER_TYPES && editing === null && (
        <p className="text-[10px] text-[#6E6853]">Maksimal {MAX_CUSTOMER_TYPES} jenis pelanggan aktif.</p>
      )}

      {editing !== null && (
        <div className="p-3 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1] space-y-2">
          <input
            type="text"
            placeholder="Nama jenis (mis. Member)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-sm"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-sm"
            />
            <span className="text-xs text-[#6E6853]">% diskon</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-[#26302B]">
            <input type="checkbox" checked={appliesToSaleItems} onChange={(e) => setAppliesToSaleItems(e.target.checked)} />
            Diskon juga untuk barang jual
          </label>
          {error && <p className="text-xs font-semibold text-[#A8412E]">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={submitting}
              className="px-3 py-2 rounded-lg bg-[#2B4739] text-white text-xs font-semibold disabled:opacity-60"
            >
              {submitting ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs">
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
