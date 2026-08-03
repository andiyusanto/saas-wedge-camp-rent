import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export type TrackingBooking = {
  id: string;
  customer: { name: string; phone: string | null } | null;
  start_date: string;
  end_date: string;
  due_at: string;
  is_overdue: boolean;
  hours_late: number;
  daily_rate: number;
  suggested_late_fee: number;
  items: { name: string; quantity: number }[];
  deposits: { id: string; type: string; amount: number | null; status: string }[];
  penalties: { id: string; type: string; amount: number; description: string | null }[];
  total_price: number;
};

export function useTrackings(session: Session | null) {
  const [bookings, setBookings] = useState<TrackingBooking[]>([]);
  const [toleranceHours, setToleranceHours] = useState(6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/trackings`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json();

      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);

      setBookings(body.bookings);
      setToleranceHours(body.tolerance_hours);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function cancelBooking(bookingId: string) {
    if (!session) return { error: 'Belum login' };

    try {
      const res = await fetch(`${API_BASE_URL}/api/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) return { error: body.error ?? `HTTP ${res.status}` };

      await refresh();
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  return { bookings, toleranceHours, loading, error, refresh, cancelBooking };
}
