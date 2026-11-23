// Cocokkan pelanggan existing via nomor WA (brief 23 Nov 2026) --
// create_booking_atomic() SELALU insert baris customers baru kalau
// p_customer_id null, TANPA cek nomor WA yang sudah ada sama sekali
// (ditemukan sendiri saat investigasi brief ini) -- staf yang mengetik
// nama/WA manual tanpa memilih dari daftar saran SELALU bikin baris
// customers baru, walau nomornya sudah ada di business yang sama. Untuk
// pilot Outdoorgear Banyumas (100+ member), ini langsung merusak fitur
// Member/Mitra: label/diskon "ketinggalan" di baris lama, menu Pelanggan
// penuh duplikat.
//
// customers.phone TIDAK dinormalisasi saat disimpan -- jadi tidak bisa
// `.eq()` langsung, fetch SEMUA nomor business ini lalu normalize+compare
// di JS.
//
// Diekstrak ke file TERPISAH dari routes/bookings.ts (bukan sekadar
// `export`) supaya bisa diuji TANPA memuat lib/supabaseClient.ts, yang
// melempar error di level modul kalau SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY
// belum ada di .env -- tidak relevan untuk unit test logika pencocokan
// murni ini, dan `node --test` tidak memuat .env sama sekali.
import { normalizePhone } from './phone.js';

type MinimalSupabase = {
  from(table: string): any;
};

// PostgREST max_rows = 1.000 (CLAUDE.md bagian 7) memotong hasil DIAM-DIAM
// -- business dengan >1.000 pelanggan akan gagal cocok tanpa error apa pun
// kalau fetch di atas cuma satu query polos. Paginasi lewat .range() sampai
// benar2 habis, dengan .order('id') deterministik (pola fetchAllPages()
// di lib/availability.ts). Select cukup id+phone, bukan seluruh kolom
// customers.
export async function fetchAllCustomerPhonePages(
  supabase: MinimalSupabase,
  businessId: string,
): Promise<{ id: string; phone: string | null }[]> {
  const PAGE_SIZE = 1000;
  const rows: { id: string; phone: string | null }[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, phone')
      .eq('business_id', businessId)
      .not('phone', 'is', null)
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function findCustomerIdByPhone(
  supabase: MinimalSupabase,
  businessId: string,
  rawPhone: string,
): Promise<string | null> {
  const target = normalizePhone(rawPhone);
  if (!target) return null;

  const candidates = await fetchAllCustomerPhonePages(supabase, businessId);
  const matches = candidates.filter((c) => c.phone && normalizePhone(c.phone) === target);

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].id;

  // Duplikat lama (dari sebelum fitur ini) -- pakai yang PALING BARU
  // dipakai (booking terakhir dengan created_at terbesar di antara
  // kandidat), fallback ke customers.id kalau tidak ada satupun
  // kandidat yang pernah punya booking (seharusnya jarang -- duplikat
  // biasanya muncul justru KARENA pelanggan itu sudah pernah bertransaksi
  // lebih dari sekali dengan baris berbeda-beda).
  const candidateIds = matches.map((c) => c.id);
  const { data: recentBookings } = await supabase
    .from('bookings')
    .select('customer_id, created_at')
    .in('customer_id', candidateIds)
    .order('created_at', { ascending: false })
    .limit(1);
  const chosenId = recentBookings?.[0]?.customer_id ?? matches[0].id;
  console.warn(
    `[findCustomerIdByPhone] ${matches.length} baris customers duplikat untuk nomor WA ternormalisasi ${target} (business ${businessId}) -- dipakai id ${chosenId} (paling baru dipakai).`,
  );
  return chosenId;
}
