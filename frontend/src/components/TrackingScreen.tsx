import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useTrackings } from '../hooks/useTrackings';
import type { TrackingBooking } from '../hooks/useTrackings';
import './TrackingScreen.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

function formatRupiah(n: number) {
  return `Rp${Math.round(n).toLocaleString('id-ID')}`;
}

function ReturnForm({
  session,
  booking,
  onDone,
}: {
  session: Session;
  booking: TrackingBooking;
  onDone: () => void;
}) {
  const [lateFee, setLateFee] = useState(String(Math.round(booking.suggested_late_fee)));
  const [damageAmount, setDamageAmount] = useState('');
  const [damageDesc, setDamageDesc] = useState('');
  const [lossAmount, setLossAmount] = useState('');
  const [lossDesc, setLossDesc] = useState('');
  const [returnDeposit, setReturnDeposit] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDeposit = booking.deposits.some((d) => d.status === 'ditahan');

  async function submit() {
    setSubmitting(true);
    setError(null);

    const extraPenalties = [];
    if (Number(damageAmount) > 0) {
      extraPenalties.push({ type: 'kerusakan', amount: Number(damageAmount), description: damageDesc || null });
    }
    if (Number(lossAmount) > 0) {
      extraPenalties.push({ type: 'kehilangan', amount: Number(lossAmount), description: lossDesc || null });
    }

    const res = await fetch(`${API_BASE_URL}/api/bookings/${booking.id}/return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        late_fee_amount: Number(lateFee) || 0,
        extra_penalties: extraPenalties,
        return_deposits: hasDeposit && returnDeposit,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? `Gagal (HTTP ${res.status})`);
      return;
    }

    onDone();
  }

  return (
    <div className="return-form">
      <label>
        Denda keterlambatan (Rp)
        <input type="number" min={0} value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
      </label>

      <div className="return-form__row">
        <label>
          Denda kerusakan (Rp)
          <input type="number" min={0} value={damageAmount} onChange={(e) => setDamageAmount(e.target.value)} />
        </label>
        <label>
          Keterangan kerusakan
          <input value={damageDesc} onChange={(e) => setDamageDesc(e.target.value)} />
        </label>
      </div>

      <div className="return-form__row">
        <label>
          Denda kehilangan (Rp)
          <input type="number" min={0} value={lossAmount} onChange={(e) => setLossAmount(e.target.value)} />
        </label>
        <label>
          Keterangan kehilangan
          <input value={lossDesc} onChange={(e) => setLossDesc(e.target.value)} />
        </label>
      </div>

      {hasDeposit && (
        <label className="return-form__checkbox">
          <input
            type="checkbox"
            checked={returnDeposit}
            onChange={(e) => setReturnDeposit(e.target.checked)}
          />
          Kembalikan jaminan
        </label>
      )}

      {error && <p className="error-text">{error}</p>}

      <button type="button" onClick={submit} disabled={submitting}>
        Konfirmasi pengembalian
      </button>
    </div>
  );
}

export function TrackingScreen({ session }: { session: Session }) {
  const { bookings, toleranceHours, loading, error, refresh, cancelBooking } = useTrackings(session);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleCancel(booking: TrackingBooking) {
    const confirmed = window.confirm(
      `Batalkan transaksi ${booking.customer?.name ?? 'ini'}? Jaminan yang masih ditahan akan otomatis dilepas.`,
    );
    if (!confirmed) return;

    setCancelError(null);
    const { error: cancelErr } = await cancelBooking(booking.id);
    if (cancelErr) setCancelError(cancelErr);
  }

  if (loading) return <p className="app-shell__subtitle">Memuat...</p>;
  if (error) return <p className="error-text">Gagal memuat: {error}</p>;
  if (bookings.length === 0) {
    return <p className="app-shell__subtitle">Tidak ada transaksi aktif.</p>;
  }

  return (
    <section>
      <h2>Jaminan &amp; denda</h2>
      <p className="app-shell__subtitle">Toleransi telat: {toleranceHours} jam</p>
      {cancelError && <p className="error-text">{cancelError}</p>}

      <ul className="tracking-list">
        {bookings.map((b) => (
          <li key={b.id} className="tracking-item">
            <div className="tracking-item__header">
              <div>
                <div className="tracking-item__customer">{b.customer?.name}</div>
                <div className="app-shell__subtitle">
                  {b.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                </div>
                <div className="app-shell__subtitle">Kembali: {b.end_date}</div>
              </div>
              <span
                className={
                  b.is_overdue ? 'tracking-badge tracking-badge--overdue' : 'tracking-badge tracking-badge--ok'
                }
              >
                {b.is_overdue ? `Telat ${b.hours_late} jam` : 'Aktif'}
              </span>
            </div>

            {b.penalties.length > 0 && (
              <ul className="tracking-item__penalties">
                {b.penalties.map((p) => (
                  <li key={p.id}>
                    {p.type}: {formatRupiah(p.amount)} {p.description ? `(${p.description})` : ''}
                  </li>
                ))}
              </ul>
            )}

            {openId === b.id ? (
              <ReturnForm
                session={session}
                booking={b}
                onDone={() => {
                  setOpenId(null);
                  refresh();
                }}
              />
            ) : (
              <div className="tracking-item__actions">
                <button type="button" className="tracking-item__action" onClick={() => setOpenId(b.id)}>
                  Proses pengembalian
                </button>
                <button
                  type="button"
                  className="tracking-item__action tracking-item__action--cancel"
                  onClick={() => handleCancel(b)}
                >
                  Batalkan
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
