import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

export type AvailabilityStatus = 'tersedia' | 'sisa_sedikit' | 'penuh';

export type AvailabilityItem = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  image_url: string | null;
  total_units: number;
  price_per_day: number;
  remaining: number[];
  status: AvailabilityStatus[];
};

export type AvailabilityResponse = {
  days: string[];
  items: AvailabilityItem[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export function useAvailability(session: Session | null, days = 7, startDate?: string) {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ days: String(days) });
    if (startDate) params.set('start_date', startDate);

    fetch(`${API_BASE_URL}/api/availability?${params.toString()}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [session, days, startDate]);

  return { data, loading, error };
}
