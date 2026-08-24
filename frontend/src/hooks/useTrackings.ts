import type { Session } from '@supabase/supabase-js';
import { apiFetch } from '../lib/api';
import { useApiResource } from './useApiResource';
import type { ReceiptData } from '../utils/formatters';

export type TrackingBooking = {
  id: string;
  booking_number: string | null;
  customer: { name: string; phone: string | null; address: string | null } | null;
  customer_photo_url: string | null;
  start_date: string;
  end_date: string;
  due_at: string;
  is_pending_pickup: boolean;
  is_overdue: boolean;
  hours_late: number;
  daily_rate: number;
  suggested_late_fee: number;
  items: { name: string; quantity: number; price_per_day: number }[];
  deposits: { id: string; type: string; amount: number | null; note: string | null; status: string }[];
  penalties: { id: string; type: string; amount: number; description: string | null }[];
  history: { status: string; changed_by_name: string; created_at: string }[];
  total_price: number;
  dp_paid: number;
};

type TrackingsResponse = { bookings: TrackingBooking[]; tolerance_hours: number };

// Dipakai bareng oleh struk WA dan Nota Sewa (cetak/PDF) — satu sumber
// pemetaan booking -> data struk, supaya keduanya konsisten.
export function buildReceiptData(b: TrackingBooking, businessName: string): ReceiptData {
  const activeDeposit = b.deposits.find((d) => d.status === 'ditahan') ?? b.deposits[0];
  return {
    bookingNumber: b.booking_number ?? '-',
    customerName: b.customer?.name ?? '-',
    customerPhone: b.customer?.phone ?? '',
    startDate: b.start_date,
    endDate: b.end_date,
    items: b.items,
    totalPrice: b.total_price,
    dpPaid: b.dp_paid,
    depositType: activeDeposit?.type ?? null,
    depositNote: activeDeposit?.note ?? null,
    depositStatus: (activeDeposit?.status as 'ditahan' | 'dikembalikan' | null) ?? null,
    status: b.is_pending_pickup ? 'dipesan' : 'aktif',
    fines: b.penalties,
    businessName,
  };
}

const POLL_MS = 60_000; // status telat/jaminan bisa berubah dari terminal staf lain

export function useTrackings(session: Session | null) {
  const { data, loading, error, refresh } = useApiResource<TrackingsResponse>(session, '/api/trackings', {
    pollMs: POLL_MS,
  });

  async function postAction(bookingId: string, action: 'cancel' | 'pickup') {
    if (!session) return { error: 'Belum login' };
    try {
      await apiFetch(session, `/api/bookings/${bookingId}/${action}`, { method: 'POST' });
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  const cancelBooking = (bookingId: string) => postAction(bookingId, 'cancel');
  const pickupBooking = (bookingId: string) => postAction(bookingId, 'pickup');

  return {
    bookings: data?.bookings ?? [],
    toleranceHours: data?.tolerance_hours ?? 6,
    loading,
    error,
    refresh,
    cancelBooking,
    pickupBooking,
  };
}
