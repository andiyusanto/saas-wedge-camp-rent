import type { SupabaseClient } from '@supabase/supabase-js';

export type BookingItemRow = {
  item_id: string;
  quantity: number;
  bookings: { start_date: string; end_date: string; status: string } | null;
};

const ACTIVE_STATUSES = new Set(['aktif', 'telat']);

export async function fetchActiveBookingItems(supabase: SupabaseClient): Promise<BookingItemRow[]> {
  const { data, error } = await supabase
    .from('booking_items')
    .select('item_id, quantity, bookings(start_date, end_date, status)');

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BookingItemRow[];
}

export function usedUnitsOn(bookingItems: BookingItemRow[], itemId: string, dateStr: string): number {
  return bookingItems
    .filter((bi) => {
      const booking = bi.bookings;
      return (
        bi.item_id === itemId &&
        booking !== null &&
        ACTIVE_STATUSES.has(booking.status) &&
        booking.start_date <= dateStr &&
        booking.end_date >= dateStr
      );
    })
    .reduce((sum, bi) => sum + bi.quantity, 0);
}
