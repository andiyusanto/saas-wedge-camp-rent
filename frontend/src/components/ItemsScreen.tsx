import { useState } from 'react';
import type { FormEvent } from 'react';
import { useItems } from '../hooks/useItems';
import type { Item } from '../hooks/useItems';
import './ItemsScreen.css';

function EditItemRow({
  item,
  onSave,
  onCancel,
}: {
  item: Item;
  onSave: (input: { name: string; total_units: number; price_per_day: number }) => Promise<{ error: string | null }>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [totalUnits, setTotalUnits] = useState(String(item.total_units));
  const [pricePerDay, setPricePerDay] = useState(String(item.price_per_day));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: saveError } = await onSave({
      name,
      total_units: Number(totalUnits),
      price_per_day: Number(pricePerDay),
    });

    setSubmitting(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    onCancel();
  }

  return (
    <li className="items-list__row items-list__row--editing">
      <form onSubmit={handleSubmit} className="item-edit-form">
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="item-edit-form__row">
          <input
            type="number"
            min={1}
            value={totalUnits}
            onChange={(e) => setTotalUnits(e.target.value)}
            required
          />
          <input
            type="number"
            min={0}
            value={pricePerDay}
            onChange={(e) => setPricePerDay(e.target.value)}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="item-edit-form__actions">
          <button type="submit" disabled={submitting}>
            Simpan
          </button>
          <button type="button" onClick={onCancel} className="item-edit-form__cancel">
            Batal
          </button>
        </div>
      </form>
    </li>
  );
}

export function ItemsScreen({ businessId }: { businessId: string }) {
  const { items, inactiveItems, loading, addItem, updateItem, setItemActive } = useItems(businessId);
  const [name, setName] = useState('');
  const [totalUnits, setTotalUnits] = useState('');
  const [pricePerDay, setPricePerDay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: addError } = await addItem({
      name,
      total_units: Number(totalUnits),
      price_per_day: Number(pricePerDay),
    });

    setSubmitting(false);

    if (addError) {
      setError(addError);
      return;
    }

    setName('');
    setTotalUnits('');
    setPricePerDay('');
  }

  async function handleDeactivate(item: Item) {
    if (!window.confirm(`Nonaktifkan "${item.name}"? Alat ini tidak akan muncul lagi di Catat Transaksi.`)) return;
    await setItemActive(item.id, false);
  }

  async function handleReactivate(item: Item) {
    await setItemActive(item.id, true);
  }

  return (
    <section>
      <h2>Kelola alat</h2>

      <form onSubmit={handleSubmit} className="form">
        <label>
          Nama alat
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Jumlah unit
          <input
            type="number"
            min={1}
            value={totalUnits}
            onChange={(e) => setTotalUnits(e.target.value)}
            required
          />
        </label>
        <label>
          Harga sewa / hari (Rp)
          <input
            type="number"
            min={0}
            value={pricePerDay}
            onChange={(e) => setPricePerDay(e.target.value)}
            required
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={submitting}>
          Tambah alat
        </button>
      </form>

      {loading ? (
        <p className="app-shell__subtitle">Memuat...</p>
      ) : items.length === 0 ? (
        <p className="app-shell__subtitle">Belum ada alat. Tambahkan dulu di atas.</p>
      ) : (
        <ul className="items-list">
          {items.map((item) =>
            editingId === item.id ? (
              <EditItemRow
                key={item.id}
                item={item}
                onSave={(input) => updateItem(item.id, input)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <li key={item.id} className="items-list__row">
                <span>{item.name}</span>
                <span className="app-shell__subtitle">
                  {item.total_units} unit · Rp{item.price_per_day.toLocaleString('id-ID')}/hari
                </span>
                <div className="items-list__actions">
                  <button type="button" onClick={() => setEditingId(item.id)}>
                    Edit
                  </button>
                  <button type="button" className="items-list__deactivate" onClick={() => handleDeactivate(item)}>
                    Nonaktifkan
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {inactiveItems.length > 0 && (
        <div className="items-inactive">
          <h3>Alat nonaktif</h3>
          <ul className="items-list">
            {inactiveItems.map((item) => (
              <li key={item.id} className="items-list__row items-list__row--inactive">
                <span>{item.name}</span>
                <span className="app-shell__subtitle">
                  {item.total_units} unit · Rp{item.price_per_day.toLocaleString('id-ID')}/hari
                </span>
                <div className="items-list__actions">
                  <button type="button" onClick={() => handleReactivate(item)}>
                    Aktifkan kembali
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
