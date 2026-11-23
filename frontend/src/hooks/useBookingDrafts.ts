// Draf Transaksi / Keranjang (brief 23 Nov 2026, Campease WA 23 Nov) --
// menahan form Catat Transaksi setengah jadi sambil melayani pelanggan
// lain. Disimpan PER PERANGKAT (localStorage, try/catch -- gagal/penuh
// tidak boleh menjatuhkan form, cuma berarti draf tidak tersimpan), BUKAN
// di DB (TANPA migration, sesuai brief). Satu key GLOBAL (bukan per
// business) berisi map businessId -> draft[], supaya logout bisa
// menghapus SEMUA draf lintas business dengan satu panggilan (privasi
// data pelanggan di HP bersama -- usulan brief bagian C, disetujui
// koordinator), dan ganti business otomatis hanya melihat draf miliknya
// sendiri (difilter saat dibaca, bukan disimpan terpisah per key).
const STORAGE_KEY = 'sewalog_booking_drafts_v1';
const MAX_DRAFTS_PER_BUSINESS = 10;
const EXPIRY_MS = 3 * 24 * 60 * 60 * 1000; // 3 hari

export type BookingDraftData = {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  selectedCustomerId: string | null;
  applyDiscount: boolean;
  startDate: string;
  endDate: string;
  pickedUpNow: boolean;
  quantities: Record<string, number>;
  bundleQuantities: Record<string, number>;
  bundleInstanceIds: Record<string, string>;
  bundleComponentOverrides: Record<string, Record<string, number>>;
  saleQuantities: Record<string, number>;
  depositType: string;
  depositNote: string;
  depositAmount: string;
  noDepositConfirmed: boolean;
  dpPaid: string;
  dpMethod: string;
  autoOpenWA: boolean;
  // Foto KTP/pelanggan TIDAK disimpan (data URL bisa besar, localStorage
  // dibatasi ~5MB) -- cuma flag supaya form bisa menampilkan info "foto
  // perlu diambil ulang" saat draf ini dilanjutkan.
  hadPhoto: boolean;
};

export type BookingDraft = {
  id: string;
  updatedAt: number;
  label: string;
  itemCount: number;
  totalPreview: number;
  data: BookingDraftData;
};

type DraftStore = Record<string, BookingDraft[]>;

function readStore(): DraftStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: DraftStore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

// Draf kedaluwarsa (>3 hari) dibersihkan di sini -- dipanggil tiap baca,
// jadi daftar yang ditampilkan selalu segar tanpa perlu cron/timer.
function pruneExpired(list: BookingDraft[]): BookingDraft[] {
  const now = Date.now();
  return list.filter((d) => now - d.updatedAt < EXPIRY_MS);
}

export function clearAllBookingDraftsOnLogout(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage tidak tersedia -- tidak ada apa-apa yang perlu dibersihkan.
  }
}

export function listBookingDrafts(businessId: string): BookingDraft[] {
  const store = readStore();
  const pruned = pruneExpired(store[businessId] ?? []);
  if (pruned.length !== (store[businessId] ?? []).length) {
    store[businessId] = pruned;
    writeStore(store);
  }
  return [...pruned].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getBookingDraft(businessId: string, draftId: string): BookingDraft | null {
  const list = listBookingDrafts(businessId);
  return list.find((d) => d.id === draftId) ?? null;
}

// true kalau datanya "kosong secara bermakna" -- tidak boleh membuat draf
// sama sekali (brief bagian A: "form yang dibuka lalu ditutup tanpa
// input berarti TIDAK boleh membuat draf").
export function isDraftDataMeaningless(data: BookingDraftData): boolean {
  const hasCustomer = data.customerName.trim() !== '' || data.customerPhone.trim() !== '' || !!data.selectedCustomerId;
  const hasItems = Object.values(data.quantities).some((q) => q > 0);
  const hasBundles = Object.values(data.bundleQuantities).some((q) => q > 0);
  const hasSaleItems = Object.values(data.saleQuantities).some((q) => q > 0);
  return !hasCustomer && !hasItems && !hasBundles && !hasSaleItems;
}

// Simpan/perbarui satu draf. existingId yang masih ada -> update DI
// TEMPAT (bukan bikin baris baru) supaya autosave menyambung draf yang
// sama saat melanjutkan, bukan menggandakannya. Mengembalikan id draf
// (baru atau existing) dan, kalau draf tertua dibuang karena limit,
// informasi untuk ditampilkan sebagai peringatan singkat.
export function saveBookingDraft(
  businessId: string,
  existingId: string | null,
  label: string,
  itemCount: number,
  totalPreview: number,
  data: BookingDraftData,
): { id: string; evictedLabel: string | null; persisted: boolean } {
  const store = readStore();
  const list = pruneExpired(store[businessId] ?? []);

  let evictedLabel: string | null = null;
  const now = Date.now();
  const id = existingId ?? crypto.randomUUID();
  const idx = list.findIndex((d) => d.id === id);
  const draft: BookingDraft = { id, updatedAt: now, label, itemCount, totalPreview, data };

  if (idx >= 0) {
    list[idx] = draft;
  } else {
    if (list.length >= MAX_DRAFTS_PER_BUSINESS) {
      // Draf tertua dibuang (bukan tolak buat baru) -- usulan brief,
      // diputuskan mendukung alur kerja terus-menerus di lapangan
      // daripada memaksa staf membuang draf lama secara manual dulu.
      list.sort((a, b) => a.updatedAt - b.updatedAt);
      const [evicted] = list.splice(0, 1);
      evictedLabel = evicted?.label ?? null;
    }
    list.push(draft);
  }

  store[businessId] = list;
  const persisted = writeStore(store);
  return { id, evictedLabel, persisted };
}

export function deleteBookingDraft(businessId: string, draftId: string): void {
  const store = readStore();
  store[businessId] = (store[businessId] ?? []).filter((d) => d.id !== draftId);
  writeStore(store);
}

export function deleteAllBookingDrafts(businessId: string): void {
  const store = readStore();
  delete store[businessId];
  writeStore(store);
}
