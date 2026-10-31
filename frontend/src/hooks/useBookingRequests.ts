import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type BookingRequestItem = { item_id: string; quantity: number; name: string };

export type BookingRequest = {
  id: string;
  status: 'menunggu' | 'dikonfirmasi' | 'ditolak' | 'kedaluwarsa';
  customer_name: string;
  customer_phone: string;
  note: string | null;
  start_date: string;
  end_date: string;
  estimated_price: number;
  expires_at: string;
  created_at: string;
  confirmation_token: string;
  items: BookingRequestItem[];
};

type RawRow = {
  id: string;
  status: BookingRequest['status'];
  customer_name: string;
  customer_phone: string;
  note: string | null;
  start_date: string;
  end_date: string;
  estimated_price: number;
  expires_at: string;
  created_at: string;
  confirmation_token: string;
  booking_request_items: { item_id: string; quantity: number; items: { name: string } | null }[];
};

const SELECT_FIELDS =
  'id, status, customer_name, customer_phone, note, start_date, end_date, estimated_price, expires_at, created_at, confirmation_token, booking_request_items(item_id, quantity, items(name))';

function mapRow(row: RawRow): BookingRequest {
  return {
    id: row.id,
    status: row.status,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    note: row.note,
    start_date: row.start_date,
    end_date: row.end_date,
    estimated_price: row.estimated_price,
    expires_at: row.expires_at,
    created_at: row.created_at,
    confirmation_token: row.confirmation_token,
    items: (row.booking_request_items ?? []).map((bri) => ({
      item_id: bri.item_id,
      quantity: bri.quantity,
      name: bri.items?.name ?? 'Alat',
    })),
  };
}

// Rencana 2.7/review -c1 (tahap 4, poin 2 & 7): tidak ada realtime
// sama sekali di stack ini — badge/daftar "Pesanan masuk" disegarkan
// lewat polling ringan (60 detik) + saat tab/window kembali fokus,
// BUKAN websocket. expire_stale_booking_requests (migration 038)
// dipanggil setiap refresh (murah, cuma UPDATE baris yang benar-benar
// sudah lewat expires_at untuk business ini) supaya count/daftar yang
// ditampilkan konsisten dengan status 'kedaluwarsa' yang sungguhan,
// bukan basi. Query sendiri JUGA memfilter expires_at > now() di sisi
// klien (poin 7) sebagai lapis kedua — kalau request LAIN sempat
// expired tapi belum sempat ter-flip oleh RPC ini (race antar-refresh),
// badge/daftar tidak ikut menghitungnya sebagai valid.
const POLL_INTERVAL_MS = 60_000;

export function useBookingRequests(businessId: string | null) {
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase || !businessId) {
      setRequests([]);
      setLoading(false);
      return;
    }

    await supabase.rpc('expire_stale_booking_requests', { p_business_id: businessId });

    const { data, error: err } = await supabase
      .from('booking_requests')
      .select(SELECT_FIELDS)
      .eq('business_id', businessId)
      .eq('status', 'menunggu')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setRequests(((data ?? []) as unknown as RawRow[]).map(mapRow));
    setError(null);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  // Review -c1 (poin 1a): dipanggil TEPAT SEBELUM membuka modal
  // Konfirmasi — daftar di layar bisa basi (polling 60 detik, atau staff
  // lain sudah memproses dari perangkat lain). Baca ulang SATU baris ini
  // langsung dari DB, bukan percaya state React yang sedang tertampil.
  const checkStillConfirmable = useCallback(async (requestId: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!supabase) return { ok: false, reason: 'Belum login' };
    const { data, error: err } = await supabase
      .from('booking_requests')
      .select('status, expires_at')
      .eq('id', requestId)
      .maybeSingle();
    if (err || !data) return { ok: false, reason: 'Pesanan tidak ditemukan — mungkin sudah dihapus.' };
    if (data.status !== 'menunggu') return { ok: false, reason: 'Pesanan ini sudah diproses (mungkin oleh staff lain).' };
    if (new Date(data.expires_at) <= new Date()) return { ok: false, reason: 'Pesanan ini sudah kedaluwarsa.' };
    return { ok: true };
  }, []);

  async function confirmWithBooking(requestId: string, bookingId: string): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'Belum login' };
    const { error: err } = await supabase.rpc('confirm_booking_request', {
      p_booking_request_id: requestId,
      p_booking_id: bookingId,
    });
    if (err) return { error: err.message };
    await refresh();
    return { error: null };
  }

  async function rejectRequest(requestId: string, reason: string): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'Belum login' };
    const { error: err } = await supabase.rpc('reject_booking_request', {
      p_booking_request_id: requestId,
      p_reason: reason || null,
    });
    if (err) return { error: err.message };
    await refresh();
    return { error: null };
  }

  // Rencana 2.4 bagian B: pesanan ditolak/kedaluwarsa TIDAK tampil di
  // bagian utama "Pesanan masuk" (cuma yang 'menunggu') — tautan kecil
  // "Lihat pesanan lama" memuat ini sekali saat diklik, bukan ikut
  // di-poll terus-menerus (tidak actionable, murni riwayat).
  async function fetchHistoricalRequests(): Promise<BookingRequest[]> {
    if (!supabase || !businessId) return [];
    const { data } = await supabase
      .from('booking_requests')
      .select(SELECT_FIELDS)
      .eq('business_id', businessId)
      .in('status', ['ditolak', 'kedaluwarsa'])
      .order('created_at', { ascending: false })
      .limit(20);
    return ((data ?? []) as unknown as RawRow[]).map(mapRow);
  }

  return {
    requests,
    pendingCount: requests.length,
    loading,
    error,
    refresh,
    checkStillConfirmable,
    confirmWithBooking,
    rejectRequest,
    fetchHistoricalRequests,
  };
}
