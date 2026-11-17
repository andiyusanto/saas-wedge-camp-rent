import { useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useApiResource } from './useApiResource';

export type AvailabilityStatus = 'tersedia' | 'sisa_sedikit' | 'penuh';

// Opsi B Tahap 2 (brief 17 Nov 2026) -- transaksi aktif yang SUDAH TELAT
// (today zona rental > end_date, belum dikembalikan) yang mengunci alat
// ini. TIDAK PERNAH dikirim lewat jalur publik (Etalase/get_public_availability).
export type OverdueBooking = {
  booking_number: string | null;
  customer_name: string | null;
  end_date: string;
  quantity: number;
};

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
  overdue_bookings: OverdueBooking[];
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
