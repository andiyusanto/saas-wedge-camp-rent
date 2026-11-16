// Barang Jual (habis pakai), v1 (brief 16 Nov 2026, migration 066) --
// menggabungkan daftar barang jual yang DIMINTA (sale_item_id+quantity
// saja, dari klien, TIDAK PERNAH dipercaya soal harga) dengan barang
// yang SUDAH ADA di booking (pakai harga SNAPSHOT lama apa adanya) dan
// katalog SAAT INI (untuk barang yang BENAR-BENAR BARU, belum pernah
// ada di booking ini -- snapshot harga katalog sekarang, pola sama
// mergeBookingItemsForUpdate untuk alat sewa). Fungsi murni (tidak
// menyentuh DB) supaya bisa diuji tanpa Express/Supabase. Lebih
// sederhana dari versi alat sewa -- harga flat (tidak bertingkat per
// hari), tidak ada konsep paket.

export type ExistingBookingSaleItemRow = {
  sale_item_id: string;
  quantity: number;
  price_at_booking: number;
  name: string;
};

export type CatalogSaleItemRow = {
  id: string;
  name: string;
  price: number;
};

export type RequestedBookingSaleItem = { sale_item_id: string; quantity: number };

export type MergedBookingSaleItem = {
  sale_item_id: string;
  quantity: number;
  name: string;
  price_at_booking: number;
  subtotal: number;
};

export type SaleItemMergeResult = { ok: true; items: MergedBookingSaleItem[] } | { ok: false; error: string };

// Review -c1 (ronde ketiga #1, pola sama bookingRequests.ts): baris
// duplikat sale_item_id dalam satu permintaan digabung (dijumlahkan)
// SEBELUM apa pun lain diproses -- RPC sendiri juga menolak duplikat
// sebagai jaring pengaman independen (migration 066), tapi Express
// WAJIB sudah menjumlahkan dulu supaya permintaan yang sah (klik +
// berkali-kali di UI yang BELUM sempat merge state-nya sendiri) tidak
// pernah sampai memicu penolakan itu.
export function mergeDuplicateSaleItemRequests(rows: RequestedBookingSaleItem[]): RequestedBookingSaleItem[] {
  const merged = new Map<string, number>();
  for (const row of rows) {
    merged.set(row.sale_item_id, (merged.get(row.sale_item_id) ?? 0) + row.quantity);
  }
  return Array.from(merged.entries()).map(([sale_item_id, quantity]) => ({ sale_item_id, quantity }));
}

export function mergeSaleItemsForUpdate(
  requested: RequestedBookingSaleItem[],
  existing: ExistingBookingSaleItemRow[],
  catalog: CatalogSaleItemRow[],
): SaleItemMergeResult {
  const merged = mergeDuplicateSaleItemRequests(requested);
  const existingById = new Map(existing.map((e) => [e.sale_item_id, e]));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  const items: MergedBookingSaleItem[] = [];
  for (const req of merged) {
    if (!Number.isInteger(req.quantity) || req.quantity < 1) {
      return { ok: false, error: 'Jumlah barang jual tidak valid.' };
    }

    const prior = existingById.get(req.sale_item_id);
    const catalogItem = catalogById.get(req.sale_item_id);
    const priceAtBooking = prior ? prior.price_at_booking : catalogItem?.price;
    const name = prior ? prior.name : catalogItem?.name;

    if (priceAtBooking == null || name == null) {
      return { ok: false, error: 'Barang jual tidak ditemukan.' };
    }

    items.push({
      sale_item_id: req.sale_item_id,
      quantity: req.quantity,
      name,
      price_at_booking: priceAtBooking,
      subtotal: priceAtBooking * req.quantity,
    });
  }

  return { ok: true, items };
}
