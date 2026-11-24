// Rencana bayar (brief rencana-bayar-bebaskan-denda 24 Nov 2026) --
// logika validasi murni, diekstrak dari routes/bookingRequests.ts dan
// routes/bookings.ts supaya testable tanpa Express/Supabase (pola sama
// lib/bookingItems.ts, lib/saleItems.ts).

export type PaymentPlanValue = 'transfer' | 'qris' | 'cash';

export const PAYMENT_PLAN_VALUES: readonly PaymentPlanValue[] = ['transfer', 'qris', 'cash'];

export function isValidPaymentPlanValue(value: unknown): value is PaymentPlanValue {
  return typeof value === 'string' && (PAYMENT_PLAN_VALUES as readonly string[]).includes(value);
}

// Dipakai routes/bookingRequests.ts (Pesanan Online) -- cara bayar yang
// dipilih pelanggan harus salah satu yang memang AKTIF di rental itu
// SAAT INI (public_pages.pay_*_enabled), bukan cuma nilai yang valid
// secara format.
export function isPaymentMethodActiveForPage(
  method: unknown,
  page: { pay_transfer_enabled: boolean; pay_qris_enabled: boolean; pay_cash_enabled: boolean },
): method is PaymentPlanValue {
  if (!isValidPaymentPlanValue(method)) return false;
  if (method === 'transfer') return page.pay_transfer_enabled;
  if (method === 'qris') return page.pay_qris_enabled;
  return page.pay_cash_enabled;
}

// Dipakai routes/bookings.ts -- sanitasi p_payment_plan sebelum dikirim
// ke create_booking_atomic (RPC sendiri JUGA memvalidasi ulang, defense
// in depth, pola sama item_id/bundle_id).
export function sanitizePaymentPlan(value: unknown): PaymentPlanValue | null {
  return isValidPaymentPlanValue(value) ? value : null;
}
