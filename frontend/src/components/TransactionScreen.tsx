import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useItems } from '../hooks/useItems';
import './TransactionScreen.css';

type DepositType = '' | 'ktp' | 'sim' | 'uang';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

function todayStr() {
  // Pakai komponen tanggal lokal perangkat (bukan toISOString/UTC) — device
  // vendor sudah otomatis WIB, tapi toISOString bisa geser mundur satu hari
  // kalau dikonversi ke UTC (lihat catatan di backend/src/lib/dates.ts).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rentalDays(start: string, end: string) {
  const ms = new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export function TransactionScreen({
  session,
  businessId,
}: {
  session: Session;
  businessId: string;
}) {
  const { items, loading: itemsLoading } = useItems(businessId);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [depositType, setDepositType] = useState<DepositType>('');
  const [depositAmount, setDepositAmount] = useState('');
  const [totalPrice, setTotalPrice] = useState('');
  const [priceEdited, setPriceEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const days = useMemo(() => rentalDays(startDate, endDate), [startDate, endDate]);

  const computedTotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const qty = quantities[item.id] ?? 0;
      return sum + qty * item.price_per_day * days;
    }, 0);
  }, [items, quantities, days]);

  const displayedTotal = priceEdited ? totalPrice : String(computedTotal);

  function toggleItem(itemId: string, checked: boolean) {
    setQuantities((prev) => ({ ...prev, [itemId]: checked ? 1 : 0 }));
  }

  function setQuantity(itemId: string, qty: number) {
    setQuantities((prev) => ({ ...prev, [itemId]: qty }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const selectedItems = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([item_id, quantity]) => ({ item_id, quantity }));

    if (selectedItems.length === 0) {
      setError('Pilih minimal satu alat.');
      return;
    }

    setSubmitting(true);

    const res = await fetch(`${API_BASE_URL}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        businessId,
        customer: { name: customerName, phone: customerPhone || null },
        start_date: startDate,
        end_date: endDate,
        items: selectedItems,
        deposit: depositType ? { type: depositType, amount: depositAmount } : null,
        total_price: Number(displayedTotal) || 0,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? `Gagal menyimpan (HTTP ${res.status})`);
      return;
    }

    setSuccessMessage('Transaksi tersimpan.');
    setCustomerName('');
    setCustomerPhone('');
    setQuantities({});
    setDepositType('');
    setDepositAmount('');
    setTotalPrice('');
    setPriceEdited(false);
  }

  if (itemsLoading) return <p className="app-shell__subtitle">Memuat...</p>;

  if (items.length === 0) {
    return <p className="app-shell__subtitle">Belum ada alat. Tambahkan dulu di tab "Kelola Alat".</p>;
  }

  return (
    <section>
      <h2>Catat transaksi</h2>

      <form onSubmit={handleSubmit} className="form">
        <label>
          Nama penyewa
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
        </label>
        <label>
          Kontak
          <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        </label>

        <div className="date-row">
          <label>
            Tanggal ambil
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              required
            />
          </label>
          <label>
            Tanggal kembali
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </label>
        </div>

        <div>
          <span className="form-section-label">Pilih alat</span>
          <ul className="item-picker">
            {items.map((item) => {
              const qty = quantities[item.id] ?? 0;
              return (
                <li key={item.id} className="item-picker__row">
                  <label className="item-picker__checkbox">
                    <input
                      type="checkbox"
                      checked={qty > 0}
                      onChange={(e) => toggleItem(item.id, e.target.checked)}
                    />
                    {item.name}
                  </label>
                  {qty > 0 && (
                    <input
                      type="number"
                      min={1}
                      max={item.total_units}
                      value={qty}
                      onChange={(e) => setQuantity(item.id, Number(e.target.value))}
                      className="item-picker__qty"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <label>
          Jenis jaminan
          <select value={depositType} onChange={(e) => setDepositType(e.target.value as DepositType)}>
            <option value="">Tanpa jaminan</option>
            <option value="ktp">KTP</option>
            <option value="sim">SIM</option>
            <option value="uang">Uang</option>
          </select>
        </label>

        {depositType === 'uang' && (
          <label>
            Jumlah jaminan (Rp)
            <input
              type="number"
              min={0}
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
            />
          </label>
        )}

        <label>
          Total harga (Rp) · {days} hari
          <input
            type="number"
            min={0}
            value={displayedTotal}
            onChange={(e) => {
              setPriceEdited(true);
              setTotalPrice(e.target.value);
            }}
          />
        </label>

        {error && <p className="error-text">{error}</p>}
        {successMessage && <p className="success-text">{successMessage}</p>}

        <button type="submit" disabled={submitting}>
          Simpan transaksi
        </button>
      </form>
    </section>
  );
}
