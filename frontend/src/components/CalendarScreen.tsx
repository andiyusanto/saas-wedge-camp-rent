import type { Session } from '@supabase/supabase-js';
import { useAvailability } from '../hooks/useAvailability';
import type { AvailabilityStatus } from '../hooks/useAvailability';
import './CalendarScreen.css';

const WEEKDAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function dayLabel(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  return { weekday: WEEKDAY_LABELS[d.getDay()], date: d.getDate() };
}

const STATUS_TEXT: Record<AvailabilityStatus, string> = {
  tersedia: 'Tersedia',
  sisa_sedikit: 'Sisa sedikit',
  penuh: 'Penuh',
};

export function CalendarScreen({ session }: { session: Session }) {
  const { data, loading, error } = useAvailability(session, 7);

  if (loading) return <p className="app-shell__subtitle">Memuat kalender...</p>;
  if (error) return <p className="error-text">Gagal memuat kalender: {error}</p>;
  if (!data || data.items.length === 0) {
    return <p className="app-shell__subtitle">Belum ada alat. Tambahkan dulu di tab "Kelola Alat".</p>;
  }

  return (
    <section>
      <h2>Kalender ketersediaan</h2>

      <div className="calendar-list">
        {data.items.map((item) => (
          <div key={item.id} className="calendar-item">
            <div className="calendar-item__name">{item.name}</div>
            <div className="calendar-strip">
              {data.days.map((dateStr, i) => {
                const { weekday, date } = dayLabel(dateStr);
                const status = item.status[i];
                return (
                  <div
                    key={dateStr}
                    className={`calendar-cell calendar-cell--${status}`}
                    title={`${dateStr}: ${STATUS_TEXT[status]} (sisa ${item.remaining[i]}/${item.total_units})`}
                  >
                    <span className="calendar-cell__weekday">{weekday}</span>
                    <span className="calendar-cell__date">{date}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
