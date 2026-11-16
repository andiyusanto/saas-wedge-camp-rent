import { useMemo, useState } from 'react';
import { X, Wrench, Search, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { useItems } from '../hooks/useItems';
import type { Item } from '../hooks/useItems';
import { useSaleItems } from '../hooks/useSaleItems';
import type { SaleItem } from '../hooks/useSaleItems';
import { buildReceiptData } from '../hooks/useTrackings';
import type { TrackingBooking } from '../hooks/useTrackings';
import { formatIDR, rentalDays, computeItemRentalPrice, generateWhatsAppReceipt, getWhatsAppShareUrl } from '../utils/formatters';

type SavedResultItem = {
  item_id: string;
  name: string;
  quantity: number;
  price_per_day: number;
  subtotal: number;
  bundle_instance_id?: string | null;
  bundle_name?: string | null;
};
type SavedResultSaleItem = { sale_item_id: string; name: string; quantity: number; price_at_booking: number; subtotal: number };
type ActionResult = {
  error: string | null;
  data: { total_price: number; items: SavedResultItem[]; sale_items: SavedResultSaleItem[] } | null;
};

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

// Paket Alat Tahap 1 (brief 15 Nov 2026, migration 064) -- rowKey
// mencocokkan pola backend (lib/bookingItems.ts rowKey()): item_id yang
// sama bisa punya 2 baris berbeda (komponen paket + alat tambahan biasa,
// harganya BEDA) -- harus dibedakan lewat bundle_instance_id, bukan
// cuma item_id, supaya quantities state ini tidak menimpa salah satunya.
function rowKey(itemId: string, bundleInstanceId: string | null | undefined): string {
  return `${itemId}::${bundleInstanceId ?? ''}`;
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
//
// Baris komponen paket (bundle_instance_id != null) ditampilkan
// terkelompok di bawah header "Paket X" — mengubah/menghapus salah satu
// baris grup itu MELEPAS label paket untuk SELURUH baris sisa grup
// (ditegakkan server-side, lib/bookingItems.ts groupsToRelease; harga
// baris lain di grup yang sama TIDAK ikut berubah, cuma porsi baris yang
// disentuh yang berubah/hilang — brief "Alat Dalam Paket Dikurangi").
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
    body: {
      items: { item_id: string; quantity: number; bundle_instance_id?: string | null }[];
      sale_items?: { sale_item_id: string; quantity: number }[];
      total_price?: number;
      reason?: string;
    },
  ) => Promise<ActionResult>;
  businessName: string;
  businessAddress: string | null;
  businessLogoUrl: string | null;
  onDone: () => void;
}) {
  const { items, inactiveItems } = useItems(businessId);
  const { saleItems, inactiveSaleItems } = useSaleItems(businessId);
  // Kunci: rowKey(item_id, bundle_instance_id) untuk baris existing (paket
  // ATAU plain), atau rowKey(item_id, null) untuk alat baru yang ditambah.
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- keyed sale_item_id
  // langsung (tidak perlu rowKey, tidak ada konsep paket untuk barang jual).
  const [saleQuantities, setSaleQuantities] = useState<Record<string, number>>({});
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [reason, setReason] = useState('');
  const [overrideTotal, setOverrideTotal] = useState(false);
  const [totalPrice, setTotalPrice] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);
  const [savedResult, setSavedResult] = useState<{ total_price: number; items: SavedResultItem[]; sale_items: SavedResultSaleItem[] } | null>(null);

  // Rules of Hooks: useMemo HARUS di atas early return `!isOpen ||
  // !booking` di bawah, bukan sesudahnya -- bug nyata ditemukan Playwright
  // (React "change in the order of Hooks"): saat isOpen=false, render
  // sebelumnya ini lewati useMemo sama sekali (return null duluan),
  // menggeser urutan hook antar render.
  //
  // Review -c2 (14 Nov 2026): daftar alat = aktif + alat NONAKTIF yang
  // SUDAH ADA di booking ini (`booking?.items`, dioptionalchain karena
  // `booking` bisa null di titik ini, sebelum early return di bawah) --
  // vendor tetap bisa melihat/mengubah jumlah/menghapusnya, tapi alat
  // nonaktif yang BELUM pernah ada di booking ini TIDAK ditawarkan
  // sebagai pilihan tambah (server/RPC juga menegakkan ini, migration
  // 061 -c2 -- lihat apply_booking_item_changes).
  const pickerItems = useMemo(() => {
    const existingIds = new Set((booking?.items ?? []).map((bi) => bi.item_id));
    const existingInactive = inactiveItems.filter((i) => existingIds.has(i.id));
    return [...items, ...existingInactive];
  }, [items, inactiveItems, booking]);

  const filteredItems = useMemo(() => {
    const q = itemSearchQuery.trim().toLowerCase();
    if (!q) return pickerItems;
    return pickerItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.category ?? '').toLowerCase().includes(q) ||
        (item.variant ?? '').toLowerCase().includes(q),
    );
  }, [pickerItems, itemSearchQuery]);

  // Baris paket (bundle_instance_id != null), dikelompokkan per instance
  // -- ditampilkan terpisah dari daftar alat biasa di bawah.
  const bundleGroups = useMemo(() => {
    const groups = new Map<string, { bundleName: string; rows: NonNullable<TrackingBooking['items']>[number][] }>();
    for (const bi of booking?.items ?? []) {
      if (!bi.bundle_instance_id) continue;
      const g = groups.get(bi.bundle_instance_id) ?? { bundleName: bi.bundle_name ?? '', rows: [] };
      g.rows.push(bi);
      groups.set(bi.bundle_instance_id, g);
    }
    return groups;
  }, [booking]);

  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- pola PERSIS
  // pickerItems/bundleGroups di atas: useMemo WAJIB di atas early return
  // (Rules of Hooks, catatan di atas) -- bug nyata kedua ditemukan
  // Playwright E2E Barang Jual (16 Nov 2026, "Rendered more hooks than
  // during the previous render") karena hook ini sempat ditaruh SETELAH
  // guard `if (!booking) return null`. `booking` dioptional-chain di sini
  // dengan alasan yang sama seperti pickerItems/bundleGroups.
  const existingSaleByItemId = useMemo(
    () => new Map((booking?.sale_items ?? []).map((bsi) => [bsi.sale_item_id, bsi])),
    [booking],
  );
  const saleItemsPicker = useMemo(() => {
    const existingInactive = inactiveSaleItems.filter((s) => existingSaleByItemId.has(s.id));
    return [...saleItems, ...existingInactive];
  }, [saleItems, inactiveSaleItems, existingSaleByItemId]);

  // Bug Andi 16 Nov 2026: `initialisedFor` sebelumnya TIDAK PERNAH direset
  // saat modal ditutup -- membuka ulang booking YANG SAMA setelah Simpan
  // melewati inisialisasi (initialisedFor === booking.id dari sesi
  // sebelumnya masih tersimpan), jadi `savedResult` lama (layar "sudah
  // tersimpan") dan `quantities` basi tetap tampil, seolah Ubah Alat cuma
  // bisa dipakai sekali per transaksi. Direset di sini (bukan di
  // onClose/useEffect terpisah) -- render-phase state adjustment, pola
  // sama persis komentar "Rules of Hooks" di atas -- supaya saat isOpen
  // balik jadi true nanti, `initialisedFor !== booking.id` otomatis benar
  // lagi dan blok inisialisasi di bawah jalan ulang dari booking TERBARU
  // (prop ini sudah hasil refetch GET /trackings setelah Simpan, bukan
  // objek booking lama).
  if (!isOpen) {
    if (initialisedFor !== null) setInitialisedFor(null);
    return null;
  }
  if (!booking) return null;

  if (initialisedFor !== booking.id) {
    const initial: Record<string, number> = {};
    for (const bi of booking.items) initial[rowKey(bi.item_id, bi.bundle_instance_id)] = bi.quantity;
    setQuantities(initial);
    const initialSale: Record<string, number> = {};
    for (const bsi of booking.sale_items) initialSale[bsi.sale_item_id] = bsi.quantity;
    setSaleQuantities(initialSale);
    setItemSearchQuery('');
    setReason('');
    setOverrideTotal(false);
    setTotalPrice(String(booking.total_price));
    setError(null);
    setSavedResult(null);
    setInitialisedFor(booking.id);
  }

  const days = rentalDays(booking.start_date, booking.end_date, booking.rental_day_mode);
  // existingByKey: utk estimasi preview per baris -- dicocokkan per
  // KUNCI (item_id+bundle_instance_id), BUKAN item_id saja, supaya baris
  // komponen paket dan baris alat biasa yang item_id-nya sama tidak
  // saling menimpa estimasinya (koordinator 15 Nov 2026, lihat komentar
  // rowKey() di atas).
  const existingByKey = new Map(booking.items.map((bi) => [rowKey(bi.item_id, bi.bundle_instance_id), bi]));
  // Dipakai picker alat biasa (bagian bawah) -- cuma peduli baris PLAIN
  // (bundle_instance_id null), supaya tidak bingung dengan baris paket.
  const existingPlainByItemId = new Map(booking.items.filter((bi) => !bi.bundle_instance_id).map((bi) => [bi.item_id, bi]));

  const selectedEntries = Object.entries(quantities).filter(([, qty]) => qty > 0);

  // Estimasi subtotal per baris — existing (proporsional dari subtotal
  // snapshot lama) vs baru (tarif katalog live). CUMA untuk preview,
  // lihat catatan di atas komponen.
  function estimateSubtotalForKey(key: string, itemId: string, qty: number): number {
    const prior = existingByKey.get(key);
    if (prior && prior.subtotal != null && prior.quantity > 0) {
      return Math.round((prior.subtotal / prior.quantity) * qty);
    }
    const catalogItem = items.find((i) => i.id === itemId);
    if (!catalogItem) return 0;
    return qty * itemRentalPrice(catalogItem, days);
  }

  const rentalEstimatedTotal = selectedEntries.reduce((sum, [key, qty]) => {
    const itemId = key.split('::')[0];
    return sum + estimateSubtotalForKey(key, itemId, qty);
  }, 0);

  const selectedSaleEntries = Object.entries(saleQuantities).filter(([, qty]) => qty > 0);
  function estimateSaleSubtotal(saleItemId: string, qty: number): number {
    const prior = existingSaleByItemId.get(saleItemId);
    if (prior) return prior.price_at_booking * qty;
    const catalogItem = saleItemsPicker.find((s) => s.id === saleItemId);
    return catalogItem ? catalogItem.price * qty : 0;
  }
  const saleEstimatedTotal = selectedSaleEntries.reduce((sum, [saleItemId, qty]) => sum + estimateSaleSubtotal(saleItemId, qty), 0);
  const estimatedTotal = rentalEstimatedTotal + saleEstimatedTotal;

  // Maks stepper = stok SEKARANG + jumlah yang SUDAH tertahan di booking
  // ini (menambah balik ke jumlah semula tidak butuh stok tambahan).
  function maxQtyForSaleItem(saleItem: SaleItem): number {
    return saleItem.stock + (existingSaleByItemId.get(saleItem.id)?.quantity ?? 0);
  }

  function setQuantityForKey(key: string, qty: number, maxUnits?: number) {
    const clamped = Math.max(0, maxUnits != null ? Math.min(qty, maxUnits) : qty);
    setQuantities((prev) => ({ ...prev, [key]: clamped }));
  }

  function togglePlainItem(itemId: string, checked: boolean) {
    setQuantityForKey(rowKey(itemId, null), checked ? 1 : 0);
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
      items: selectedEntries.map(([key, quantity]) => {
        const [itemId, bundleInstanceId] = key.split('::');
        return { item_id: itemId, quantity, bundle_instance_id: bundleInstanceId || null };
      }),
      sale_items: selectedSaleEntries.map(([sale_item_id, quantity]) => ({ sale_item_id, quantity })),
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
    const updatedBooking = { ...booking, items: savedResult.items, sale_items: savedResult.sale_items, total_price: savedResult.total_price };
    const text = generateWhatsAppReceipt(buildReceiptData(updatedBooking, businessName, businessAddress, businessLogoUrl));
    window.open(getWhatsAppShareUrl(booking.customer.phone, text), '_blank');
  }

  // Grup paket yang sudah "disentuh" (ada baris quantity-nya berubah
  // dari semula, atau dihapus) -- cuma untuk tampilan info "label
  // dilepas", keputusan FINAL tetap di server (groupsToRelease).
  function isGroupTouched(rows: NonNullable<TrackingBooking['items']>[number][]): boolean {
    return rows.some((row) => (quantities[rowKey(row.item_id, row.bundle_instance_id)] ?? 0) !== row.quantity);
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
              {savedResult.items.map((it, idx) => (
                <p key={`${it.item_id}-${idx}`} className="flex items-center justify-between">
                  <span>
                    {it.bundle_name ? `${it.bundle_name} — ` : ''}
                    {it.name} × {it.quantity}
                  </span>
                  <span className="font-semibold">{formatIDR(it.subtotal)}</span>
                </p>
              ))}
              {savedResult.sale_items.map((s, idx) => (
                <p key={`${s.sale_item_id}-${idx}`} className="flex items-center justify-between">
                  <span>{s.name} × {s.quantity}</span>
                  <span className="font-semibold">{formatIDR(s.subtotal)}</span>
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

            {bundleGroups.size > 0 && (
              <div className="space-y-2">
                {[...bundleGroups.entries()].map(([instanceId, group]) => {
                  const touched = isGroupTouched(group.rows);
                  return (
                    <div key={instanceId} className="rounded-lg border border-[#DBD5C1] bg-[#F1EEE2] p-2.5 space-y-1.5">
                      <p className="font-bold text-[#26302B] text-xs">Paket {group.bundleName}</p>
                      {group.rows.map((row) => {
                        const key = rowKey(row.item_id, row.bundle_instance_id);
                        const qty = quantities[key] ?? 0;
                        const subtotal = estimateSubtotalForKey(key, row.item_id, qty);
                        return (
                          <div key={key} className="flex items-center justify-between py-0.5 text-[11px]">
                            <span className="text-[#26302B]">
                              {row.name} {qty > 0 ? `(~${formatIDR(subtotal)})` : <span className="text-[#A8412E] font-semibold">dihapus</span>}
                            </span>
                            <div className="flex items-center gap-1 bg-white rounded p-0.5 border border-[#DBD5C1] shrink-0">
                              <button
                                type="button"
                                onClick={() => setQuantityForKey(key, qty - 1)}
                                className="w-5 h-5 rounded bg-[#F1EEE2] font-bold hover:bg-[#DBD5C1] text-[#26302B]"
                              >
                                −
                              </button>
                              <span className="w-5 text-center font-bold text-[#26302B]">{qty}</span>
                              <button
                                type="button"
                                onClick={() => setQuantityForKey(key, qty + 1, row.quantity)}
                                disabled={qty >= row.quantity}
                                className="w-5 h-5 rounded bg-[#F1EEE2] font-bold hover:bg-[#DBD5C1] text-[#26302B] disabled:opacity-40"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {touched && (
                        <p className="text-[10px] text-[#A65C2A] font-semibold pt-1">
                          Isi paket diubah. Harga dihitung dari porsi paket, label paket dilepas untuk baris yang diubah.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

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
                    const key = rowKey(item.id, null);
                    const qty = quantities[key] ?? 0;
                    const checked = qty > 0;
                    const subtotal = checked ? estimateSubtotalForKey(key, item.id, qty) : 0;
                    const isExisting = existingPlainByItemId.has(item.id);

                    return (
                      <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-[#DBD5C1]">
                        <label className="flex-1 min-w-0 pr-2 flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => togglePlainItem(item.id, e.target.checked)}
                            className="w-4 h-4 accent-[#2B4739] shrink-0"
                          />
                          <span className="min-w-0">
                            <p className="font-bold text-[#26302B] truncate">
                              {item.name}
                              {isExisting && <span className="ml-1.5 text-[9px] font-semibold text-[#2B4739] uppercase">Sudah ada</span>}
                              {item.deactivated_at && (
                                <span className="ml-1.5 text-[9px] font-semibold text-[#A8412E] uppercase">Nonaktif</span>
                              )}
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
                              onClick={() => setQuantityForKey(key, qty - 1, item.total_units)}
                              className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition"
                            >
                              -
                            </button>
                            <span className="w-6 text-center font-bold text-[#26302B] text-xs">{qty}</span>
                            <button
                              type="button"
                              onClick={() => setQuantityForKey(key, qty + 1, item.total_units)}
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

            {/* Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- bagian
                lipat, HANYA tampil kalau ada pilihan barang jual (katalog
                aktif ATAU sudah ada di booking ini). Mengurangi/menghapus
                di sini otomatis mengembalikan selisih stok server-side
                (apply_booking_item_and_sale_changes, migration 066). */}
            {saleItemsPicker.length > 0 && (
              <details className="space-y-2">
                <summary className="font-bold text-[#26302B] cursor-pointer text-xs">
                  Tambahan: barang jual {selectedSaleEntries.length > 0 ? `(${selectedSaleEntries.length})` : ''}
                </summary>
                <div className="space-y-1.5 pt-1.5">
                  {saleItemsPicker.map((saleItem) => {
                    const qty = saleQuantities[saleItem.id] ?? 0;
                    const maxQty = maxQtyForSaleItem(saleItem);
                    return (
                      <div key={saleItem.id} className="flex items-center justify-between p-2 rounded-lg bg-white border border-[#DBD5C1]">
                        <div className="flex-1 min-w-0 pr-2">
                          <p className="font-semibold text-[#26302B] text-xs truncate">
                            {saleItem.name}
                            {saleItem.deactivated_at && (
                              <span className="ml-1.5 text-[9px] font-semibold text-[#A8412E] uppercase">Nonaktif</span>
                            )}
                          </p>
                          <p className="text-[11px] text-[#6E6853]">{formatIDR(saleItem.price)} · Stok: {saleItem.stock}</p>
                        </div>
                        <div className="flex items-center gap-1 bg-[#F1EEE2] rounded-lg p-1 border border-[#DBD5C1] shrink-0">
                          <button
                            type="button"
                            onClick={() => setSaleQuantities((prev) => ({ ...prev, [saleItem.id]: Math.max(0, qty - 1) }))}
                            className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition"
                          >
                            -
                          </button>
                          <span className="w-6 text-center font-bold text-[#26302B] text-xs">{qty}</span>
                          <button
                            type="button"
                            onClick={() => setSaleQuantities((prev) => ({ ...prev, [saleItem.id]: Math.min(maxQty, qty + 1) }))}
                            disabled={qty >= maxQty}
                            className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
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
