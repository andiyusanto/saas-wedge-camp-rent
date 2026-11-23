import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { X, Calendar, Plus, CheckCircle2, User, ShieldCheck, History, Search, Camera, Image, Trash2 } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { useItems } from '../hooks/useItems';
import type { Item } from '../hooks/useItems';
import { useBundles } from '../hooks/useBundles';
import type { Bundle } from '../hooks/useBundles';
import { useSaleItems } from '../hooks/useSaleItems';
import type { Business } from '../hooks/useBusiness';
import { apiFetch } from '../lib/api';
import { useCustomerSearch, fetchCustomerHistorySummary } from '../hooks/useCustomerSearch';
import type { CustomerMatch, CustomerHistorySummary } from '../hooks/useCustomerSearch';
import { resizeImageToDataUrl } from '../utils/imageResize';
import {
  formatIDR,
  formatDateIndo,
  rentalDays,
  addDaysStr,
  todayStr,
  generateWhatsAppReceipt,
  getWhatsAppShareUrl,
  depositLabel,
  computeItemRentalPrice,
  combinedComponentRates,
  applyBundleDiscount,
  allocateBundlePrice,
  formatRentalDuration,
  endDateForDays,
} from '../utils/formatters';

// Paket Alat Tahap 1 (brief 15 Nov 2026, migration 064) — satu paket
// "dipecah" jadi booking_items per komponen TEPAT di sini (sebelum POST
// /bookings), item/nama/alat satuan tidak pernah melihat soal paket di
// level backend sama sekali. items (katalog, bukan cuma bundle.bundle_items
// yang hanya punya item_id+quantity) dibutuhkan untuk tarif komponen.
// overrides: quantity EFEKTIF per item_id yang sudah diubah manual dari
// resep aslinya (recipeQty × bundleQty) -- kosong/tidak ada entri =
// dipakai apa adanya dari resep (penanda paket dipertahankan). Tiap
// baris yang di-override dilepas penanda paketnya (koordinator 15 Nov
// 2026, "Alat Dalam Paket Dikurangi") TAPI subtotal baris SISA LAIN di
// grup yang sama TIDAK ikut berubah -- harga teralokasi dari
// allocateBundlePrice() dihitung SEKALI dari resep PENUH (supaya
// "jumlah alokasi sisa + porsi yang dihapus = total paket awal" persis,
// tanpa redistribusi), baris yang diubah cuma diskalakan linear dari
// porsi alokasinya SENDIRI (porsi per unit × quantity efektif baru).
function explodeBundleToComponents(
  bundle: Bundle,
  bundleQty: number,
  days: number,
  catalogItems: Item[],
  instanceId: string,
  overrides: Record<string, number> = {},
) {
  const components = bundle.bundle_items
    .map((bi) => {
      const catalogItem = catalogItems.find((i) => i.id === bi.item_id);
      if (!catalogItem) return null;
      return {
        item_id: bi.item_id,
        quantityPerBundle: bi.quantity,
        catalogRates: {
          price_per_day: catalogItem.price_per_day,
          day2_rate: catalogItem.day2_rate,
          day3_rate: catalogItem.day3_rate,
          day4_rate: catalogItem.day4_rate,
          day5_rate: catalogItem.day5_rate,
          extra_day_rate: catalogItem.extra_day_rate,
        },
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  if (components.length === 0) return null;

  const effectiveRates =
    bundle.pricing_mode === 'sendiri'
      ? {
          price_per_day: bundle.price_per_day ?? 0,
          day2_rate: bundle.day2_rate ?? 0,
          day3_rate: bundle.day3_rate ?? 0,
          day4_rate: bundle.day4_rate ?? 0,
          day5_rate: bundle.day5_rate ?? 0,
          extra_day_rate: bundle.extra_day_rate ?? 0,
        }
      : applyBundleDiscount(combinedComponentRates(components), bundle.discount_type, bundle.discount_value);

  const totalPerInstance = computeItemRentalPrice(effectiveRates, days);
  const totalForAllInstances = totalPerInstance * bundleQty;
  const allocated = allocateBundlePrice(components, totalForAllInstances, days);

  let anyOverridden = false;
  const lines = components
    .map((c) => {
      const recipeQtyTotal = c.quantityPerBundle * bundleQty;
      const override = overrides[c.item_id];
      const effectiveQty = override == null ? recipeQtyTotal : override;
      if (effectiveQty <= 0) {
        anyOverridden = true;
        return null;
      }
      const fullAllocated = allocated.find((a) => a.item_id === c.item_id)!.subtotalPerInstance;
      const touched = effectiveQty !== recipeQtyTotal;
      if (touched) anyOverridden = true;
      const subtotal = touched ? Math.round((fullAllocated / recipeQtyTotal) * effectiveQty) : fullAllocated;
      return {
        item_id: c.item_id,
        quantity: effectiveQty,
        subtotal,
        bundle_id: touched ? null : bundle.id,
        bundle_instance_id: touched ? null : instanceId,
        bundle_name: touched ? null : bundle.name,
        bundle_quantity: touched ? null : bundleQty,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  return {
    instanceId,
    // Total ditampilkan di preview = jumlah subtotal baris yang BENAR-
    // BENAR disertakan (bukan totalForAllInstances resep penuh) --
    // supaya turun persis sebesar porsi komponen yang dihapus/dikurangi.
    totalForAllInstances: lines.reduce((s, l) => s + l.subtotal, 0),
    anyOverridden,
    lines,
  };
}

type DepositType = '' | 'ktp' | 'sim' | 'stnk' | 'paspor' | 'uang' | 'lainnya';

// Harga sewa N hari untuk satu unit alat (migration 034, harga bertingkat
// per-hari) — satu tempat supaya tidak diulang di tiap pemakaian.
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

function dayRate(item: Item, day: number): number {
  switch (day) {
    case 1:
      return item.price_per_day;
    case 2:
      return item.day2_rate;
    case 3:
      return item.day3_rate;
    case 4:
      return item.day4_rate;
    case 5:
      return item.day5_rate;
    default:
      return item.extra_day_rate;
  }
}

// Rincian tarif per unit untuk preview di Catat Transaksi (bug ditemukan
// lewat screenshot produksi: format lama selalu "{price_per_day}/hr ×
// {days} hr", yang untuk alat bertingkat (migration 034) salah secara
// aritmetika di layar — mis. Tenda Dome 30rb/20rb/10rb untuk 4 hari
// menampilkan "Rp30.000/hr × 4 hr = Rp70.000" (30.000×4 ≠ 70.000) padahal
// TOTALNYA sendiri sudah benar sejak awal, cuma rincian yang ditampilkan
// yang menyesatkan. Kembalikan null kalau harga per hari memang flat
// untuk durasi ini (termasuk days<=1, trivially flat) — caller lalu pakai
// format lama yang sudah familiar. Kalau beda, kembalikan string ringkas
// "30.000 + 20.000 + 10.000×5" (tanpa "Rp" di tiap suku, cuma di total)
// — tingkat yang berurutan dan sama nilainya digabung jadi "{tarif}×{n}"
// supaya tetap ringkas untuk durasi panjang.
function tieredBreakdown(item: Item, days: number): string | null {
  if (days <= 0) return null;
  const rates: number[] = [];
  for (let d = 1; d <= Math.min(days, 5); d++) rates.push(dayRate(item, d));
  if (days > 5) rates.push(...Array(days - 5).fill(item.extra_day_rate));

  if (rates.every((r) => r === item.price_per_day)) return null;

  const groups: { rate: number; count: number }[] = [];
  for (const r of rates) {
    const last = groups[groups.length - 1];
    if (last && last.rate === r) last.count += 1;
    else groups.push({ rate: r, count: 1 });
  }

  const short = (n: number) => n.toLocaleString('id-ID');
  return groups.map((g) => (g.count === 1 ? short(g.rate) : `${short(g.rate)}×${g.count}`)).join(' + ');
}

// Rencana tahap 4: prefill lebih kaya dari sekadar satu alat+tanggal
// (preselectedItemId/preselectedStartDate di atas, dipakai jalur Kalender
// "pesan alat ini") — dipakai saat vendor menekan "Konfirmasi" di bagian
// "Pesanan masuk" (TrackingScreen), yang bisa multi-alat + sudah ada nama
// & nomor WA pelanggan dari booking_requests. Kedua jalur prefill ini
// SENGAJA dibiarkan terpisah (bukan disatukan ke satu prop) — prop lama
// dipakai luas di tempat lain, mengubah bentuknya berisiko regresi di
// jalur yang sudah stabil.
export type BookingRequestPrefill = {
  customerName: string;
  customerPhone: string;
  startDate: string;
  endDate: string;
  // Penanda paket (migration 065, Paket Alat Tahap 2) -- null untuk alat
  // lepas. Baris ber-bundleInstanceId sama dikelompokkan ulang jadi satu
  // pilihan paket saat prefill (lihat useEffect di bawah), KECUALI
  // bundle-nya sudah dinonaktifkan/tidak ditemukan lagi, fallback ke
  // komponen lepas + peringatan.
  items: {
    itemId: string;
    quantity: number;
    bundleId: string | null;
    bundleInstanceId: string | null;
    bundleName: string | null;
    bundleQuantity: number | null;
  }[];
  // Cuma buat ditampilkan sebagai konteks ("Dari pesanan online, perkiraan
  // Rp X") — BUKAN dipakai menghitung total_price transaksi (itu tetap
  // dihitung dari harga katalog SAAT INI seperti biasa, lihat rencana 2.13
  // "harga diubah vendor setelah pesanan masuk" — estimasi lama tidak
  // valid dijadikan harga final).
  estimatedPrice: number;
};

export function NewBookingModal({
  isOpen,
  onClose,
  session,
  business,
  preselectedItemId,
  preselectedBundleId,
  preselectedStartDate,
  requestPrefill,
  onSaved,
  writable = true,
}: {
  isOpen: boolean;
  onClose: () => void;
  session: Session;
  business: Business;
  preselectedItemId?: string | null;
  // Kalender Ketersediaan, grup "Paket" (17 Nov 2026) -- jalur prefill
  // TERPISAH dari preselectedItemId (bukan ganti bentuk prop lama),
  // pakai logika pilih paket yang SUDAH ADA (bundleQuantities/
  // bundleInstanceIds) supaya komponen+alokasi harga sama persis
  // seperti memilih manual lewat checkbox.
  preselectedBundleId?: string | null;
  preselectedStartDate?: string | null;
  requestPrefill?: BookingRequestPrefill | null;
  onSaved: (bookingId: string) => void;
  // Rencana langganan: "Catat Transaksi baru" dikunci kalau hanya-baca —
  // RLS (bookings INSERT, migration 044) tetap penegak sebenarnya,
  // default true supaya pemanggil lama tidak pecah.
  writable?: boolean;
}) {
  const { items } = useItems(business.id);
  const { bundles } = useBundles(business.id);
  const { saleItems } = useSaleItems(business.id);
  const { results: customerSuggestions, search: searchCustomers, clear: clearCustomerSuggestions } =
    useCustomerSearch(business.id);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [historySummary, setHistorySummary] = useState<CustomerHistorySummary | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Audit privasi 2 Nov 2026 — dipisah jadi dua: `customerPhotoKey` (key
  // R2 privat, dikirim ke server saat Simpan) dan `customerPhotoPreview`
  // (data URL LOKAL dari browser, cuma buat pratinjau di form ini sendiri
  // — tidak pernah fetch ulang dari server untuk preview, supaya tidak
  // perlu minta signed URL sebelum transaksinya bahkan tersimpan).
  const [customerPhotoKey, setCustomerPhotoKey] = useState('');
  const [customerPhotoPreview, setCustomerPhotoPreview] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  // "Alat diambil sekarang" (brief 23 Nov 2026, bagian C) -- walk-in yang
  // mencatat Mulai Sewa di masa depan tapi barangnya benar-benar dibawa
  // SEKARANG. Direset kalau startDate berubah jadi hari ini/lampau (lihat
  // handler Mulai Sewa) supaya tidak nyangkut true untuk walk-in biasa.
  const [pickedUpNow, setPickedUpNow] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [bundleQuantities, setBundleQuantities] = useState<Record<string, number>>({});
  // Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- stepper terpisah
  // dari alat sewa, keyed sale_item_id. TIDAK diisi lewat prefill
  // Pesanan Online (brief: belum ada di v1 itu, selalu kosong di awal).
  const [saleQuantities, setSaleQuantities] = useState<Record<string, number>>({});
  // bundle_instance_id harus STABIL selama satu paket masih dipilih di
  // form ini (bukan di-generate ulang tiap render) -- lihat
  // explodeBundleToComponents. overrides: quantity efektif per
  // item_id, PER bundle, kalau vendor mengubah/menghapus salah satu
  // komponen sebelum Simpan (brief "Alat Dalam Paket Dikurangi").
  const [bundleInstanceIds, setBundleInstanceIds] = useState<Record<string, string>>({});
  const [bundleComponentOverrides, setBundleComponentOverrides] = useState<Record<string, Record<string, number>>>({});
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [depositType, setDepositType] = useState<DepositType>('ktp');
  const [depositNote, setDepositNote] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  // Brief 15 Nov 2026 (Bagian B, "Sewa Alat Pendakian": "sering kelupaan
  // minta kartu jaminan ke costumer") — pendekatan PALING RINGAN: cuma
  // muncul untuk walk-in (langsung 'aktif', jaminan sungguhan diterima
  // SEKARANG, bukan nanti lewat dialog Ambil) DAN depositType kosong,
  // supaya tidak menambah friksi di kasus umum (sudah pilih jaminan).
  const [noDepositConfirmed, setNoDepositConfirmed] = useState(false);
  const [dpPaid, setDpPaid] = useState('0');
  // Cara bayar DP (brief Pelunasan 17 Nov 2026) -- opsional, kolom &
  // trigger log_initial_dp_payment() sudah siap (migration 067). '' =
  // tidak dicatat, pola sama baris lama sebelum fitur ini ada.
  const [dpMethod, setDpMethod] = useState('');
  const [autoOpenWA, setAutoOpenWA] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundlePrefillWarning, setBundlePrefillWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (requestPrefill) {
      setStartDate(requestPrefill.startDate);
      setEndDate(requestPrefill.endDate);

      // Paket Alat Tahap 2 — kelompokkan baris ber-bundleInstanceId sama
      // jadi satu pilihan paket (bukan alat lepas satu-satu), KECUALI
      // bundle-nya sudah dinonaktifkan/dihapus dari katalog sejak
      // pesanan masuk — fallback ke komponen lepas (dari snapshot
      // bundleName+quantity pesanan ini, bukan resep live yang mungkin
      // sudah berubah) + peringatan non-blocking.
      const plainQuantities: Record<string, number> = {};
      const nextBundleQuantities: Record<string, number> = {};
      const nextBundleInstanceIds: Record<string, string> = {};
      const fallbackBundleNames = new Set<string>();
      const groupsByInstance = new Map<string, typeof requestPrefill.items>();
      for (const item of requestPrefill.items) {
        if (!item.bundleInstanceId) {
          plainQuantities[item.itemId] = (plainQuantities[item.itemId] ?? 0) + item.quantity;
          continue;
        }
        const group = groupsByInstance.get(item.bundleInstanceId) ?? [];
        group.push(item);
        groupsByInstance.set(item.bundleInstanceId, group);
      }
      for (const group of groupsByInstance.values()) {
        const bundleId = group[0].bundleId!;
        const liveBundle = bundles.find((b) => b.id === bundleId);
        if (liveBundle) {
          // instance_id BARU (bukan dipakai ulang dari pesanan) —
          // instance harus unik per transaksi akhir, sama seperti
          // bundle yang baru dipilih manual oleh staf.
          nextBundleQuantities[bundleId] = group[0].bundleQuantity ?? 1;
          nextBundleInstanceIds[bundleId] = crypto.randomUUID();
        } else {
          for (const item of group) {
            plainQuantities[item.itemId] = (plainQuantities[item.itemId] ?? 0) + item.quantity;
          }
          fallbackBundleNames.add(group[0].bundleName ?? 'paket');
        }
      }
      setQuantities(plainQuantities);
      setBundleQuantities(nextBundleQuantities);
      setBundleInstanceIds(nextBundleInstanceIds);
      setBundleComponentOverrides({});
      setSaleQuantities({});
      setBundlePrefillWarning(
        fallbackBundleNames.size > 0
          ? `Paket ${Array.from(fallbackBundleNames).join(', ')} sudah diubah/dinonaktifkan sejak pesanan masuk — alat tetap terisi otomatis, mohon periksa jumlah & harga.`
          : null,
      );
      setCustomerName(requestPrefill.customerName);
      // Review -c1 (tahap 4, poin 2): customer_phone dari booking_requests
      // tersimpan dalam bentuk kanonik "628xxx" (lihat normalizePhone() di
      // backend/src/routes/bookingRequests.ts) — vendor biasa mengetik dan
      // membaca nomor dalam bentuk lokal "08xx", jadi dikonversi balik di
      // sini SAAT prefill, murni tampilan (nilai yang disimpan ke booking
      // baru tetap dari field customerPhone, boleh dalam bentuk apapun
      // vendor ketik/edit).
      setCustomerPhone(
        requestPrefill.customerPhone.startsWith('62')
          ? '0' + requestPrefill.customerPhone.slice(2)
          : requestPrefill.customerPhone,
      );
    } else {
      const initialStart = preselectedStartDate || todayStr();
      setStartDate(initialStart);
      setEndDate(business.rental_day_mode === 'per_malam' ? addDaysStr(initialStart, 1) : initialStart);
      setQuantities(preselectedItemId ? { [preselectedItemId]: 1 } : {});
      setBundleQuantities(preselectedBundleId ? { [preselectedBundleId]: 1 } : {});
      setBundleInstanceIds(preselectedBundleId ? { [preselectedBundleId]: crypto.randomUUID() } : {});
      setBundleComponentOverrides({});
      setSaleQuantities({});
      setBundlePrefillWarning(null);
      setCustomerName('');
      setCustomerPhone('');
    }
    setItemSearchQuery('');
    setCustomerAddress('');
    setSelectedCustomerId(null);
    setShowSuggestions(false);
    setHistorySummary(null);
    clearCustomerSuggestions();
    setCustomerPhotoKey('');
    setCustomerPhotoPreview('');
    setDepositType('ktp');
    setDepositNote('');
    setDepositAmount('');
    setDpPaid('0');
    setDpMethod('');
    setError(null);
    // bundles sengaja masuk dependency -- useBundles() mulai dari array
    // kosong sebelum fetch-nya selesai; tanpa ini, prefill paket yang
    // terjadi SEBELUM bundles termuat akan salah dianggap "tidak
    // ditemukan" (fallback ke alat lepas padahal paketnya valid).
    // Re-run di sini aman/idempoten -- efek ini SELALU menurunkan ulang
    // state yang sama dari requestPrefill, tidak menimpa edit manual
    // staf (edit manual terjadi di luar efek ini, dependency-nya tidak
    // berubah karenanya).
  }, [isOpen, preselectedItemId, preselectedBundleId, preselectedStartDate, requestPrefill, business.rental_day_mode, bundles]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const days = useMemo(
    () => rentalDays(startDate, endDate, business.rental_day_mode),
    [startDate, endDate, business.rental_day_mode],
  );

  const selectedEntries = useMemo(
    () => Object.entries(quantities).filter(([, qty]) => qty > 0),
    [quantities],
  );

  const filteredItems = useMemo(() => {
    const q = itemSearchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.category ?? '').toLowerCase().includes(q) ||
        (item.variant ?? '').toLowerCase().includes(q) ||
        (item.size ?? '').toLowerCase().includes(q) ||
        (item.color ?? '').toLowerCase().includes(q),
    );
  }, [items, itemSearchQuery]);

  const selectedBundleEntries = useMemo(
    () => Object.entries(bundleQuantities).filter(([, qty]) => qty > 0),
    [bundleQuantities],
  );

  // Dipecah SEKALI di sini (bukan di handleSubmit/receipt masing-masing)
  // supaya preview harga di form dan payload yang dikirim selalu sama
  // persis — satu sumber per render.
  const explodedBundles = useMemo(
    () =>
      selectedBundleEntries
        .map(([bundleId, qty]) => {
          const bundle = bundles.find((b) => b.id === bundleId);
          if (!bundle) return null;
          const instanceId = bundleInstanceIds[bundleId];
          if (!instanceId) return null; // belum di-assign (lihat setBundleQuantity) -- hindari render transisional
          const exploded = explodeBundleToComponents(bundle, qty, days, items, instanceId, bundleComponentOverrides[bundleId] ?? {});
          return exploded ? { bundle, qty, exploded } : null;
        })
        .filter((b): b is NonNullable<typeof b> => b !== null),
    [selectedBundleEntries, bundles, days, items, bundleInstanceIds, bundleComponentOverrides],
  );

  const bundleComponentLines = useMemo(
    () => explodedBundles.flatMap((b) => b.exploded.lines),
    [explodedBundles],
  );

  // Barang Jual (habis pakai), v1 -- flat, TIDAK tergantung jumlah hari
  // (beda dari alat sewa di atas).
  const selectedSaleEntries = Object.entries(saleQuantities).filter(([, qty]) => qty > 0);
  const saleItemsTotal = selectedSaleEntries.reduce((sum, [saleItemId, qty]) => {
    const saleItem = saleItems.find((s) => s.id === saleItemId);
    return saleItem ? sum + qty * saleItem.price : sum;
  }, 0);

  const totalPrice =
    selectedEntries.reduce((sum, [itemId, qty]) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return sum;
      return sum + qty * itemRentalPrice(item, days);
    }, 0) +
    explodedBundles.reduce((sum, b) => sum + b.exploded.totalForAllInstances, 0) +
    saleItemsTotal;

  const remainingPayment = Math.max(0, totalPrice - (Number(dpPaid) || 0));

  function setBundleQuantity(bundleId: string, qty: number) {
    const clamped = Math.max(0, qty);
    setBundleQuantities((prev) => ({ ...prev, [bundleId]: clamped }));
    if (clamped === 0) {
      // Paket dilepas dari pilihan -- bersihkan instance id & override-nya
      // supaya kalau dipilih lagi nanti, mulai dari resep penuh yang segar.
      setBundleInstanceIds((prev) => {
        const next = { ...prev };
        delete next[bundleId];
        return next;
      });
      setBundleComponentOverrides((prev) => {
        const next = { ...prev };
        delete next[bundleId];
        return next;
      });
    } else if (!bundleInstanceIds[bundleId]) {
      setBundleInstanceIds((prev) => ({ ...prev, [bundleId]: crypto.randomUUID() }));
    } else {
      // bundleQty berubah (bukan baru dipilih) -- reset override supaya
      // tidak nyangkut ke resep lama (jumlah komponen efektif ikut
      // berubah mengikuti bundleQty baru, label TETAP karena ini
      // mengubah kontrol jumlah paket, bukan komponen individual).
      setBundleComponentOverrides((prev) => {
        const next = { ...prev };
        delete next[bundleId];
        return next;
      });
    }
  }

  function setBundleComponentOverride(bundleId: string, itemId: string, qty: number) {
    setBundleComponentOverrides((prev) => ({
      ...prev,
      [bundleId]: { ...(prev[bundleId] ?? {}), [itemId]: Math.max(0, qty) },
    }));
  }

  if (!isOpen) return null;

  function toggleItem(itemId: string, checked: boolean) {
    setQuantities((prev) => ({ ...prev, [itemId]: checked ? 1 : 0 }));
  }

  function setQuantity(itemId: string, qty: number, max: number) {
    setQuantities((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(qty, max)) }));
  }

  // Ketikan apapun setelah memilih pelanggan lama dianggap koreksi manual
  // (mis. nomor HP-nya beda dari catatan lama) — jangan diam-diam menimpa
  // data pelanggan lama itu, cukup lepas pilihannya dan perlakukan sebagai
  // pelanggan baru saat disimpan.
  function dropSelectionIfAny() {
    if (selectedCustomerId) {
      setSelectedCustomerId(null);
      setHistorySummary(null);
    }
  }

  function handleNameChange(value: string) {
    setCustomerName(value);
    setShowSuggestions(true);
    dropSelectionIfAny();
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => searchCustomers(value), 300);
  }

  async function selectCustomer(match: CustomerMatch) {
    setCustomerName(match.name);
    setCustomerPhone(match.phone ?? '');
    setCustomerAddress(match.address ?? '');
    setSelectedCustomerId(match.id);
    setShowSuggestions(false);
    clearCustomerSuggestions();
    setHistorySummary(await fetchCustomerHistorySummary(match.id));
  }

  async function handleUploadCustomerPhoto(file: File) {
    setUploadingPhoto(true);
    setError(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      const body = await apiFetch<{ key: string }>(session, '/api/uploads/customer-photo', {
        method: 'POST',
        body: JSON.stringify({ businessId: business.id, image: dataUrl }),
      });
      setCustomerPhotoKey(body.key);
      setCustomerPhotoPreview(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah foto.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // subtotal (migration 034) dihitung sekali di sini dari tarif katalog
    // SAAT INI dan disimpan sebagai snapshot booking_items.subtotal —
    // bukan dihitung ulang dari katalog lagi nanti saat struk/Nota
    // ditampilkan, supaya tidak berubah kalau harga alat diedit belakangan.
    const selectedItems = [
      ...selectedEntries.map(([item_id, quantity]) => {
        const item = items.find((i) => i.id === item_id);
        return { item_id, quantity, subtotal: item ? quantity * itemRentalPrice(item, days) : undefined };
      }),
      ...bundleComponentLines,
    ];
    if (selectedItems.length === 0) {
      setError('Pilih minimal satu alat.');
      return;
    }
    if (business.min_rental_days != null && days < business.min_rental_days) {
      setError(`Minimal sewa ${business.min_rental_days} hari.`);
      return;
    }
    // Jaminan uang tanpa jumlah tidak masuk akal sebagai jaminan (beda
    // dari KTP/SIM/dsb yang memang cuma catatan identitas, tanpa angka)
    // — wajibkan di sini, DIPERKUAT lagi server-side (POST /bookings)
    // supaya jalur lain yang mungkin memanggil endpoint ini langsung
    // tidak bisa melewati validasi ini.
    if (depositType === 'uang' && !(Number(depositAmount) > 0)) {
      setError('Jumlah Deposit Uang wajib diisi (lebih dari 0) untuk jenis jaminan Uang.');
      return;
    }
    // Brief 15 Nov 2026 Bagian B — walk-in tanpa jaminan wajib dikonfirmasi
    // sadar, bukan cuma lupa pilih. Tidak relevan untuk booking 'dipesan'
    // (jaminan sungguhan dikonfirmasi belakangan lewat dialog Ambil).
    if ((startDate <= todayStr() || pickedUpNow) && !depositType && !noDepositConfirmed) {
      setError('Centang konfirmasi tanpa jaminan dulu, atau pilih jenis jaminan.');
      return;
    }
    // Celah ditemukan koordinator 17 Nov 2026 (investigasi "Lebih Rp" di
    // Riwayat) -- DP tidak boleh melebihi Total Harga, DIPERKUAT lagi
    // server-side (POST /bookings, validateDpPaid()) supaya jalur lain
    // yang mungkin memanggil endpoint ini langsung tidak bisa melewati
    // validasi ini.
    if ((Number(dpPaid) || 0) > totalPrice) {
      setError('DP tidak boleh melebihi Total Harga.');
      return;
    }

    setSubmitting(true);

    let body: { id: string; booking_number: string; status: string };
    try {
      body = await apiFetch(session, '/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          businessId: business.id,
          ...(selectedCustomerId
            ? { customer_id: selectedCustomerId }
            : { customer: { name: customerName, phone: customerPhone || null, address: customerAddress || null } }),
          customer_photo_key: customerPhotoKey || null,
          start_date: startDate,
          end_date: endDate,
          items: selectedItems,
          ...(selectedSaleEntries.length > 0
            ? { sale_items: selectedSaleEntries.map(([sale_item_id, quantity]) => ({ sale_item_id, quantity })) }
            : {}),
          deposit: depositType ? { type: depositType, amount: depositAmount, note: depositNote || null } : null,
          total_price: totalPrice,
          dp_paid: Number(dpPaid) || 0,
          dp_method: dpMethod || null,
          ...(pickedUpNow ? { picked_up_now: true } : {}),
        }),
      });
    } catch (err) {
      setSubmitting(false);
      setError((err as Error).message);
      return;
    }
    setSubmitting(false);

    // Booking sudah tersimpan di server pada titik ini — kegagalan bikin
    // draft struk WA (mis. katalog lokal belum sempat refresh) tidak boleh
    // menahan modal ini tertutup atau bikin layar nyangkut.
    if (autoOpenWA && customerPhone) {
      try {
        const receiptItems = [
          ...selectedEntries
            .map(([itemId, qty]) => {
              const item = items.find((i) => i.id === itemId);
              return item
                ? { name: item.name, quantity: qty, price_per_day: item.price_per_day, subtotal: qty * itemRentalPrice(item, days) }
                : null;
            })
            .filter(
              (i): i is { name: string; quantity: number; price_per_day: number; subtotal: number } => i !== null,
            ),
          ...bundleComponentLines
            .map((line) => {
              const item = items.find((i) => i.id === line.item_id);
              return item
                ? {
                    name: item.name,
                    quantity: line.quantity,
                    price_per_day: item.price_per_day,
                    subtotal: line.subtotal,
                    bundle_instance_id: line.bundle_instance_id,
                    bundle_name: line.bundle_name,
                    bundle_quantity: line.bundle_quantity,
                  }
                : null;
            })
            .filter((i): i is NonNullable<typeof i> => i !== null),
        ];

        const receiptSaleItems = selectedSaleEntries
          .map(([saleItemId, qty]) => {
            const saleItem = saleItems.find((s) => s.id === saleItemId);
            return saleItem ? { name: saleItem.name, quantity: qty, unitPrice: saleItem.price, subtotal: qty * saleItem.price } : null;
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        const receiptText = generateWhatsAppReceipt({
          bookingNumber: body.booking_number,
          customerName,
          customerPhone,
          startDate,
          endDate,
          items: receiptItems,
          saleItems: receiptSaleItems,
          totalPrice,
          dpPaid: Number(dpPaid) || 0,
          depositType: depositType || null,
          depositNote: depositNote || null,
          depositStatus: 'ditahan',
          status: body.status,
          fines: [],
          businessName: business.name,
          rentalDayMode: business.rental_day_mode,
          durationLabelStyle: business.duration_label_style,
        });
        window.open(getWhatsAppShareUrl(customerPhone, receiptText), '_blank');
      } catch {
        // struk WA gagal dibuat, transaksi tetap tersimpan — lanjutkan saja.
      }
    }

    onSaved(body.id);
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-2xl rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <Plus className="w-5 h-5 text-[#A65C2A]" />
            <h2 className="text-lg font-bold">Catat Transaksi Sewa Baru</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-5 text-xs sm:text-sm">
          {/* Review -c1: peringatan hanya-baca HARUS di PALING ATAS form,
              sebelum field apa pun — vendor tidak boleh baru tahu transaksi
              tidak bisa disimpan setelah mengisi seluruh form di depan
              pelanggan yang menunggu. Duplikat lagi di dekat tombol Simpan
              (di bawah) untuk yang sempat scroll lewat peringatan ini. */}
          {!writable && (
            <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg p-2.5">
              Masa aktif langganan sudah habis — transaksi baru tidak bisa disimpan. Hubungi Sewalog untuk memperpanjang
              sebelum melanjutkan.
            </p>
          )}
          {requestPrefill && (
            <div className="bg-[#F9EFE7] border border-[#A65C2A]/40 rounded-xl p-3 text-xs">
              <p className="font-bold text-[#A65C2A]">Dari pesanan online</p>
              <p className="text-[#6E6853]">
                Total sewa (harga katalog) saat pelanggan pesan: <strong className="text-[#26302B]">{formatIDR(requestPrefill.estimatedPrice)}</strong> —
                harga final tetap ditentukan di bawah dari katalog saat ini.
              </p>
            </div>
          )}
          {/* Paket Alat Tahap 2 -- paket yang dipesan pelanggan sudah
              dinonaktifkan/resep berubah sejak pesanan masuk: fallback ke
              komponen LEPAS (sudah terisi otomatis di langkah 3 di bawah,
              dari snapshot bundle_name+komponen saat pesanan masuk, BUKAN
              resep live) + peringatan non-blocking ini, bukan dibiarkan
              diam-diam hilang dari form. */}
          {bundlePrefillWarning && (
            <p className="text-[11px] text-[#A65C2A] font-semibold bg-[#FAF0EE] border border-[#A65C2A]/30 rounded-lg p-2.5">
              {bundlePrefillWarning}
            </p>
          )}
          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B] flex items-center gap-2">
              <User className="w-4 h-4 text-[#2B4739]" />
              <span>1. Data Penyewa</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <label className="block font-semibold text-[#26302B] mb-1">Nama Penyewa *</label>
                <input
                  type="text"
                  required
                  autoComplete="off"
                  value={customerName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  onFocus={() => customerSuggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setShowSuggestions(false)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
                {showSuggestions && customerSuggestions.length > 0 && (
                  <ul className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-[#DBD5C1] rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {customerSuggestions.map((match) => (
                      <li key={match.id}>
                        <button
                          type="button"
                          onMouseDown={() => selectCustomer(match)}
                          className="w-full text-left px-3 py-2 hover:bg-[#F1EEE2] transition"
                        >
                          <p className="font-semibold text-[#26302B]">{match.name}</p>
                          {(match.phone || match.address) && (
                            <p className="text-[11px] text-[#6E6853]">
                              {[match.phone, match.address].filter(Boolean).join('   •   ')}
                            </p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {historySummary && historySummary.count > 0 && (
                  <p className="mt-1 text-[11px] text-[#2B4739] font-semibold flex items-center gap-1">
                    <History className="w-3 h-3" />
                    Pernah sewa {historySummary.count}x
                    {historySummary.lastBookingDate && `, terakhir ${formatDateIndo(historySummary.lastBookingDate, false)}`}
                  </p>
                )}
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">No. WhatsApp *</label>
                <input
                  type="tel"
                  required
                  placeholder="081234567890"
                  value={customerPhone}
                  onChange={(e) => {
                    setCustomerPhone(e.target.value);
                    dropSelectionIfAny();
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#26302B] mb-1">Alamat Singkat / Wilayah</label>
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => {
                    setCustomerAddress(e.target.value);
                    dropSelectionIfAny();
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#26302B] mb-1">Foto Penyewa (opsional)</label>
                {customerPhotoPreview ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={customerPhotoPreview}
                      alt="Foto penyewa"
                      className="h-16 w-16 shrink-0 object-cover rounded-lg border border-[#DBD5C1]"
                    />
                    <div className="flex-1 flex flex-col gap-2">
                      <label className="flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg border border-[#2B4739] text-[#2B4739] font-semibold text-xs hover:bg-[#F1EEE2] cursor-pointer transition">
                        <Camera className="w-4 h-4" />
                        {uploadingPhoto ? 'Mengunggah...' : 'Ganti'}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          disabled={uploadingPhoto}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadCustomerPhoto(file);
                            e.target.value = '';
                          }}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerPhotoKey('');
                          setCustomerPhotoPreview('');
                        }}
                        className="flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg border border-[#A8412E]/40 text-[#A8412E] font-semibold text-xs hover:bg-[#FAF0EE] transition"
                      >
                        <Trash2 className="w-4 h-4" />
                        Hapus
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col items-center justify-center gap-1 min-h-[44px] py-3 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-xs shadow-sm cursor-pointer transition active:scale-95">
                      <Camera className="w-5 h-5" />
                      {uploadingPhoto ? 'Mengunggah...' : 'Ambil Foto'}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={uploadingPhoto}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadCustomerPhoto(file);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                    <label className="flex flex-col items-center justify-center gap-1 min-h-[44px] py-3 rounded-xl border-2 border-[#2B4739] text-[#2B4739] font-semibold text-xs hover:bg-[#F1EEE2] cursor-pointer transition active:scale-95">
                      <Image className="w-5 h-5" />
                      {uploadingPhoto ? 'Mengunggah...' : 'Pilih dari Galeri'}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingPhoto}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadCustomerPhoto(file);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
                <p className="mt-1 text-[10px] text-[#6E6853]">
                  Bukan foto KTP/dokumen — cukup foto orangnya, buat bukti siapa yang mengambil barang kalau ada
                  sengketa jaminan nanti.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B] flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#2B4739]" />
              <span>2. Periode Sewa</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Mulai Sewa *</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    setStartDate(newStart);
                    if (newStart <= todayStr()) setPickedUpNow(false);
                    const minEnd = business.rental_day_mode === 'per_malam' ? addDaysStr(newStart, 1) : newStart;
                    // Isi otomatis tanggal kembali (brief 23 Nov 2026).
                    // (a) Paket maksimal hari (migration 054) -- PERILAKU
                    // LAMA dipertahankan apa adanya: selalu ditimpa ulang
                    // tiap Mulai Sewa berubah (vendor masih bisa mengubahnya
                    // manual sesudahnya, lihat peringatan di bawah form).
                    if (business.max_rental_days != null) {
                      setEndDate(endDateForDays(newStart, business.max_rental_days, business.rental_day_mode));
                      return;
                    }
                    // (b)/(c): tanggal kembali yang SUDAH diisi (manual atau
                    // auto sebelumnya) dipertahankan kalau MASIH VALID untuk
                    // Mulai Sewa baru -- cuma diisi ulang kalau tidak valid
                    // lagi, supaya tidak menimpa pilihan vendor tanpa alasan.
                    if (endDate >= minEnd) return;
                    if (business.min_rental_days != null) {
                      setEndDate(endDateForDays(newStart, business.min_rental_days, business.rental_day_mode));
                    } else {
                      setEndDate(minEnd);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-semibold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
                {/* Teks konfirmasi dd-mm-yyyy (keputusan Andi 10 Nov 2026) --
                    input type="date" bawaan ikut bahasa perangkat, ambigu. */}
                {startDate && <p className="text-[10px] text-[#6E6853] mt-1">{formatDateIndo(startDate, true)}</p>}
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Tanggal Kembali *</label>
                <input
                  type="date"
                  required
                  min={
                    business.min_rental_days != null
                      ? endDateForDays(startDate, business.min_rental_days, business.rental_day_mode)
                      : business.rental_day_mode === 'per_malam'
                        ? addDaysStr(startDate, 1)
                        : startDate
                  }
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-semibold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
                {endDate && <p className="text-[10px] text-[#6E6853] mt-1">{formatDateIndo(endDate, true)}</p>}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-[#E8EFEA] border border-[#2B4739]/30 text-[#2B4739] text-xs font-semibold flex items-center justify-between">
              <span>Durasi Sewa Terhitung:</span>
              <span className="text-sm font-extrabold">
                {formatRentalDuration(days, business.duration_label_style, business.rental_day_mode)}
              </span>
            </div>
            {startDate > todayStr() && (
              <>
                <p className="text-[11px] text-[#A65C2A] font-medium">
                  Mulai Sewa di masa depan → transaksi akan berstatus "Siap Diambil" sampai kamu tandai barang
                  sudah diambil.
                </p>
                {/* "Alat diambil sekarang" (brief 23 Nov 2026, bagian C) --
                    walk-in yang barangnya SUNGGUHAN dibawa sekarang,
                    meski Mulai Sewa dicatat di masa depan (mis. ambil
                    malam ini untuk sewa besok, toleransi perjalanan).
                    Dibatasi maksimal hari ini+2 (server menolak 422 kalau
                    lebih -- jaring pengaman, pesan ramah ditampilkan
                    lewat actionError seperti error lain). */}
                <label className="flex items-center gap-2 text-xs font-medium text-[#26302B]">
                  <input
                    type="checkbox"
                    checked={pickedUpNow}
                    onChange={(e) => setPickedUpNow(e.target.checked)}
                    className="rounded border-[#DBD5C1]"
                  />
                  Alat diambil sekarang
                </label>
                {pickedUpNow && startDate === addDaysStr(todayStr(), 2) && (
                  <p className="text-[10px] text-[#A65C2A]">Stok terkunci mulai hari ini.</p>
                )}
              </>
            )}
            {business.min_rental_days != null && days < business.min_rental_days && (
              <p className="text-[11px] text-[#A8412E] font-semibold">
                Minimal sewa {business.min_rental_days} hari.
              </p>
            )}
            {business.max_rental_days != null && days > business.max_rental_days && (
              <p className="text-[11px] text-[#A65C2A] font-semibold">
                Melebihi paket {business.max_rental_days} hari.
              </p>
            )}
            {/* Batas jam kembali tetap (migration 062) — peringatan NON-
                BLOCKING, cuma relevan untuk walk-in (ambil hari ini,
                langsung 'aktif') karena anchor jam ambilnya "sekarang".
                Dihitung dengan waktu lokal BROWSER (pola sama todayStr(),
                CLAUDE.md bagian 4 — bukan sumber kebenaran, backend
                computeDueAt() sudah punya jaring pengaman sendiri kalau
                due <= jam ambil sungguhan). */}
            {startDate === todayStr() && business.return_deadline_time && (() => {
              const nextDay = business.return_deadline_next_day || business.return_deadline_time === '00:00';
              const dueLocalDateStr = nextDay ? addDaysStr(endDate, 1) : endDate;
              const due = new Date(`${dueLocalDateStr}T${business.return_deadline_time}:00`);
              if (due.getTime() > Date.now()) return null;
              return (
                <p className="text-[11px] text-[#A65C2A] font-semibold">
                  Batas jam kembali ({business.return_deadline_time}) untuk tanggal ini sudah lewat — transaksi bisa
                  langsung tercatat berpotensi terlambat.
                </p>
              );
            })()}
          </div>

          {bundles.length > 0 && (
            <div className="space-y-2 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
              <h3 className="font-bold text-[#26302B]">Pilih Paket (opsional)</h3>
              <div className="space-y-2">
                {bundles.map((bundle) => {
                  const qty = bundleQuantities[bundle.id] ?? 0;
                  const checked = qty > 0;
                  // Paket komponennya dinonaktifkan -- items (useItems) sudah
                  // hanya berisi alat AKTIF, jadi komponen yang tidak ketemu di
                  // sana berarti nonaktif. Paket seperti ini tidak bisa dipilih.
                  const hasDeactivatedComponent = bundle.bundle_items.some((bi) => !items.some((i) => i.id === bi.item_id));
                  const instanceId = bundleInstanceIds[bundle.id];
                  const exploded =
                    checked && !hasDeactivatedComponent && instanceId
                      ? explodeBundleToComponents(bundle, qty, days, items, instanceId, bundleComponentOverrides[bundle.id] ?? {})
                      : null;
                  return (
                    <div key={bundle.id} className="rounded-lg bg-white border border-[#DBD5C1] overflow-hidden">
                      <div className="flex items-center justify-between p-2.5">
                        <label className={`flex-1 min-w-0 pr-2 flex items-center gap-2 ${hasDeactivatedComponent ? '' : 'cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={hasDeactivatedComponent}
                            onChange={(e) => setBundleQuantity(bundle.id, e.target.checked ? 1 : 0)}
                            className="w-4 h-4 accent-[#2B4739] shrink-0"
                          />
                          <span className="min-w-0">
                            <p className="font-bold text-[#26302B] truncate">Paket {bundle.name}</p>
                            <p className="text-[9px] text-[#6E6853] font-semibold uppercase tracking-wide truncate">
                              {bundle.bundle_items
                                .map((bi) => `${items.find((i) => i.id === bi.item_id)?.name ?? '?'} ×${bi.quantity}`)
                                .join(', ')}
                            </p>
                            {exploded && (
                              <p className="text-[11px] text-[#6E6853]">
                                = <strong className="text-[#2B4739]">{formatIDR(exploded.totalForAllInstances)}</strong>
                              </p>
                            )}
                            {hasDeactivatedComponent && (
                              <p className="text-[11px] text-[#A8412E] font-semibold">
                                Salah satu alat di paket ini sudah nonaktif — tidak bisa dipilih.
                              </p>
                            )}
                          </span>
                        </label>
                        {checked && (
                          <div className="flex items-center gap-1 bg-[#F1EEE2] rounded-lg p-1 border border-[#DBD5C1] shrink-0">
                            <button
                              type="button"
                              onClick={() => setBundleQuantity(bundle.id, qty - 1)}
                              className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition"
                            >
                              −
                            </button>
                            <span className="w-6 text-center font-bold text-[#26302B]">{qty}</span>
                            <button
                              type="button"
                              onClick={() => setBundleQuantity(bundle.id, qty + 1)}
                              className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Rincian komponen -- bisa dikurangi/dihapus kalau
                          pelanggan tidak butuh salah satu alat di paket
                          (brief "Alat Dalam Paket Dikurangi", 15 Nov 2026).
                          Mengubah salah satu baris MELEPAS label paket (sama
                          aturan Ubah Alat) -- harga baris lain TIDAK berubah,
                          cuma porsi baris yang disentuh yang turun/hilang. */}
                      {exploded && (
                        <div className="px-2.5 pb-2.5 space-y-1 bg-[#F1EEE2]/60 border-t border-[#DBD5C1]">
                          {bundle.bundle_items.map((bi) => {
                            const recipeQtyTotal = bi.quantity * qty;
                            const overrideQty = bundleComponentOverrides[bundle.id]?.[bi.item_id];
                            const effectiveQty = overrideQty ?? recipeQtyTotal;
                            const itemName = items.find((i) => i.id === bi.item_id)?.name ?? '?';
                            const line = exploded.lines.find((l) => l.item_id === bi.item_id);
                            return (
                              <div key={bi.item_id} className="flex items-center justify-between py-1 text-[11px]">
                                <span className="text-[#26302B]">
                                  {itemName} {line ? `(${formatIDR(line.subtotal)})` : <span className="text-[#A8412E] font-semibold">dihapus</span>}
                                </span>
                                <div className="flex items-center gap-1 bg-white rounded p-0.5 border border-[#DBD5C1] shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setBundleComponentOverride(bundle.id, bi.item_id, effectiveQty - 1)}
                                    className="w-5 h-5 rounded bg-[#F1EEE2] font-bold hover:bg-[#DBD5C1] text-[#26302B]"
                                  >
                                    −
                                  </button>
                                  <span className="w-5 text-center font-bold text-[#26302B]">{effectiveQty}</span>
                                  <button
                                    type="button"
                                    onClick={() => setBundleComponentOverride(bundle.id, bi.item_id, Math.min(recipeQtyTotal, effectiveQty + 1))}
                                    disabled={effectiveQty >= recipeQtyTotal}
                                    className="w-5 h-5 rounded bg-[#F1EEE2] font-bold hover:bg-[#DBD5C1] text-[#26302B] disabled:opacity-40"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {exploded.anyOverridden && (
                            <p className="text-[10px] text-[#A65C2A] font-semibold pt-1">
                              Isi paket diubah. Harga dihitung dari porsi paket, label paket dilepas untuk baris yang
                              diubah.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-[#6E6853] italic">
                Ketersediaan paket dicek saat Simpan (sama seperti alat satuan) — belum ditampilkan sisa stok di sini.
              </p>
            </div>
          )}

          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B]">3. Pilih Peralatan ({selectedEntries.length} Jenis)</h3>

            {items.length === 0 ? (
              <p className="text-center text-[#6E6853] py-3 italic bg-white/50 rounded-lg border border-dashed border-[#DBD5C1]">
                Belum ada alat di katalog. Tambahkan dulu di tab "Katalog & Stok Alat".
              </p>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6E6853]" />
                  <input
                    type="text"
                    value={itemSearchQuery}
                    onChange={(e) => setItemSearchQuery(e.target.value)}
                    placeholder="Cari alat (nama, varian, ukuran, warna)..."
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-xs focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                  />
                </div>
                {filteredItems.length === 0 && (
                  <p className="text-center text-[#6E6853] py-3 italic bg-white/50 rounded-lg border border-dashed border-[#DBD5C1]">
                    Tidak ada alat yang cocok dengan pencarian.
                  </p>
                )}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {filteredItems.map((item) => {
                  const qty = quantities[item.id] ?? 0;
                  const checked = qty > 0;
                  const subtotal = qty * itemRentalPrice(item, days);
                  const breakdown = tieredBreakdown(item, days);

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
                          <p className="font-bold text-[#26302B] truncate">{item.name}</p>
                          {(item.variant || item.size || item.color) && (
                            <p className="text-[9px] text-[#6E6853] font-semibold uppercase tracking-wide truncate">
                              {[
                                item.variant && `Varian: ${item.variant}`,
                                item.size && `Ukuran: ${item.size}`,
                                item.color && `Warna: ${item.color}`,
                              ]
                                .filter(Boolean)
                                .join('   •   ')}
                            </p>
                          )}
                          <p className="text-[11px] text-[#6E6853]">
                            {!checked && <>{formatIDR(item.price_per_day)}/hr</>}
                            {checked && breakdown === null && (
                              <>
                                {formatIDR(item.price_per_day)}/hr × {days} hr
                                {qty > 1 ? ` × ${qty} unit` : ''} ={' '}
                                <strong className="text-[#2B4739]">{formatIDR(subtotal)}</strong>
                              </>
                            )}
                            {checked && breakdown !== null && (
                              <>
                                {qty > 1 ? `(${breakdown}) × ${qty} unit` : breakdown} ={' '}
                                <strong className="text-[#2B4739]">{formatIDR(subtotal)}</strong>
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
                            disabled={qty >= item.total_units}
                            className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition disabled:opacity-30"
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
            <p className="text-[10px] text-[#6E6853]">
              Kapasitas dicek ulang otomatis saat disimpan — kalau ada alat yang sudah kepakai di tanggal itu, akan
              ditolak dengan keterangan sisa stok.
            </p>
          </div>

          {/* Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- bagian
              lipat, HANYA tampil kalau business punya >=1 barang jual
              aktif. Flat (tanpa jumlah hari), maks stepper = stok. */}
          {saleItems.length > 0 && (
            <details className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
              <summary className="font-bold text-[#26302B] cursor-pointer flex items-center gap-2">
                <span>Tambahan: barang jual {selectedSaleEntries.length > 0 ? `(${selectedSaleEntries.length})` : ''}</span>
              </summary>
              <div className="space-y-1.5 pt-2">
                {saleItems.map((saleItem) => {
                  const qty = saleQuantities[saleItem.id] ?? 0;
                  return (
                    <div key={saleItem.id} className="flex items-center justify-between p-2 rounded-lg bg-white border border-[#DBD5C1]">
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="font-semibold text-[#26302B] text-xs truncate">{saleItem.name}</p>
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
                          onClick={() => setSaleQuantities((prev) => ({ ...prev, [saleItem.id]: Math.min(saleItem.stock, qty + 1) }))}
                          disabled={qty >= saleItem.stock}
                          className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {saleItemsTotal > 0 && (
                <p className="text-[11px] text-[#26302B] font-semibold">Subtotal barang jual: {formatIDR(saleItemsTotal)}</p>
              )}
            </details>
          )}

          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#2B4739]" />
              <span>4. Jaminan & Pembayaran</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Jenis Jaminan</label>
                <select
                  value={depositType}
                  onChange={(e) => setDepositType(e.target.value as DepositType)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-semibold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                >
                  <option value="">Tanpa jaminan</option>
                  <option value="ktp">{depositLabel('ktp')}</option>
                  <option value="sim">{depositLabel('sim')}</option>
                  <option value="stnk">{depositLabel('stnk')}</option>
                  <option value="paspor">{depositLabel('paspor')}</option>
                  <option value="uang">{depositLabel('uang')}</option>
                  <option value="lainnya">{depositLabel('lainnya')}</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Catatan Identitas Jaminan</label>
                <input
                  type="text"
                  placeholder={depositType ? `Contoh: ${depositLabel(depositType)} a.n. ${customerName || 'Penyewa'}` : ''}
                  value={depositNote}
                  onChange={(e) => setDepositNote(e.target.value)}
                  disabled={!depositType}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739] disabled:opacity-50"
                />
                <p className="text-[11px] text-[#6E6853] mt-1">
                  Cukup tulis jenis &amp; nama (mis. KTP a.n. Budi) — tidak perlu menulis nomor KTP/SIM.
                </p>
              </div>

              {depositType === 'uang' && (
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-[#26302B] mb-1">Jumlah Deposit Uang (Rp) *</label>
                  <input
                    type="number"
                    min={0}
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                  />
                </div>
              )}

              {/* Brief 15 Nov 2026 Bagian B — cuma muncul untuk walk-in
                  (langsung 'aktif') tanpa jaminan, supaya tidak menambah
                  friksi di kasus yang sudah mengisi jaminan atau booking
                  'dipesan' (jaminannya dikonfirmasi lewat dialog Ambil). */}
              {(startDate <= todayStr() || pickedUpNow) && !depositType && (
                <label className="sm:col-span-2 flex items-center gap-2 p-2.5 rounded-lg bg-white border border-[#DBD5C1] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noDepositConfirmed}
                    onChange={(e) => setNoDepositConfirmed(e.target.checked)}
                    className="w-4 h-4 accent-[#2B4739] shrink-0"
                  />
                  <span className="text-xs font-bold text-[#26302B]">Konfirmasi: tidak ada jaminan untuk transaksi ini</span>
                </label>
              )}

              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Uang Muka (DP)</label>
                <input
                  type="number"
                  min={0}
                  value={dpPaid}
                  onChange={(e) => setDpPaid(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              </div>
              {Number(dpPaid) > 0 && (
                <div>
                  <label className="block font-semibold text-[#6E6853] mb-1">Cara Bayar DP (opsional)</label>
                  <select
                    value={dpMethod}
                    onChange={(e) => setDpMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                  >
                    <option value="">Tidak dicatat</option>
                    <option value="tunai">Tunai</option>
                    <option value="transfer">Transfer</option>
                    <option value="qris">QRIS</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block font-semibold text-[#6E6853] mb-1">Sisa Bayar Saat Ambil</label>
                <div className="px-3 py-2 rounded-lg bg-[#FAF0EE] border border-[#A8412E]/30 text-[#A8412E] font-extrabold text-sm">
                  {formatIDR(remainingPayment)}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#2B4739] text-[#FBFAF4] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#DBD5C1]">Total Tagihan Sewa</p>
                <p className="text-lg font-extrabold">{formatIDR(totalPrice)}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 pt-1">
            <input
              type="checkbox"
              id="waCheck"
              checked={autoOpenWA}
              onChange={(e) => setAutoOpenWA(e.target.checked)}
              className="w-4 h-4 accent-[#2B4739] rounded"
            />
            <label htmlFor="waCheck" className="text-xs font-semibold text-[#26302B] cursor-pointer">
              Buka otomatis chat WhatsApp & kirim Nota Sewa Digital setelah disimpan
            </label>
          </div>

          {error && (
            <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg p-2.5">
              {error}
            </p>
          )}

          {!writable && (
            <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg p-2.5">
              Masa aktif langganan sudah habis — Catat Transaksi baru dikunci. Hubungi Sewalog untuk memperpanjang.
            </p>
          )}
          <div className="pt-3 border-t border-[#DBD5C1] flex items-center justify-end space-x-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] font-semibold text-xs transition"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !writable}
              className="px-5 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs shadow-md transition flex items-center space-x-2 active:scale-95 disabled:opacity-60"
            >
              <CheckCircle2 className="w-4 h-4 text-[#A65C2A]" />
              <span>{submitting ? 'Menyimpan...' : 'Simpan & Terbitkan Nota'}</span>
            </button>
          </div>
        </form>
      </ModalPanel>
    </ModalBackdrop>
  );
}
