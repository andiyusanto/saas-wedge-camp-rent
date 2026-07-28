import { useState } from 'react';
import type { FormEvent } from 'react';
import { useItems } from '../hooks/useItems';

export function ItemsScreen({ businessId }: { businessId: string }) {
  const { items, loading, addItem } = useItems(businessId);
  const [name, setName] = useState('');
  const [totalUnits, setTotalUnits] = useState('');
  const [pricePerDay, setPricePerDay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
          {items.map((item) => (
            <li key={item.id} className="items-list__row">
              <span>{item.name}</span>
              <span className="app-shell__subtitle">
                {item.total_units} unit · Rp{item.price_per_day.toLocaleString('id-ID')}/hari
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
