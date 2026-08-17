import { useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useApiResource } from './useApiResource';

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

const POLL_MS = 30_000; // ketersediaan stok paling kritis dijaga tetap segar (risiko double-booking)

export function useAvailability(session: Session | null, days = 7, startDate?: string) {
  const path = useMemo(() => {
    const params = new URLSearchParams({ days: String(days) });
    if (startDate) params.set('start_date', startDate);
    return `/api/availability?${params.toString()}`;
  }, [days, startDate]);

  const { data, loading, error } = useApiResource<AvailabilityResponse>(session, path, { pollMs: POLL_MS });

  return { data, loading, error };
}
