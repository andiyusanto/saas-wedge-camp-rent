import { useMemo, useState } from 'react';
import { X, Wrench, Search, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { useItems } from '../hooks/useItems';
import type { Item } from '../hooks/useItems';
import { buildReceiptData } from '../hooks/useTrackings';
import type { TrackingBooking } from '../hooks/useTrackings';
import { formatIDR, rentalDays, computeItemRentalPrice, generateWhatsAppReceipt, getWhatsAppShareUrl } from '../utils/formatters';

type SavedResultItem = { item_id: string; name: string; quantity: number; price_per_day: number; subtotal: number };
type ActionResult = { error: string | null; data: { total_price: number; items: SavedResultItem[] } | null };

function itemRentalPrice(item: Item, days: number): number {
  return computeItemRentalPrice(
    {
      price_per_day: item.price_per_day,
      day2_rate: item.day2_rate,
      day3_rate: item.day3_rate,
      day4_rate: item.day4_rate,
      day5_rate: item.day5_rate,
      extra_day_rate: item.extra_day_rate,
    },
    days,
  );
}

// Ubah Alat (migration 061, brief 14 Nov 2026) — HANYA untuk booking
// berstatus 'dipesan' ("Siap Diambil"), tanggal TIDAK berubah di sini
// (beda dari RescheduleModal.tsx). Preview harga di modal ini SENGAJA
// perkiraan (bukan final): alat yang SUDAH ADA di booking diestimasi
// proporsional dari subtotal snapshot LAMA (tidak tahu rincian tarif
// bertingkat day2..5/extra dari sini, cuma flat price_per_day+subtotal
// yang dikirim GET /trackings) sampai quantity-nya diubah — angka FINAL
// selalu dihitung ulang server-side (PATCH /bookings/:id/items, pakai
// snapshot asli), persis seperti subtotal booking_items lainnya di app
// ini (trust-the-server, bukan trust-the-client).
export function UbahAlatModal({
  isOpen,
  onClose,
  booking,
  businessId,
  updateBookingItems,
  businessName,
  businessAddress,
  businessLogoUrl,
  onDone,
}: {
  isOpen: boolean;
  onClose: () => void;
  booking: TrackingBooking | null;
  businessId: string;
  updateBookingItems: (
    bookingId: string,
    body: { items: { item_id: string; quantity: number }[]; total_price?: number; reason?: string },
  ) => Promise<ActionResult>;
  businessName: string;
  businessAddress: string | null;
  businessLogoUrl: string | null;
  onDone: () => void;
}) {
  const { items } = useItems(businessId);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [reason, setReason] = useState('');
  const [overrideTotal, setOverrideTotal] = useState(false);
  const [totalPrice, setTotalPrice] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);
  const [savedResult, setSavedResult] = useState<{ total_price: number; items: SavedResultItem[] } | null>(null);

  // Rules of Hooks: useMemo HARUS di atas early return `!isOpen ||
  // !booking` di bawah, bukan sesudahnya -- bug nyata ditemukan Playwright
  // (React "change in the order of Hooks"): saat isOpen=false, render
  // sebelumnya ini lewati useMemo sama sekali (return null duluan),
  // menggeser urutan hook antar render.
  const filteredItems = useMemo(() => {
    const q = itemSearchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.category ?? '').toLowerCase().includes(q) ||
        (item.variant ?? '').toLowerCase().includes(q),
    );
  }, [items, itemSearchQuery]);

  if (!isOpen || !booking) return null;

  if (initialisedFor !== booking.id) {
    const initial: Record<string, number> = {};
    for (const bi of booking.items) initial[bi.item_id] = bi.quantity;
    setQuantities(initial);
    setItemSearchQuery('');
    setReason('');
    setOverrideTotal(false);
    setTotalPrice(String(booking.total_price));
    setError(null);
    setSavedResult(null);
    setInitialisedFor(booking.id);
  }

  const days = rentalDays(booking.start_date, booking.end_date, booking.rental_day_mode);
  const existingById = new Map(booking.items.map((bi) => [bi.item_id, bi]));

  const selectedEntries = Object.entries(quantities).filter(([, qty]) => qty > 0);

  // Estimasi subtotal per baris — existing (proporsional dari subtotal
  // snapshot lama) vs baru (tarif katalog live). CUMA untuk preview,
  // lihat catatan di atas komponen.
  function estimateSubtotal(itemId: string, qty: number): number {
    const prior = existingById.get(itemId);
    if (prior && prior.subtotal != null && prior.quantity > 0) {
      return Math.round((prior.subtotal / prior.quantity) * qty);
    }
    const catalogItem = items.find((i) => i.id === itemId);
    if (!catalogItem) return 0;
    return qty * itemRentalPrice(catalogItem, days);
  }

  const estimatedTotal = selectedEntries.reduce((sum, [itemId, qty]) => sum + estimateSubtotal(itemId, qty), 0);

  function setQuantity(itemId: string, qty: number, maxUnits?: number) {
    const clamped = Math.max(0, maxUnits != null ? Math.min(qty, maxUnits) : qty);
    setQuantities((prev) => ({ ...prev, [itemId]: clamped }));
  }

  function toggleItem(itemId: string, checked: boolean) {
    setQuantities((prev) => ({ ...prev, [itemId]: checked ? 1 : 0 }));
  }

  async function handleSubmit() {
    if (!booking) return;
    if (selectedEntries.length === 0) {
      setError('Minimal satu alat harus tersisa. Kalau mau membatalkan seluruhnya, gunakan tombol Batalkan.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const body = {
      items: selectedEntries.map(([item_id, quantity]) => ({ item_id, quantity })),
      reason: reason.trim() || undefined,
      ...(overrideTotal ? { total_price: Number(totalPrice) || 0 } : {}),
    };
    const result = await updateBookingItems(booking.id, body);

    setSubmitting(false);
    if (result.error || !result.data) {
      setError(result.error);
      return;
    }
    setSavedResult(result.data);
  }

  function handleShareWA() {
    if (!booking || !savedResult || !booking.customer?.phone) return;
    const updatedBooking = { ...booking, items: savedResult.items, total_price: savedResult.total_price };
    const text = generateWhatsAppReceipt(buildReceiptData(updatedBooking, businessName, businessAddress, businessLogoUrl));
    window.open(getWhatsAppShareUrl(booking.customer.phone, text), '_blank');
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-lg rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between rounded-t-2xl">
          <h3 className="font-bold text-base flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            Ubah Alat
          </h3>
          <button onClick={onClose} className="text-white hover:opacity-80">
            <X className="w-5 h-5" />
          </button>
        </div>

        {savedResult ? (
          <div className="p-5 space-y-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-[#2B4739]">
              <CheckCircle2 className="w-4 h-4" /> Daftar alat baru tersimpan.
            </p>
            <div className="p-2.5 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-xs space-y-1">
              <p>
                {booking.booking_number} · {booking.customer?.name}
              </p>
              {savedResult.items.map((it) => (
                <p key={it.item_id} className="flex items-center justify-between">
                  <span>
                    {it.name} × {it.quantity}
                  </span>
                  <span className="font-semibold">{formatIDR(it.subtotal)}</span>
                </p>
              ))}
              <p className="font-bold text-[#26302B] pt-1 border-t border-[#DBD5C1] flex items-center justify-between">
                <span>Total</span>
                <span>{formatIDR(savedResult.total_price)}</span>
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-[#E6E1D2]">
              <button
                type="button"
                onClick={handleShareWA}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition flex items-center justify-center gap-1.5"
              >
                <Send className="w-4 h-4 text-[#A65C2A]" />
                Kirim Rincian Baru via WA
              </button>
              <button
                type="button"
                onClick={onDone}
                className="px-4 py-2.5 rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] font-semibold text-sm"
              >
                Selesai
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-3 text-sm">
            <p className="text-[#6E6853]">
              {booking.booking_number} · {booking.customer?.name} · {days} hari (tanggal tidak berubah di sini)
            </p>

            {items.length === 0 ? (
              <p className="text-center text-[#6E6853] py-3 italic bg-white/50 rounded-lg border border-dashed border-[#DBD5C1]">
                Belum ada alat di katalog.
              </p>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6E6853]" />
                  <input
                    type="text"
                    value={itemSearchQuery}
                    onChange={(e) => setItemSearchQuery(e.target.value)}
                    placeholder="Cari alat..."
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                  />
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {filteredItems.map((item) => {
                    const qty = quantities[item.id] ?? 0;
                    const checked = qty > 0;
                    const subtotal = checked ? estimateSubtotal(item.id, qty) : 0;
                    const isExisting = existingById.has(item.id);

                    return (
                      <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-[#DBD5C1]">
                        <label className="flex-1 min-w-0 pr-2 flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleItem(item.id, e.target.checked)}
                            className="w-4 h-4 accent-[#2B4739] shrink-0"
                          />
                          <span className="min-w-0">
                            <p className="font-bold text-[#26302B] truncate">
                              {item.name}
                              {isExisting && <span className="ml-1.5 text-[9px] font-semibold text-[#2B4739] uppercase">Sudah ada</span>}
                            </p>
                            <p className="text-[11px] text-[#6E6853]">
                              {!checked && <>{formatIDR(item.price_per_day)}/hr</>}
                              {checked && (
                                <>
                                  ~<strong className="text-[#2B4739]">{formatIDR(subtotal)}</strong>
                                </>
                              )}
                            </p>
                          </span>
                        </label>

                        {checked && (
                          <div className="flex items-center gap-1 bg-[#F1EEE2] rounded-lg p-1 border border-[#DBD5C1] shrink-0">
                            <button
                              type="button"
                              onClick={() => setQuantity(item.id, qty - 1, item.total_units)}
                              className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition"
                            >
                              -
                            </button>
                            <span className="w-6 text-center font-bold text-[#26302B] text-xs">{qty}</span>
                            <button
                              type="button"
                              onClick={() => setQuantity(item.id, qty + 1, item.total_units)}
                              className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {selectedEntries.length === 0 && (
              <p className="text-xs font-semibold text-[#A8412E] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Minimal satu alat harus tersisa. Kalau mau membatalkan
                seluruhnya, gunakan tombol Batalkan, bukan Ubah Alat.
              </p>
            )}

            <div>
              <label className="block font-semibold text-[#26302B] mb-1">Alasan perubahan (opsional)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="mis. pelanggan minta tambah alat saat ambil"
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
            </div>

            <div className="pt-2 border-t border-[#E6E1D2] space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-[#26302B]">
                <input type="checkbox" checked={overrideTotal} onChange={(e) => setOverrideTotal(e.target.checked)} className="accent-[#2B4739]" />
                Ubah total harga manual (default: dihitung ulang otomatis)
              </label>
              {overrideTotal ? (
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={totalPrice}
                  onChange={(e) => setTotalPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold"
                />
              ) : (
                <p className="text-[11px] text-[#6E6853]">Perkiraan total baru: {formatIDR(estimatedTotal)} (angka final dihitung server).</p>
              )}
            </div>

            {error && <p className="text-xs font-semibold text-[#A8412E]">{error}</p>}

            <div className="flex items-center gap-3 pt-2 border-t border-[#E6E1D2]">
              <button
                type="button"
                disabled={submitting || selectedEntries.length === 0}
                onClick={handleSubmit}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition disabled:opacity-60"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
              <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] font-semibold text-sm">
                Batal
              </button>
            </div>
          </div>
        )}
      </ModalPanel>
    </ModalBackdrop>
  );
}
