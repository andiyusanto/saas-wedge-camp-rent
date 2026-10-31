import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createAnonClient } from '../lib/supabaseClient.js';
import { todayInWIB } from '../lib/dates.js';
import { computeItemRentalPrice } from '../lib/pricing.js';

const router = Router();

// Rencana 2.7: anti-spam untuk endpoint publik (Bilbo tidak punya proteksi
// ini sama sekali, lihat research/etalase-online-ordering-plan-2026-10.md
// bagian 1.5 — murni usulan baru di sini). Dua rate-limiter terpisah:
// per-IP lintas semua vendor (mencegah satu penyerang membanjiri banyak
// vendor), dan per-slug (mencegah satu vendor dibanjiri meski IP
// bervariasi, mis. lewat proxy/botnet kecil).
const perIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak pesanan dari koneksi ini, coba lagi dalam 1 jam.' },
});

// Review -c1 (ronde ketiga): SEBELUMNYA setiap request (termasuk yang
// gagal validasi) ikut dihitung — 15 request sampah dari beberapa IP
// bisa mengunci SEMUA pelanggan sungguhan satu vendor selama sejam. Dan
// mencatat SETIAP slug (termasuk yang salah ketik/acak) bikin Map ini
// tumbuh tak terbatas. Diperbaiki: `peekSlugLimitExceeded` cuma MEMBACA
// (dipanggil di awal handler, sebelum slug diketahui valid — kalau
// belum pernah ada entri, otomatis tidak exceeded, TIDAK menulis apa
// pun ke Map), dan `recordSlugAttempt` cuma dipanggil SETELAH insert ke
// create_booking_request benar-benar sukses (lihat pemanggilannya di
// bawah) — jadi Map ini hanya pernah berisi slug yang valid DAN cuma
// bertambah untuk pesanan yang benar-benar tersimpan.
const slugAttempts = new Map<string, number[]>();
const SLUG_WINDOW_MS = 60 * 60 * 1000;
const SLUG_MAX_PER_HOUR = 15;

function peekSlugLimitExceeded(slug: string): boolean {
  const now = Date.now();
  const timestamps = (slugAttempts.get(slug) ?? []).filter((t) => now - t < SLUG_WINDOW_MS);
  return timestamps.length >= SLUG_MAX_PER_HOUR;
}

function recordSlugAttempt(slug: string): void {
  const now = Date.now();
  const timestamps = (slugAttempts.get(slug) ?? []).filter((t) => now - t < SLUG_WINDOW_MS);
  timestamps.push(now);
  slugAttempts.set(slug, timestamps);
}

// Format sama longgarnya dengan yang dipakai manusia menulis nomor WA di
// Indonesia (08xx / +62xx / 62xx), tanpa karakter selain digit/spasi/+/-.
// Tidak ada validasi format nomor WA di form Catat Transaksi internal
// (routes/bookings.ts tidak memvalidasi phone sama sekali, cuma field
// bebas), jadi ini validasi BARU, bukan reuse, khusus endpoint publik ini
// karena di sini sumbernya tidak tepercaya (siapa saja tanpa login).
const PHONE_RE = /^(\+?62|0)8[0-9]{8,12}$/;

// Kanonikalisasi ke bentuk "628xxxxxxxxx" (tanpa '+', tanpa '0' depan) —
// 08xx dan +62xx/62xx yang merujuk nomor fisik yang sama harus dianggap
// SATU nomor yang sama, baik untuk disimpan (customer_phone) maupun untuk
// perbandingan batas pesanan 'menunggu' per nomor (lihat bawah).
function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s-]/g, '').replace(/^\+/, '');
  if (stripped.startsWith('0')) return `62${stripped.slice(1)}`;
  return stripped;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS_PER_REQUEST = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SubmitItemInput = { item_id: string; quantity: number };

// Review -c1 (ronde ketiga) #2: tanpa ini, quantity negatif/pecahan/string
// ("-5", 2.5) lolos lewat perbandingan `quantity > remaining` (mis. -5 >
// 4 = false, lolos validasi stok), merusak estimatedPrice, lalu baru
// gagal belakangan dengan error RPC mentah. Divalidasi per baris SEBELUM
// apa pun lain diproses: item_id harus UUID, quantity harus integer 1-20.
function validateItemRows(raw: unknown): SubmitItemInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const result: SubmitItemInput[] = [];
  for (const row of raw) {
    if (
      typeof row !== 'object' || row === null ||
      typeof (row as any).item_id !== 'string' || !UUID_RE.test((row as any).item_id) ||
      typeof (row as any).quantity !== 'number' || !Number.isInteger((row as any).quantity) ||
      (row as any).quantity < 1 || (row as any).quantity > MAX_ITEMS_PER_REQUEST
    ) {
      return null;
    }
    result.push({ item_id: (row as any).item_id, quantity: (row as any).quantity });
  }
  return result;
}

// Review -c1 (ronde ketiga) #1: [{A,3},{A,3}] masing-masing lolos cek
// remaining=4 per baris, padahal total sungguhan (6) melebihi. Digabung
// per item_id (dijumlahkan) SEBELUM validasi stok/harga/batas apa pun.
function mergeDuplicateItems(rows: SubmitItemInput[]): SubmitItemInput[] {
  const merged = new Map<string, number>();
  for (const row of rows) {
    merged.set(row.item_id, (merged.get(row.item_id) ?? 0) + row.quantity);
  }
  return Array.from(merged.entries()).map(([item_id, quantity]) => ({ item_id, quantity }));
}

// Bentuk items[] dari get_public_page (019) — sudah difilter aktif saja
// di dalam RPC itu sendiri (deactivated_at is null), jadi "item tidak ada
// di daftar ini" = "tidak valid untuk dipesan", tidak perlu cek
// deactivated_at terpisah.
type PublicPageItem = {
  id: string;
  name: string;
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
};

// Bentuk hasil get_public_availability (028) — remaining sudah dihitung
// dengan logic SAMA PERSIS seperti usedUnitsOn() (readiness_hours
// termasuk), titik TERBURUK (minimum) di sepanjang rentang tanggal — ini
// SATU-SATUNYA sumber kebenaran ketersediaan publik (CLAUDE.md bagian 6:
// jalur ini dan usedUnitsOn() WAJIB selalu sepakat), yang sama dipakai
// pelanggan untuk melihat "Sisa X unit" di halaman Etalase SEBELUM
// memesan — jadi validasi stok di sini otomatis konsisten dengan apa
// yang sudah mereka lihat, bukan sumber kedua yang bisa berbeda.
type PublicAvailabilityItem = { id: string; total_units: number; remaining: number };

router.post('/public/booking-requests/:slug', perIpLimiter, async (req, res) => {
  const { slug } = req.params;

  if (peekSlugLimitExceeded(slug)) {
    res.status(429).json({ error: 'Terlalu banyak pesanan untuk toko ini, coba lagi nanti atau hubungi lewat WhatsApp.' });
    return;
  }

  const {
    customer_name,
    customer_phone,
    note,
    start_date,
    end_date,
    items,
    payment_method,
    website, // honeypot — field tersembunyi di form, manusia tidak akan mengisinya
  } = req.body ?? {};

  // Honeypot: balas sukses palsu (jangan beri tahu bot kenapa gagal),
  // tapi jangan proses apa pun.
  if (typeof website === 'string' && website.trim().length > 0) {
    res.status(201).json({ token: '00000000-0000-0000-0000-000000000000' });
    return;
  }

  const validatedItems = validateItemRows(items);

  if (
    typeof customer_name !== 'string' || customer_name.trim().length < 1 || customer_name.length > 100 ||
    typeof customer_phone !== 'string' ||
    typeof start_date !== 'string' || !DATE_RE.test(start_date) ||
    typeof end_date !== 'string' || !DATE_RE.test(end_date) ||
    !validatedItems ||
    typeof payment_method !== 'string'
  ) {
    res.status(400).json({ error: 'Data pesanan tidak lengkap.' });
    return;
  }

  const requestedItems = mergeDuplicateItems(validatedItems);

  const normalizedPhone = normalizePhone(customer_phone);
  if (!PHONE_RE.test(normalizedPhone)) {
    res.status(400).json({ error: 'Nomor WhatsApp tidak valid. Pakai format 08xx atau +62xx.' });
    return;
  }

  if (end_date < start_date) {
    res.status(400).json({ error: 'Tanggal kembali tidak boleh sebelum tanggal ambil.' });
    return;
  }
  // Review -c1: ambil hari ini sendiri tidak masuk akal untuk pesanan
  // online (perlu dikonfirmasi vendor dulu, lalu DP/instruksi bayar, baru
  // benar-benar diambil — proses itu tidak realistis selesai dalam
  // hitungan jam yang sama). Ditolak dengan pesan ramah di sini, BUKAN
  // dibiarkan lolos ke expiresAt yang sudah lewat (lihat di bawah) yang
  // akan membuat create_booking_request menolak dengan pesan server
  // mentah. Form publik (tahap 3) akan menegakkan ini juga di sisi UI
  // (minimal tanggal ambil = besok), tapi validasi di sini tetap wajib
  // berdiri sendiri terlepas dari form.
  const todayWib = todayInWIB();
  if (start_date <= todayWib) {
    res.status(400).json({
      error:
        start_date < todayWib
          ? 'Tanggal ambil sudah lewat.'
          : 'Untuk ambil hari ini, hubungi rental langsung lewat WhatsApp.',
    });
    return;
  }

  const totalQty = requestedItems.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  if (requestedItems.length > MAX_ITEMS_PER_REQUEST || totalQty < 1 || totalQty > MAX_ITEMS_PER_REQUEST) {
    res.status(400).json({ error: 'Jumlah alat di luar batas (maks 20 unit per pesanan).' });
    return;
  }

  if (typeof note === 'string' && note.length > 500) {
    res.status(400).json({ error: 'Catatan terlalu panjang.' });
    return;
  }

  const supabase = createAnonClient();

  // get_public_page (019) tidak membawa business_id/payment info — butuh
  // business_id asli + flag accept_online_orders + konfigurasi bayar
  // untuk validasi di sini. Dibuat function tipis baru (bukan query tabel
  // langsung lewat anon — lihat larangan di komentar createAnonClient())
  // supaya tetap lewat satu titik SECURITY DEFINER yang kolomnya dibatasi
  // eksplisit, pola sama seperti get_public_page.
  const { data: pageData, error: pageError } = await supabase.rpc('get_public_ordering_page', { p_slug: slug });
  if (pageError || !pageData) {
    res.status(404).json({ error: 'Toko tidak ditemukan atau belum menerima pesanan online.' });
    return;
  }
  const page = pageData as {
    business_id: string;
    pay_transfer_enabled: boolean;
    pay_qris_enabled: boolean;
    pay_cash_enabled: boolean;
  };

  if (
    (payment_method === 'transfer' && !page.pay_transfer_enabled) ||
    (payment_method === 'qris' && !page.pay_qris_enabled) ||
    (payment_method === 'cash' && !page.pay_cash_enabled) ||
    !['transfer', 'qris', 'cash'].includes(payment_method)
  ) {
    res.status(400).json({ error: 'Cara bayar yang dipilih tidak tersedia di toko ini.' });
    return;
  }

  const secret = process.env.BOOKING_REQUEST_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server belum terkonfigurasi untuk pesanan online.' });
    return;
  }

  // Review -c1 (ronde kedua): JANGAN tambah RPC secret-gated baru untuk
  // validasi item/stok — dua RPC publik yang SUDAH ADA menutupi ini
  // persis: get_public_page (019, items[] harga+hanya item aktif) dan
  // get_public_availability (021/028, remaining per item dihitung PERSIS
  // sama seperti usedUnitsOn() termasuk readiness_hours, titik TERBURUK
  // di sepanjang rentang). Ini SATU sumber kebenaran ketersediaan yang
  // sama dengan yang pelanggan sudah lihat di halaman Etalase sebelum
  // memesan — bukan jalur baca kedua yang bisa berbeda, dan tidak
  // membuka data booking_items lintas status yang tidak perlu diketahui
  // publik (yang sempat terjadi di pendekatan RPC baru sebelumnya).
  const { data: fullPageData, error: fullPageError } = await supabase.rpc('get_public_page', { p_slug: slug });
  if (fullPageError || !fullPageData) {
    res.status(404).json({ error: 'Toko tidak ditemukan.' });
    return;
  }
  const catalogItems = (fullPageData as { items: PublicPageItem[] }).items;

  const { data: availabilityRaw, error: availabilityError } = await supabase.rpc('get_public_availability', {
    p_slug: slug,
    p_start_date: start_date,
    p_end_date: end_date,
  });
  if (availabilityError || !availabilityRaw) {
    res.status(400).json({ error: 'Gagal mengecek ketersediaan.' });
    return;
  }
  const availability = availabilityRaw as unknown as PublicAvailabilityItem[];

  // rentalDays() inclusive (ambil=kembali hari sama = 1 hari) — dihitung
  // ulang di sini (bukan reuse dateRange, yang sekarang tidak diimpor)
  // karena hanya butuh COUNT hari, bukan daftar tanggalnya satu-satu.
  const rentalDaysCount =
    (new Date(`${end_date}T00:00:00Z`).getTime() - new Date(`${start_date}T00:00:00Z`).getTime()) / 86_400_000 + 1;
  let estimatedPrice = 0;

  for (const requested of requestedItems) {
    const catalogItem = catalogItems?.find((i) => i.id === requested.item_id);
    if (!catalogItem) {
      res.status(400).json({ error: 'Salah satu alat tidak ditemukan atau sudah tidak aktif.' });
      return;
    }
    const avail = availability.find((a) => a.id === requested.item_id);
    if (!avail || requested.quantity > avail.remaining) {
      res.status(409).json({
        error: `Alat "${catalogItem.name}" tidak cukup untuk tanggal yang dipilih (sisa ${avail?.remaining ?? 0}).`,
      });
      return;
    }

    // Review -c1: estimated_price TIDAK pernah dipercaya dari klien
    // (klien bisa kirim Rp0/Rp1, lalu halaman status menampilkan
    // "Perkiraan Rp0" ke pelanggan, jadi amunisi dispute). Dihitung
    // server-side dari harga katalog SAAT INI (computeItemRentalPrice(),
    // sama fungsi yang dipakai form internal/Etalase) × qty — ini murni
    // tampilan ("Perkiraan: Rp X", rencana 2.1 poin 3/2.13), harga final
    // tetap dihitung ulang vendor lewat Catat Transaksi biasa saat
    // konfirmasi.
    estimatedPrice += computeItemRentalPrice(catalogItem, rentalDaysCount) * requested.quantity;
  }

  // Batas kedaluwarsa (rencana 2.6 revisi): mana yang lebih dulu — N jam
  // dari sekarang (default 24, belum ada setting per-business di versi
  // ini, lihat catatan di bawah) ATAU awal hari start_date WIB.
  const DEFAULT_EXPIRY_HOURS = 24;
  const now = Date.now();
  const byHours = new Date(now + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);
  const startOfPickupDayWib = new Date(`${start_date}T00:00:00+07:00`);
  const expiresAt = byHours < startOfPickupDayWib ? byHours : startOfPickupDayWib;

  // Rencana 2.7: maks 3 pesanan 'menunggu' bersamaan per nomor WA per
  // business — mencegah satu nomor membanjiri satu vendor dengan pesanan
  // palsu berulang. normalizedPhone sudah dalam bentuk kanonik (lihat
  // normalizePhone()), jadi 08xx dan +62xx yang sama fisiknya dihitung
  // sebagai nomor yang sama di sini maupun saat disimpan.
  const MAX_PENDING_PER_PHONE = 3;
  const { data: pendingCount, error: pendingCountError } = await supabase.rpc(
    'count_pending_booking_requests_by_phone',
    { p_secret: secret, p_business_id: page.business_id, p_customer_phone: normalizedPhone },
  );
  if (pendingCountError) {
    res.status(500).json({ error: 'Gagal memvalidasi pesanan. Coba lagi sebentar.' });
    return;
  }
  if ((pendingCount ?? 0) >= MAX_PENDING_PER_PHONE) {
    res.status(429).json({
      error: 'Nomor ini sudah punya beberapa pesanan menunggu konfirmasi di toko ini. Tunggu vendor merespons, atau hubungi lewat WhatsApp.',
    });
    return;
  }

  const { data: newId, error: createError } = await supabase.rpc('create_booking_request', {
    p_secret: secret,
    p_business_id: page.business_id,
    p_customer_name: customer_name.trim(),
    p_customer_phone: normalizedPhone,
    p_note: typeof note === 'string' && note.trim() ? note.trim() : null,
    p_start_date: start_date,
    p_end_date: end_date,
    p_estimated_price: estimatedPrice,
    p_payment_method: payment_method,
    p_dp_amount: null,
    p_expires_at: expiresAt.toISOString(),
    p_items: requestedItems.map((i) => ({ item_id: i.item_id, quantity: i.quantity })),
  });

  if (createError || !newId) {
    // Review -c1 #4: createError.message bisa berisi teks internal (mis.
    // "secret tidak valid", nama fungsi) — jangan pernah diteruskan ke
    // klien publik, cukup di-log server-side.
    console.error('create_booking_request gagal:', createError?.message);
    res.status(400).json({ error: 'Gagal menyimpan pesanan. Coba lagi sebentar atau hubungi lewat WhatsApp.' });
    return;
  }

  // Review -c1 #3: cuma dicatat SETELAH insert benar-benar sukses —
  // request yang gagal validasi/stok/dsb tidak ikut memakan kuota
  // per-slug milik vendor ini.
  recordSlugAttempt(slug);

  // create_booking_request (037) mengembalikan id baris, bukan token —
  // tidak ada policy select publik di booking_requests (disengaja, lihat
  // migration 037 bagian 4), jadi token diambil lewat RPC kecil tambahan
  // (migration 039) yang menerima id+secret yang sama, bukan membuka
  // policy select baru untuk anon.
  const { data: tokenResult, error: tokenLookupError } = await supabase.rpc('get_booking_request_token', {
    p_secret: secret,
    p_booking_request_id: newId,
  });

  if (tokenLookupError || !tokenResult) {
    res.status(500).json({ error: 'Pesanan tersimpan tapi gagal mengambil link status. Hubungi vendor lewat WhatsApp.' });
    return;
  }

  res.status(201).json({ token: tokenResult });
});

router.get('/public/booking-requests/status/:token', async (req, res) => {
  const { token } = req.params;
  const supabase = createAnonClient();

  const { data, error } = await supabase.rpc('get_booking_request_status', { p_token: token });

  if (error || !data) {
    res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    return;
  }

  res.json(data);
});

export default router;
