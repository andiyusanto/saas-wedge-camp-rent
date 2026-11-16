import type { Session } from '@supabase/supabase-js';
import { apiFetch } from '../lib/api';
import { useApiResource } from './useApiResource';
import type { ReceiptData, RentalDayMode } from '../utils/formatters';

export type TrackingBooking = {
  id: string;
  booking_number: string | null;
  customer: { name: string; phone: string | null; address: string | null } | null;
  // Audit privasi 2 Nov 2026 — bukan URL lagi, cuma penanda ada/tidaknya
  // foto. URL sungguhan (presigned, umur 5 menit) diminta terpisah lewat
  // GET /api/bookings/:id/customer-photo, cuma saat benar-benar mau
  // ditampilkan (lihat TrackingScreen.tsx) — tidak pernah disimpan di
  // sini supaya tidak ikut lewat daftar transaksi tiap kali dimuat.
  has_customer_photo: boolean;
  start_date: string;
  end_date: string;
  picked_up_at: string | null;
  due_at: string;
  is_pending_pickup: boolean;
  is_overdue: boolean;
  hours_late: number;
  daily_rate: number;
  suggested_late_fee: number;
  late_days_equivalent: number;
  late_fee_breakdown: { item_id: string; name: string; fee: number; per_day_rate: number }[];
  // Cara hitung denda telat (migration 063) — SNAPSHOT transaksi ini
  // (null di DB ditafsirkan 'bertahap_12jam' oleh backend, field ini
  // SUDAH diresolve, tidak pernah null di respons). `late_fee_hourly`
  // cuma terisi kalau mode === 'per_jam' (satu angka per transaksi,
  // bukan per alat) — `late_fee_breakdown` kosong untuk mode itu.
  late_fee_mode: 'bertahap_12jam' | 'per_hari_24jam' | 'per_jam' | 'tanpa_denda';
  late_fee_hourly: { hours: number; per_hour: number; cap: number | null; capped: boolean; needs_manual_input: boolean } | null;
  items: {
    item_id: string;
    name: string;
    quantity: number;
    price_per_day: number;
    subtotal: number | null;
    bundle_instance_id?: string | null;
    bundle_name?: string | null;
    bundle_quantity?: number | null;
  }[];
  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
  // snapshot nama+harga, terpisah dari alat sewa (lihat ReceiptData/
  // generateWhatsAppReceipt untuk kenapa tidak reuse tipe `items`).
  sale_items: { sale_item_id: string; name: string; quantity: number; price_at_booking: number; subtotal: number }[];
  deposits: { id: string; type: string; amount: number | null; note: string | null; status: string }[];
  penalties: {
    id: string;
    type: string;
    amount: number;
    description: string | null;
    item_id: string | null;
    item_name: string | null;
  }[];
  history: { status: string; changed_by_name: string; created_at: string }[];
  // Riwayat Ubah Jadwal/Perpanjang (Tahap 2, migration 055).
  reschedule_history: {
    action: 'ubah_jadwal' | 'perpanjang';
    old_start_date: string;
    old_end_date: string;
    new_start_date: string;
    new_end_date: string;
    reason: string | null;
    past_deadline: boolean;
    changed_by_name: string;
    created_at: string;
  }[];
  // Riwayat Ubah Alat (migration 061, brief 14 Nov 2026) — terpisah dari
  // reschedule_history, ditampilkan sendiri-sendiri di TrackingScreen.tsx.
  item_change_history: {
    old_items: { item_id: string; name: string; quantity: number; subtotal: number }[];
    new_items: { item_id: string; name: string; quantity: number; subtotal: number }[];
    old_total_price: number;
    new_total_price: number;
    reason: string | null;
    changed_by_name: string;
    created_at: string;
  }[];
  total_price: number;
  dp_paid: number;
  // Snapshot (migration 049) — mode saat booking ini DIBUAT, null untuk
  // baris dari sebelum fitur ini (ditafsirkan 'per_hari_kalender').
  rental_day_mode: RentalDayMode | null;
  // Snapshot paket min/maks hari (Tahap 1, migration 054).
  min_rental_days: number | null;
  max_rental_days: number | null;
  // Snapshot batas jam kembali (migration 062) — null = ikuti jam ambil.
  return_deadline_time: string | null;
  return_deadline_next_day: boolean | null;
};

type TrackingsResponse = {
  bookings: TrackingBooking[];
  tolerance_hours: number;
  reschedule_deadline_days: number | null;
  // Slug Etalase business ini, null untuk karyawan (RLS public_pages cuma
  // owner, lihat komentar di routes/trackings.ts) atau Etalase yang belum
  // pernah disetel -- dipakai TrackingScreen.tsx membangun link status
  // pesanan bentuk baru (brief 12 Nov 2026), fallback ke format lama kalau
  // null.
  public_page_slug: string | null;
  // Setting LIVE business (migration 063) — BUKAN snapshot per booking
  // (itu ada di tiap TrackingBooking.late_fee_mode) — dipakai cuma untuk
  // label stat "Sewa Terlambat"/tombol filter "Terlambat" (keputusan
  // koordinator 15 Nov 2026).
  late_fee_mode: 'bertahap_12jam' | 'per_hari_24jam' | 'per_jam' | 'tanpa_denda';
};

// Dipakai bareng oleh struk WA dan Nota Sewa (cetak/PDF) — satu sumber
// pemetaan booking -> data struk, supaya keduanya konsisten.
export function buildReceiptData(
  b: TrackingBooking,
  businessName: string,
  businessAddress?: string | null,
  businessLogoUrl?: string | null,
): ReceiptData {
  const activeDeposit = b.deposits.find((d) => d.status === 'ditahan') ?? b.deposits[0];
  return {
    bookingNumber: b.booking_number ?? '-',
    customerName: b.customer?.name ?? '-',
    customerPhone: b.customer?.phone ?? '',
    startDate: b.start_date,
    endDate: b.end_date,
    items: b.items,
    saleItems: b.sale_items.map((s) => ({
      name: s.name,
      quantity: s.quantity,
      unitPrice: s.price_at_booking,
      subtotal: s.subtotal,
    })),
    totalPrice: b.total_price,
    dpPaid: b.dp_paid,
    depositType: activeDeposit?.type ?? null,
    depositNote: activeDeposit?.note ?? null,
    depositStatus: (activeDeposit?.status as 'ditahan' | 'dikembalikan' | null) ?? null,
    status: b.is_pending_pickup ? 'dipesan' : 'aktif',
    fines: b.penalties,
    businessName,
    businessAddress,
    businessLogoUrl,
    rentalDayMode: b.rental_day_mode,
    returnDeadlineTime: b.return_deadline_time,
    returnDeadlineNextDay: b.return_deadline_next_day,
  };
}

const POLL_MS = 60_000; // status telat/jaminan bisa berubah dari terminal staf lain

export function useTrackings(session: Session | null) {
  const { data, loading, error, refresh } = useApiResource<TrackingsResponse>(session, '/api/trackings', {
    pollMs: POLL_MS,
  });

  async function postAction(bookingId: string, action: 'cancel' | 'pickup', body?: unknown) {
    if (!session) return { error: 'Belum login' };
    try {
      await apiFetch(session, `/api/bookings/${bookingId}/${action}`, {
        method: 'POST',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  const cancelBooking = (bookingId: string) => postAction(bookingId, 'cancel');
  // Dialog konfirmasi jaminan saat Ambil (brief 15 Nov 2026, Bagian B) —
  // deposit opsional: {type, amount?, note?} kalau vendor pilih/ganti
  // jaminan di dialog, atau tidak dikirim sama sekali kalau "tanpa
  // jaminan" (perilaku lama tetap sama, backward-compatible).
  const pickupBooking = (bookingId: string, deposit?: { type: string; amount?: number; note?: string | null }) =>
    postAction(bookingId, 'pickup', deposit ? { deposit } : undefined);

  // Ubah Jadwal (status dipesan) / Perpanjang (status aktif) — Tahap 2,
  // migration 055. Dua endpoint terpisah, lihat backend/src/routes/trackings.ts.
  // Mengembalikan error mentah dari server (termasuk pesan "lewat batas
  // H-N" dari reschedule) supaya RescheduleModal bisa menampilkan dialog
  // konfirmasi "Tetap ubah?" alih-alih cuma pesan error biasa.
  async function rescheduleBooking(
    bookingId: string,
    body: { start_date: string; end_date: string; total_price?: number; reason?: string },
  ) {
    if (!session) return { error: 'Belum login', data: null };
    try {
      const result = await apiFetch<{ start_date: string; end_date: string; total_price: number }>(
        session,
        `/api/bookings/${bookingId}/reschedule`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      await refresh();
      return { error: null, data: result };
    } catch (err) {
      return { error: (err as Error).message, data: null };
    }
  }

  async function extendBooking(bookingId: string, body: { end_date: string; total_price?: number; reason?: string }) {
    if (!session) return { error: 'Belum login', data: null };
    try {
      const result = await apiFetch<{ end_date: string; total_price: number }>(
        session,
        `/api/bookings/${bookingId}/extend`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      await refresh();
      return { error: null, data: result };
    } catch (err) {
      return { error: (err as Error).message, data: null };
    }
  }

  // Ubah Alat (migration 061, brief 14 Nov 2026) — booking 'dipesan'
  // saja, tanggal tidak berubah. `items` kembali dari respons (bentuk
  // sama TrackingBooking.items) supaya pemanggil (UbahAlatModal.tsx)
  // bisa langsung susun struk WA tanpa refetch terpisah, pola sama
  // rescheduleBooking/extendBooking di atas.
  async function updateBookingItems(
    bookingId: string,
    body: {
      items: { item_id: string; quantity: number; bundle_instance_id?: string | null }[];
      sale_items?: { sale_item_id: string; quantity: number }[];
      total_price?: number;
      reason?: string;
    },
  ) {
    if (!session) return { error: 'Belum login', data: null };
    try {
      const result = await apiFetch<{
        total_price: number;
        items: {
          item_id: string;
          name: string;
          quantity: number;
          price_per_day: number;
          subtotal: number;
          bundle_instance_id?: string | null;
          bundle_name?: string | null;
          bundle_quantity?: number | null;
        }[];
        sale_items: { sale_item_id: string; name: string; quantity: number; price_at_booking: number; subtotal: number }[];
      }>(session, `/api/bookings/${bookingId}/items`, { method: 'PATCH', body: JSON.stringify(body) });
      await refresh();
      return { error: null, data: result };
    } catch (err) {
      return { error: (err as Error).message, data: null };
    }
  }

  return {
    bookings: data?.bookings ?? [],
    toleranceHours: data?.tolerance_hours ?? 6,
    rescheduleDeadlineDays: data?.reschedule_deadline_days ?? null,
    publicPageSlug: data?.public_page_slug ?? null,
    lateFeeMode: data?.late_fee_mode ?? 'bertahap_12jam',
    loading,
    error,
    refresh,
    cancelBooking,
    pickupBooking,
    rescheduleBooking,
    extendBooking,
    updateBookingItems,
  };
}
