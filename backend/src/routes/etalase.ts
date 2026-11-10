import { Router } from 'express';
import { createAnonClient } from '../lib/supabaseClient.js';
import { escapeHtml } from '../lib/html.js';
import { addDays, normalizeTimezone, todayInTz, tzLabel } from '../lib/dates.js';
import { buildWhatsAppUrl } from '../lib/whatsapp.js';
import { getShareCard, shareCardHash, type ShareCardInput } from '../lib/shareCard.js';

const router = Router();

// Fallback OG image kalau business belum punya alat berfoto sama sekali —
// aset yang sama dipakai landing/blog (lihat CLAUDE.md bagian 5, tabel
// aset "Open Graph / share image").
const FALLBACK_OG_IMAGE = 'https://sewalog.com/og-image.png';

type PublicItem = {
  id: string;
  name: string;
  category: string | null;
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
  image_url: string | null;
  variant: string | null;
  size: string | null;
  color: string | null;
};

type PublicPageData = {
  business_name: string;
  logo_url: string | null;
  description: string | null;
  address: string | null;
  regency_name: string | null;
  // Kecamatan (migration 052) — opsional, null kalau vendor tidak mengisi
  // (atau backend jalan sebelum migration 052 dijalankan).
  district_name?: string | null;
  // Zona rental (migration 053); undefined sebelum 053 dijalankan = WIB.
  timezone?: string | null;
  operating_hours: string | null;
  public_phone: string | null;
  writable: boolean;
  // Syarat & Ketentuan (migration 047) — tampil TERLEPAS dari status
  // Pesanan Online (keputusan Andi), makanya diambil dari get_public_page
  // (selalu dipanggil untuk katalog), bukan cuma ordering-config.
  terms_content: string | null;
  items: PublicItem[];
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Halaman publik "Etalase Online" — TANPA LOGIN, siapa saja bisa akses.
// Ini SENGAJA bukan route React (frontend/ 100% di belakang login, tanpa
// client-side routing sama sekali) dan bukan file HTML statis yang
// di-generate ulang tiap publish — dua-duanya perlu infrastruktur baru
// yang tidak sepadan untuk MVP ini:
//   - React SPA client-rendered TIDAK BISA memenuhi syarat "OG tags ada
//     di HTML mentah tanpa JS" (perlu SSR, belum ada di stack ini).
//   - File statis mirip landing/public/blog/*.html cocok untuk konten
//     yang di-build ulang lewat git push (Render Static Site), tapi
//     Etalase Online berubah tiap vendor toggle publish/edit profil dari
//     dalam app — butuh proses live yang bisa nulis file & retrigger
//     deploy Static Site saat itu juga, yang tidak dimiliki Render free
//     tier di luar git push.
// Backend Express ini SUDAH SATU-SATUNYA proses live di stack (bukan
// Static Site) — render HTML string on-demand di sini per request selalu
// mencerminkan data ter-update, dan tetap memenuhi syarat OG-tanpa-JS
// karena responsenya HTML mentah biasa, bukan hasil client-side render.
// TOKO_PUBLIC_HOST = hostname custom domain (mis. "toko.sewalog.com") yang
// dihubungkan ke Web Service backend ini di Render, KHUSUS buat Etalase
// Online — supaya link yang dibagikan vendor ke pelanggannya berbentuk
// "toko.sewalog.com/{slug}", bukan "api.sewalog.com/toko/{slug}" (subdomain
// "api" salah kesan buat halaman yang justru dilihat pelanggan, bukan
// dipanggil programatik). SATU Web Service Express yang sama tetap
// menjawab kedua domain (bisa dua Custom Domain sekaligus di Render), jadi
// dibedakan lewat host, bukan proses/deploy terpisah.
const TOKO_PUBLIC_HOST = process.env.TOKO_PUBLIC_HOST;

async function handleTokoRequest(req: import('express').Request, res: import('express').Response, slug: string) {
  const supabase = createAnonClient();

  // get_public_page() (migration 019) SECURITY DEFINER, sudah memfilter
  // published = true dan cuma balikin kolom aman (lihat komentar di
  // migration-nya) — jangan query tabel public_pages/items langsung di
  // sini (lihat larangan di komentar createAnonClient()).
  // get_public_ordering_page dipanggil paralel cuma untuk tahu apakah
  // Pesanan Online aktif (null = tidak aktif) — dipakai teks pratinjau
  // link ("pesan online sekarang" vs "cek katalog").
  const [{ data, error }, { data: orderingData }] = await Promise.all([
    supabase.rpc('get_public_page', { p_slug: slug }),
    supabase.rpc('get_public_ordering_page', { p_slug: slug }),
  ]);

  if (error || !data) {
    res.status(404).type('html').send(renderNotFound());
    return;
  }

  res.type('html').send(renderPage(data as PublicPageData, slug, req, Boolean(orderingData)));
}

// Gambar pratinjau link (og:image) 1200x630 PNG — lihat lib/shareCard.ts.
// Aktif di host manapun (toko.sewalog.com maupun domain backend), karena
// og:image di halaman Etalase menunjuk ke sini. `?v=` cuma pemecah cache
// di sisi WA/Telegram/FB; isi gambar selalu dihitung ulang dari data
// Etalase TERKINI (published), bukan dari parameter.
router.get('/og/:slug.png', async (req, res) => {
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc('get_public_page', { p_slug: req.params.slug });
  if (error || !data) {
    res.status(404).end();
    return;
  }
  try {
    const png = await getShareCard(shareCardInputFromPage(data as PublicPageData));
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('png').send(png);
  } catch {
    res.redirect(302, FALLBACK_OG_IMAGE);
  }
});

// Jalur dev/fallback — selalu aktif di host manapun (termasuk
// api.sewalog.com kalau ada yang masih pakai link lama, dan localhost saat
// dev karena TOKO_PUBLIC_HOST biasanya belum di-set di situ).
router.get('/toko/:slug', async (req, res) => {
  await handleTokoRequest(req, res, req.params.slug);
});

// Jalur publik utama produksi: root path di custom domain toko.sewalog.com
// (mis. "toko.sewalog.com/jawa-timur-outdoor"). Digerbangi ketat oleh host
// supaya TIDAK aktif di api.sewalog.com/domain lain — request root-path
// satu-segmen macam "/favicon.ico" di host lain harus tetap 404 biasa, bukan
// ketimpa jadi pencarian slug.
router.get('/:slug', async (req, res, next) => {
  if (!TOKO_PUBLIC_HOST || req.hostname !== TOKO_PUBLIC_HOST) {
    next();
    return;
  }
  await handleTokoRequest(req, res, req.params.slug);
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Batas atas rentang tanggal yang boleh dicek publik — generate_series di
// get_public_availability() (migration 021) cross join per-hari, jadi
// rentang tak terbatas dari endpoint publik-tanpa-login bisa disalahgunakan
// buat query berat. 60 hari lebih dari cukup buat kebutuhan sewa alat
// kamping (jarang lebih dari beberapa minggu).
const MAX_AVAILABILITY_RANGE_DAYS = 60;

// Pencarian ketersediaan per RENTANG tanggal (bukan satu tanggal — rental
// alat berlangsung beberapa hari, jadi yang relevan buat penyewa adalah
// "cukup stok di SEMUA hari dalam rentang ini", sama seperti validasi
// kapasitas POST /bookings, bukan cuma satu hari) — JSON, dipanggil lewat
// fetch() dari script inline di renderPage() di bawah, BUKAN bagian dari
// HTML awal (jadi tidak mengganggu syarat "OG tags tanpa JS" di atas).
// Exposure jumlah unit tersisa persis di sini SENGAJA, keputusan produk
// yang membalik aturan "total_units privat" — lihat komentar di migration
// 020_public_availability_search.sql sebelum mengubah ini.
router.get('/api/public/etalase/:slug/availability', async (req, res) => {
  const slug = req.params.slug;
  const startDate = req.query.start_date;
  const endDate = req.query.end_date;

  if (typeof startDate !== 'string' || !DATE_RE.test(startDate) || typeof endDate !== 'string' || !DATE_RE.test(endDate)) {
    res.status(400).json({ error: 'Parameter start_date dan end_date wajib diisi, format YYYY-MM-DD.' });
    return;
  }
  if (endDate < startDate) {
    res.status(400).json({ error: 'end_date tidak boleh sebelum start_date.' });
    return;
  }
  const rangeDays = (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000 + 1;
  if (rangeDays > MAX_AVAILABILITY_RANGE_DAYS) {
    res.status(400).json({ error: `Rentang tanggal maksimal ${MAX_AVAILABILITY_RANGE_DAYS} hari.` });
    return;
  }

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc('get_public_availability', {
    p_slug: slug,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'Etalase tidak ditemukan.' });
    return;
  }

  res.json({ items: data });
});

// Rencana 2.8/tahap 3: config tipis untuk JS klien supaya tahu apakah
// toggle "Terima pesanan online" vendor itu ON dan cara bayar mana yang
// aktif — SENGAJA wrap get_public_ordering_page (039) dan STRIP
// business_id sebelum dikirim ke browser (business_id tidak perlu
// diketahui publik sama sekali, cuma dipakai internal di RPC). Kalau
// RPC null (etalase tidak published ATAU accept_online_orders=false),
// balas enabled:false — tidak membedakan dua alasan itu ke klien,
// konsisten dengan create_booking_request yang juga tidak membedakannya.
router.get('/api/public/etalase/:slug/ordering-config', async (req, res) => {
  const slug = req.params.slug;
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc('get_public_ordering_page', { p_slug: slug });

  if (error || !data) {
    res.json({ enabled: false, payment_methods: { transfer: false, qris: false, cash: false } });
    return;
  }
  const page = data as {
    pay_transfer_enabled: boolean;
    pay_qris_enabled: boolean;
    pay_cash_enabled: boolean;
    terms_content: string | null;
    terms_version_id: string | null;
    rental_day_mode: 'per_malam' | 'per_hari_kalender';
    min_rental_days: number | null;
    max_rental_days: number | null;
  };
  res.json({
    enabled: true,
    payment_methods: {
      transfer: page.pay_transfer_enabled,
      qris: page.pay_qris_enabled,
      cash: page.pay_cash_enabled,
    },
    // Paket minimal/maksimal hari (migration 054) — Pesanan Online
    // DIBLOKIR di luar rentang ini (beda dari walk-in Catat Transaksi,
    // yang hanya menolak di bawah min). Divalidasi ulang server-side di
    // bookingRequests.ts dan create_booking_request, ini cuma supaya
    // pelanggan tidak perlu submit dulu untuk tahu ditolak.
    min_rental_days: page.min_rental_days,
    max_rental_days: page.max_rental_days,
    // Syarat & Ketentuan (migration 047) — diambil fresh tiap kali form
    // pesanan dibuka (bukan dari get_public_page saat load halaman
    // pertama kali), supaya kalau vendor ubah teksnya SETELAH pengunjung
    // buka halaman tapi SEBELUM submit, versi yang ditampilkan+dikirim
    // balik tetap yang terbaru — create_booking_request sendiri tetap
    // jadi penjaga utama (menolak kalau basi), ini cuma supaya kasus
    // "terlambat" itu jarang terjadi di awal.
    terms_content: page.terms_content,
    terms_version_id: page.terms_version_id,
    // Cara hitung durasi sewa (migration 049) — mode LIVE toko ini,
    // dipakai form pesanan untuk batas minimum tanggal kembali + hitung
    // perkiraan harga yang sama persis dengan yang dihitung ulang server
    // (bookingRequests.ts) saat submit.
    rental_day_mode: page.rental_day_mode,
  });
});

type BookingRequestStatus = {
  status: 'menunggu' | 'dikonfirmasi' | 'ditolak' | 'kedaluwarsa';
  // 6 karakter pertama booking_requests.id, huruf besar (migration 051)
  // — kode pendek buat dicocokkan manual antar admin, BUKAN rahasia
  // (beda dari token di URL ini sendiri, yang tetap jadi access-key).
  order_code: string;
  customer_name: string;
  start_date: string;
  end_date: string;
  estimated_price: number;
  payment_method: 'transfer' | 'qris' | 'cash' | null;
  dp_amount: number | null;
  rejection_reason: string | null;
  expires_at: string;
  accepted_terms_content: string | null;
  business_name: string;
  timezone?: string | null; // migration 053
  logo_url: string | null;
  public_phone: string | null;
  slug: string | null;
  // Nomor WA admin untuk Pesanan Online (migration 051) — Admin 1 SUDAH
  // di-coalesce dengan public_phone di RPC kalau dikosongkan, jadi di
  // sini bisa anggap "null = benar-benar tidak ada nomor sama sekali".
  // Admin 2/3 murni opsional, tanpa fallback apa pun.
  order_admin_phone_1: string | null;
  order_admin_phone_2: string | null;
  order_admin_phone_3: string | null;
  confirmation_message: string | null;
  payment_snapshot: {
    dp_mode: 'none' | 'percent' | 'fixed';
    dp_amount_computed: number;
    total_final: number;
    bank_name?: string;
    bank_account_number?: string;
    bank_account_holder?: string;
    qris_image_url?: string;
    pay_cash_enabled?: boolean;
    confirmed_at: string;
  } | null;
  items: { name: string; quantity: number }[];
};

// Halaman status pesanan — rencana 2.1 langkah 5/6, 2.8b. Token
// unguessable (uuid v4) di URL, pola sama seperti Bilbo (rencana 1.2).
//
// Review -c1 (tahap 3, poin 1): link ini dibagikan lewat tombol WA
// pre-filled DAN muncul di URL bar browser pelanggan — kalau diteruskan
// ke orang lain atau dibuka dari link WA, jangan sampai URL (yang berisi
// token identitas pesanan) bocor lewat header Referer ke tombol WA/
// gambar QRIS di halaman ini sendiri, jangan sampai mesin pencari
// mengindeksnya, dan jangan sampai browser men-cache versi lama (status
// berubah tiap vendor konfirmasi/tolak).
router.get('/pesanan/:token', async (req, res) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');

  const token = req.params.token;
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc('get_booking_request_status', { p_token: token });

  if (error || !data) {
    res.status(404).type('html').send(renderStatusNotFound());
    return;
  }

  res.type('html').send(renderStatusPage(data as BookingRequestStatus, req, token));
});

function renderStatusNotFound(): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="referrer" content="no-referrer" />
<meta name="robots" content="noindex,nofollow" />
<title>Pesanan tidak ditemukan — Sewalog</title>
</head>
<body style="font-family:system-ui,sans-serif;background:#F1EEE2;color:#26302B;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;">
<div>
<h1 style="font-size:1.25rem;">Pesanan ini tidak ditemukan</h1>
<p style="color:#6E6853;">Link mungkin salah ketik atau sudah tidak berlaku.</p>
</div>
</body>
</html>`;
}

function formatDateID(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Batas konfirmasi (tahap 5) — tampil cuma untuk status 'menunggu'
// (lihat renderStatusPage), di zona RENTAL (migration 053, WIB/WITA/WIT),
// bukan timezone server atau browser pelanggan.
function formatDeadline(expiresAtIso: string, timezone: string | null | undefined): string {
  const tz = normalizeTimezone(timezone);
  const d = new Date(expiresAtIso);
  const dayDate = d.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: tz,
  });
  const time = d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
  return `${dayDate} pukul ${time} ${tzLabel(tz)}`;
}

// Review -c1 (tahap 3, poin 1): OG tags di halaman ini SENGAJA generik
// (cuma nama toko) — link ini dibagikan lewat WA, jadi preview-nya
// terlihat oleh SIAPA PUN yang menerima forward link itu. Nama
// pelanggan/alat/harga TIDAK PERNAH masuk og:title/og:description di
// sini, beda dari halaman Etalase (/toko/{slug}) yang memang untuk
// katalog publik.
// URL halaman status ini sendiri — dipakai di teks pesan WA (migration
// 051, poin "order code/link") supaya admin lain yang menerima pesan
// bisa langsung klik untuk melihat detail pesanan yang sama. SENGAJA
// tidak lewat TOKO_PUBLIC_HOST seperti resolvePageUrl() — /pesanan/:token
// bukan bagian dari gerbang domain custom toko, selalu dijawab di host
// manapun Express ini jalan.
function resolveStatusPageUrl(req: import('express').Request, token: string): string {
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${baseUrl}/pesanan/${token}`;
}

function renderStatusPage(data: BookingRequestStatus, req: import('express').Request, token: string): string {
  // reuse resolvePageUrl() (dipakai juga di renderPage Etalase) supaya
  // link "Lihat katalog" ini benar di kedua domain (toko.sewalog.com vs
  // /toko/{slug} fallback) — bukan hardcode "/toko/" di sini.
  const catalogUrl = data.slug ? resolvePageUrl(req, data.slug) : null;
  const statusPageUrl = resolveStatusPageUrl(req, token);
  const statusLabel: Record<BookingRequestStatus['status'], { text: string; color: string; bg: string }> = {
    menunggu: { text: 'Menunggu konfirmasi', color: '#A65C2A', bg: 'rgba(166,92,42,0.12)' },
    dikonfirmasi: { text: 'Dikonfirmasi', color: '#2B4739', bg: 'rgba(43,71,57,0.12)' },
    ditolak: { text: 'Ditolak', color: '#A8412E', bg: 'rgba(168,65,46,0.12)' },
    kedaluwarsa: { text: 'Kedaluwarsa', color: '#A8412E', bg: 'rgba(168,65,46,0.12)' },
  };
  const label = statusLabel[data.status];

  const itemsListHtml = data.items
    .map((it) => `<li>${escapeHtml(it.name)} × ${it.quantity}</li>`)
    .join('');

  // Review -c1 (tahap 3 putaran 2, poin 3): teks tombol WA berubah sesuai
  // status — sebelum konfirmasi cuma "kirim pesanan" (belum ada yang
  // perlu dibayar), SETELAH konfirmasi berubah jadi "kirim bukti bayar"
  // dengan nominal+link ikut di pesan (vendor butuh tahu ini pesanan
  // yang mana + sudah bayar berapa), ditolak/kedaluwarsa cukup "chat".
  //
  // Migration 051: sampai 3 nomor admin, label tetap "Admin N" (bukan
  // nama business — pelanggan perlu tahu ini admin KE BERAPA, bukan
  // cuma "WA toko"). Setiap pesan ikut menyertakan order_code + link
  // halaman status ini sendiri, supaya admin manapun yang menerima bisa
  // mencocokkan ke pesanan yang sama (poin -c1: order_code dari
  // booking_requests.id, BUKAN token — token tetap rahasia URL).
  function waTextFor(label: string): string {
    // Jaring pengaman sekuens deploy yang sama seperti admin1 ?? public_phone
    // di atas — kalau kode ini ter-deploy sebelum migration 051 benar-benar
    // jalan, order_code belum ada sama sekali (bukan string kosong,
    // literally undefined dari RPC lama) — jangan sampai tampil harfiah
    // "Kode pesanan: undefined" ke pelanggan, baris ini dihilangkan saja
    // kalau belum ada, link status tetap selalu disertakan.
    const orderRef = data.order_code ? `\n\nKode pesanan: ${data.order_code}\n${statusPageUrl}` : `\n\n${statusPageUrl}`;
    if (data.status === 'dikonfirmasi' && data.payment_snapshot) {
      const amount = data.payment_snapshot.dp_mode === 'none' ? data.payment_snapshot.total_final : data.payment_snapshot.dp_amount_computed;
      return `Halo ${label}, ini bukti bayar ${formatIDR(amount)} untuk pesanan saya (${data.start_date} s/d ${data.end_date}).${orderRef}`;
    }
    if (data.status === 'ditolak' || data.status === 'kedaluwarsa') {
      return `Halo ${label}, saya mau tanya soal pesanan saya.${orderRef}`;
    }
    return `Halo ${label}, saya sudah kirim pesanan online untuk ${data.start_date} s/d ${data.end_date}.${orderRef}`;
  }
  function waLabelFor(adminLabel: string): string {
    if (data.status === 'dikonfirmasi' && data.payment_snapshot) return `Kirim bukti bayar ke WA ${adminLabel}`;
    if (data.status === 'ditolak' || data.status === 'kedaluwarsa') return `Chat ${adminLabel} di WA`;
    return `Kirim pesanan ke WA ${adminLabel}`;
  }

  // Nomor yang sama (setelah dinormalkan ke bentuk "62xxxxxxxxxx", pola
  // sama seperti normalizePhone() di bookingRequests.ts) di slot Admin
  // berbeda didedupe — tetap satu tombol, bukan dua tombol identik
  // (review -c1 poin 2).
  function normalizePhoneForCompare(raw: string): string {
    const stripped = raw.replace(/[\s-]/g, '').replace(/^\+/, '');
    return stripped.startsWith('0') ? `62${stripped.slice(1)}` : stripped;
  }
  const seenPhones = new Set<string>();
  const adminButtons: { label: string; phone: string }[] = [];
  // Review -c1 (risiko urutan deploy): RPC get_booking_request_status
  // SUDAH mem-coalesce Admin 1 dengan public_phone (migration 051) —
  // tapi kalau kode ini ter-deploy SEBELUM migration 051 benar-benar
  // jalan (atau PostgREST masih menyajikan versi RPC lama dari cache
  // schema), order_admin_phone_1 akan undefined sama sekali sementara
  // public_phone tetap ada (sudah sejak migration 041). Fallback kedua
  // di sini (?? data.public_phone) murni jaring pengaman supaya tombol
  // WA yang SUDAH ADA hari ini tidak pernah hilang/regresi gara-gara
  // sekuens deploy, bukan duplikasi logika coalesce RPC yang disengaja.
  [data.order_admin_phone_1 ?? data.public_phone, data.order_admin_phone_2, data.order_admin_phone_3].forEach((phone, idx) => {
    if (!phone) return;
    const normalized = normalizePhoneForCompare(phone);
    if (seenPhones.has(normalized)) return;
    seenPhones.add(normalized);
    adminButtons.push({ label: `Admin ${idx + 1}`, phone });
  });

  // Tidak ada nomor admin sama sekali (vendor belum isi Admin 1 ATAUPUN
  // public_phone Etalase) — arahkan ke kontak di halaman katalog,
  // bukan dibiarkan jadi area tombol kosong (review -c1 poin 2).
  const waButtonHtml =
    adminButtons.length === 0
      ? catalogUrl
        ? `<p style="margin-top:16px;font-size:0.85rem;color:#6E6853;text-align:center;">Hubungi rental lewat kontak di <a href="${escapeHtml(catalogUrl)}" style="color:#2B4739;font-weight:700;">halaman katalog</a>.</p>`
        : `<p style="margin-top:16px;font-size:0.85rem;color:#6E6853;text-align:center;">Hubungi rental lewat kontak di halaman katalog.</p>`
      : `${
          adminButtons.length > 1
            ? `<p style="margin-top:14px;font-size:0.75rem;color:#6E6853;text-align:center;">Cukup hubungi salah satu admin.</p>`
            : ''
        }${adminButtons
          .map((admin, i) => {
            const url = buildWhatsAppUrl(admin.phone, waTextFor(admin.label));
            const primary = i === 0;
            // margin-top 16px persis sama dengan tombol tunggal yang lama
            // (review -c1: "kalau cuma satu nomor, tampil sama seperti
            // sekarang") — tombol ke-2/3 pakai 10px, lebih rapat karena
            // sudah ada tombol di atasnya, bukan jarak dari teks di atas.
            const style = primary
              ? 'display:block;text-align:center;margin-top:16px;background:#2B4739;color:#fff;font-weight:700;font-size:0.9rem;padding:13px 18px;border-radius:12px;text-decoration:none;min-height:44px;'
              : 'display:block;text-align:center;margin-top:10px;background:#fff;color:#2B4739;font-weight:700;font-size:0.9rem;padding:13px 18px;border-radius:12px;border:1.5px solid #2B4739;text-decoration:none;min-height:44px;';
            return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow" style="${style}">${escapeHtml(waLabelFor(admin.label))}</a>`;
          })
          .join('\n')}`;

  let bodyExtraHtml = '';

  if (data.status === 'menunggu') {
    // Batas konfirmasi (tahap 5) — pakai expires_at sungguhan dari
    // confirmation_deadline_hours per-business (migration 046), bukan
    // lagi teks generik "24 jam" yang dulu selalu sama padahal angkanya
    // sekarang bisa beda per vendor. Cuma tampil untuk status 'menunggu'
    // (instruksi review) — sudah tidak relevan begitu dikonfirmasi/
    // ditolak/kedaluwarsa.
    // Beda dari confirmation_message custom vendor (paragraf terpisah,
    // lihat di bawah) — ini data faktual (tanggal/jam sungguhan), bukan
    // teks reassurance, jadi SELALU ditampilkan terlepas vendor sudah
    // isi pesan custom atau belum (beda dari perilaku lama yang
    // menyembunyikan baris "24 jam" generik kalau custom message ada).
    bodyExtraHtml = `<p style="margin:10px 0 0;font-size:0.85rem;color:#6E6853;">Batas konfirmasi: <strong style="color:#26302B;">${escapeHtml(formatDeadline(data.expires_at, data.timezone))}</strong>. Kalau mendesak, langsung chat WA.</p>`;
  } else if (data.status === 'ditolak') {
    bodyExtraHtml = `<p style="margin:10px 0 0;font-size:0.85rem;color:#A8412E;">Alasan: ${escapeHtml(data.rejection_reason ?? 'Tidak disebutkan')}. Silakan hubungi lewat WA untuk tanggal lain, atau pesan ulang.</p>`;
  } else if (data.status === 'kedaluwarsa') {
    bodyExtraHtml = `<p style="margin:10px 0 0;font-size:0.85rem;color:#A8412E;">Pesanan kedaluwarsa — vendor belum sempat menanggapi. Silakan hubungi lewat WA atau pesan ulang.</p>`;
  } else if (data.status === 'dikonfirmasi' && data.payment_snapshot) {
    const snap = data.payment_snapshot;
    const bayarSekarang = snap.dp_mode === 'none' ? snap.total_final : snap.dp_amount_computed;
    const bayarLabel = snap.dp_mode === 'none' ? 'Total yang harus dibayar' : 'DP yang harus dibayar sekarang';
    const sisaSaatAmbil = snap.dp_mode === 'none' ? 0 : snap.total_final - snap.dp_amount_computed;

    const transferHtml = snap.bank_name
      ? `<div style="margin-top:12px;padding:12px;background:#F1EEE2;border-radius:12px;">
      <p style="margin:0;font-size:0.75rem;color:#6E6853;font-weight:700;">Transfer Bank</p>
      <p style="margin:4px 0 0;font-weight:700;">${escapeHtml(snap.bank_name)} — ${escapeHtml(snap.bank_account_number ?? '')}</p>
      <p style="margin:2px 0 0;color:#6E6853;font-size:0.85rem;">a.n. ${escapeHtml(snap.bank_account_holder ?? '')}</p>
      <button type="button" class="copy-btn" data-copy="${escapeHtml(snap.bank_account_number ?? '')}" style="margin-top:8px;min-height:36px;padding:6px 12px;border-radius:8px;border:1px solid #DBD5C1;background:#FBFAF4;font-size:0.75rem;font-weight:700;cursor:pointer;">Salin nomor rekening</button>
    </div>`
      : '';

    const qrisHtml = snap.qris_image_url
      ? `<div style="margin-top:12px;text-align:center;">
      <p style="margin:0 0 6px;font-size:0.75rem;color:#6E6853;font-weight:700;">QRIS</p>
      <img src="${escapeHtml(snap.qris_image_url)}" alt="QRIS ${escapeHtml(data.business_name)}" referrerpolicy="no-referrer" style="max-width:220px;border-radius:12px;border:1px solid #DBD5C1;" />
      <p style="margin:6px 0 0;font-size:0.8rem;color:#6E6853;">Ketik nominal ${formatIDR(bayarSekarang)} sendiri saat scan (QRIS statis).</p>
    </div>`
      : '';

    const cashHtml = snap.pay_cash_enabled && !snap.bank_name && !snap.qris_image_url
      ? `<p style="margin-top:12px;color:#6E6853;">Bayar saat ambil alat.</p>`
      : '';

    bodyExtraHtml = `
    <div style="margin-top:14px;padding:16px;background:#FBFAF4;border:1px solid #DBD5C1;border-radius:16px;">
      <p style="margin:0;font-size:0.8rem;color:#6E6853;">${escapeHtml(bayarLabel)}</p>
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
        <p style="margin:2px 0 0;font-size:1.6rem;font-weight:700;color:#2B4739;">${formatIDR(bayarSekarang)}</p>
        <button type="button" class="copy-btn" data-copy="${bayarSekarang}" style="min-height:36px;padding:6px 12px;border-radius:8px;border:1px solid #DBD5C1;background:#fff;font-size:0.75rem;font-weight:700;cursor:pointer;">Salin nominal</button>
      </div>
      ${sisaSaatAmbil > 0 ? `<p style="margin:6px 0 0;font-size:0.8rem;color:#6E6853;">Sisa saat ambil: ${formatIDR(sisaSaatAmbil)}</p>` : ''}
      ${transferHtml}
      ${qrisHtml}
      ${cashHtml}
      <p style="margin-top:12px;font-size:0.75rem;color:#6E6853;">Pembayaran langsung ke ${escapeHtml(data.business_name)}. Sewalog tidak menerima atau menyimpan dana.</p>
    </div>`;
  }

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#2B4739" />
<meta name="referrer" content="no-referrer" />
<meta name="robots" content="noindex,nofollow" />
<title>Status Pesanan — Sewalog</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Sewalog" />
<meta property="og:title" content="Status pesanan di ${escapeHtml(data.business_name)}" />
<meta property="og:description" content="Cek status pesanan rental Anda." />
${data.slug ? `<meta property="og:image" content="${escapeHtml(shareImageUrl(req, data.slug))}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />` : ''}
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #F1EEE2; color: #26302B; font-family: system-ui, -apple-system, sans-serif; }
  .wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px 40px; }
  .card { background: #FBFAF4; border: 1px solid #DBD5C1; border-radius: 16px; padding: 18px; }
  .copy-btn.copied { background: #2B4739 !important; color: #fff; border-color: #2B4739 !important; }
</style>
</head>
<body>
<div class="wrap">
  <!-- Review -c1 (poin 1): halaman INI adalah tempat pelanggan
       mentransfer uang — identitas toko (logo+nama) WAJIB paling
       menonjol di atas (kepercayaan + mencegah salah transfer ke toko
       lain), bukan ditimpa judul generik "Status Pesanan Online" saja. -->
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
    ${
      data.logo_url
        ? `<img src="${escapeHtml(data.logo_url)}" alt="" style="width:40px;height:40px;object-fit:contain;border-radius:10px;border:1px solid #DBD5C1;background:#fff;flex-shrink:0;" />`
        : ''
    }
    <div>
      <p style="margin:0;font-weight:700;font-size:1.05rem;">${escapeHtml(data.business_name)}</p>
      <p style="margin:0;font-size:0.75rem;color:#6E6853;">Status Pesanan Online</p>
    </div>
  </div>
  ${
    catalogUrl
      ? `<a href="${escapeHtml(catalogUrl)}" style="display:inline-block;margin-bottom:14px;font-size:0.8rem;color:#2B4739;font-weight:700;text-decoration:none;">&larr; Lihat katalog ${escapeHtml(data.business_name)}</a>`
      : ''
  }
  <div class="card">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:0.75rem;font-weight:700;color:${label.color};background:${label.bg};">${label.text}</span>
      <!-- Kode pendek (migration 051) — supaya pelanggan bisa sebutkan
           ke admin mana pun kalau dihubungi admin yang berbeda dari
           yang pertama ditunjukkan di tombol WA di bawah; sama persis
           angka yang dikirim otomatis lewat pesan WA, dan sama persis
           yang ditampilkan di kartu "Pesanan masuk" vendor. Disembunyikan
           kalau belum ada (jaring pengaman sekuens deploy sebelum
           migration 051 benar-benar jalan — lihat orderRef di atas). -->
      ${
        data.order_code
          ? `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:0.7rem;font-weight:700;font-family:monospace;color:#6E6853;background:#F1EEE2;border:1px solid #DBD5C1;">Kode: ${escapeHtml(data.order_code)}</span>`
          : ''
      }
    </div>
    <p style="margin:12px 0 0;font-size:0.8rem;color:#6E6853;">Pemesan</p>
    <p style="margin:2px 0 0;font-weight:700;">${escapeHtml(data.customer_name)}</p>
    <p style="margin:10px 0 0;font-size:0.8rem;color:#6E6853;">Tanggal sewa</p>
    <p style="margin:2px 0 0;font-weight:700;">${escapeHtml(formatDateID(data.start_date))} s/d ${escapeHtml(formatDateID(data.end_date))}</p>
    <p style="margin:10px 0 0;font-size:0.8rem;color:#6E6853;">Alat</p>
    <ul style="margin:4px 0 0;padding-left:18px;">${itemsListHtml}</ul>
    ${
      // Review -c1 (poin 2): setelah dikonfirmasi, "Total sewa" di
      // sini DISEMBUNYIKAN — membingungkan berdampingan dengan total
      // final sungguhan yang sudah tampil di bodyExtraHtml (mis.
      // Rp50.000 vs Rp120.000, padahal yang Rp120.000 itu yang benar).
      // Label+teks penjelasan ini SENGAJA sama persis dengan yang di
      // form pesanan Etalase (lihat cart-total-price di renderPage())
      // — satu istilah konsisten "Total sewa" (bukan "Perkiraan total")
      // dipakai di kedua tempat, keputusan Andi 3 Nov 2026.
      data.status === 'dikonfirmasi'
        ? ''
        : `<p style="margin:10px 0 0;font-size:0.8rem;color:#6E6853;">Total sewa</p>
    <p style="margin:2px 0 0;font-weight:700;">${formatIDR(data.estimated_price)}</p>
    <p style="margin:2px 0 0;font-size:0.75rem;color:#6E6853;">Harga sesuai katalog. Total final tertera setelah rental mengonfirmasi pesanan.</p>`
    }
    ${data.confirmation_message && data.status === 'menunggu' ? `<p style="margin:10px 0 0;font-size:0.85rem;color:#26302B;">${escapeHtml(data.confirmation_message)}</p>` : ''}
    ${bodyExtraHtml}
    ${waButtonHtml}
    ${
      // Syarat & Ketentuan (migration 047) — link ke versi yang DISETUJUI
      // pelanggan saat pesan (accepted_terms_content, dari
      // booking_requests.terms_version_id), bukan versi current toko
      // saat ini kalau sudah berbeda. <details> polos (tanpa JS) cukup
      // di sini — beda dari halaman katalog yang perlu modal karena ada
      // form di atasnya, halaman status ini statis.
      data.accepted_terms_content
        ? `<details style="margin-top:14px;">
      <summary style="font-size:0.8rem;color:#2B4739;font-weight:700;cursor:pointer;">Syarat yang kamu setujui</summary>
      <p style="margin:6px 0 0;font-size:0.75rem;color:#6E6853;">Syarat ini dibuat oleh ${escapeHtml(data.business_name)} — Sewalog bukan pihak dalam perjanjian sewa ini.</p>
      <div style="margin-top:8px;white-space:pre-wrap;font-size:0.8rem;color:#26302B;background:#F1EEE2;border-radius:10px;padding:10px;">${escapeHtml(data.accepted_terms_content)}</div>
    </details>`
        : ''
    }
  </div>
  <footer style="margin-top:24px;text-align:center;font-size:0.75rem;color:#6E6853;">
    Pesanan online ini dibuat pakai <a href="https://sewalog.com" style="color:#2B4739;font-weight:600;">Sewalog</a>.
  </footer>
</div>
<script>
document.querySelectorAll('.copy-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var value = btn.getAttribute('data-copy');
    navigator.clipboard.writeText(value).then(function () {
      var original = btn.textContent;
      btn.textContent = 'Tersalin!';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = original; btn.classList.remove('copied'); }, 1500);
    }).catch(function () {});
  });
});
</script>
</body>
</html>`;
}

function renderNotFound(): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>Halaman tidak ditemukan — Sewalog</title>
</head>
<body style="font-family:system-ui,sans-serif;background:#F1EEE2;color:#26302B;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;">
<div>
<h1 style="font-size:1.25rem;">Halaman etalase ini tidak ditemukan</h1>
<p style="color:#6E6853;">Link mungkin salah ketik, atau vendornya belum mengaktifkan Etalase Online.</p>
</div>
</body>
</html>`;
}

// Canonical/og:url SENGAJA selalu mengarah ke SATU bentuk URL (bukan ikut
// persis bagaimana request ini datang) — kalau halaman yang sama bisa
// diakses dari toko.sewalog.com/{slug} MAUPUN api.sewalog.com/toko/{slug}
// (jalur dev/fallback, lihat komentar TOKO_PUBLIC_HOST di atas), canonical
// yang ikut-ikutan berubah per request itu sendiri kontradiktif dengan
// konsep "canonical". Kalau TOKO_PUBLIC_HOST sudah di-set (production),
// selalu pakai bentuk toko.sewalog.com/{slug} apapun jalur yang benar-benar
// dipakai pengunjung. Kalau belum (dev lokal, custom domain belum
// disambungkan), fallback ke bentuk /toko/{slug} di host request saat ini.
function resolvePageUrl(req: import('express').Request, slug: string): string {
  if (TOKO_PUBLIC_HOST) {
    return `https://${TOKO_PUBLIC_HOST}/${slug}`;
  }
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${baseUrl}/toko/${slug}`;
}

function locationLabelOf(page: PublicPageData): string {
  return [page.district_name ? `Kec. ${page.district_name}` : null, page.regency_name].filter(Boolean).join(', ');
}

function shareCardInputFromPage(page: PublicPageData): ShareCardInput {
  return { businessName: page.business_name, logoUrl: page.logo_url, location: locationLabelOf(page) };
}

// Origin tempat route /og/:slug.png dijawab — host yang sama dengan
// canonical Etalase (toko.sewalog.com di produksi).
function shareImageUrl(req: import('express').Request, slug: string, version?: string): string {
  const origin = new URL(resolvePageUrl(req, slug)).origin;
  return `${origin}/og/${encodeURIComponent(slug)}.png${version ? `?v=${version}` : ''}`;
}

function renderPage(page: PublicPageData, slug: string, req: import('express').Request, orderingEnabled = false): string {
  // "Kec. Lowokwaru, Kota Malang" — kecamatan opsional (migration 052).
  const locationLabel = locationLabelOf(page);
  const pageUrl = resolvePageUrl(req, slug);

  const itemWithPhoto = page.items.find((item) => item.image_url);
  // og:image = gambar share 1200x630 PNG (lib/shareCard.ts): logo vendor
  // dikonversi, atau kartu nama rental kalau belum ada logo. ?v= = hash
  // isi, supaya WA/Telegram/FB mengambil ulang begitu logo/nama berubah.
  const ogImage = shareImageUrl(req, slug, shareCardHash(shareCardInputFromPage(page)));

  // Teks pratinjau link (WA/Telegram/IG/TikTok) — gaya "Sewa Alat Camping
  // {nama}" + ajakan. Kata "sewa"/"rental" tidak diulang kalau sudah ada
  // di nama usahanya sendiri.
  const shareTitle = /\b(sewa|rental|rent)\b/i.test(page.business_name)
    ? page.business_name
    : `Sewa Alat Camping ${page.business_name}`;
  const shareTitleFull = locationLabel ? `${shareTitle} — ${page.regency_name ?? locationLabel}` : shareTitle;
  const shareDescription = orderingEnabled
    ? 'Cek stok alat & pesan online sekarang — tinggal pilih tanggal, kirim pesanan.'
    : 'Cek katalog & stok alat sewa, lalu hubungi lewat WhatsApp.';

  const title = `${shareTitleFull} | Sewalog`;
  const description =
    page.description?.trim() ||
    `Lihat katalog alat sewa dari ${page.business_name}. Hubungi lewat WhatsApp untuk cek ketersediaan.`;

  const waUrl = page.public_phone
    ? buildWhatsAppUrl(page.public_phone, `Halo ${page.business_name}, saya lihat Etalase Online kalian dan tertarik sewa alat.`)
    : null;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: page.business_name,
  };
  if (page.description) jsonLd.description = page.description;
  const street = [page.address, page.district_name ? `Kec. ${page.district_name}` : null].filter(Boolean).join(', ');
  if (street || page.regency_name) {
    jsonLd.address = {
      '@type': 'PostalAddress',
      ...(street ? { streetAddress: street } : {}),
      ...(page.regency_name ? { addressLocality: page.regency_name } : {}),
      addressCountry: 'ID',
    };
  }
  if (page.public_phone) jsonLd.telephone = page.public_phone;
  if (itemWithPhoto?.image_url) jsonLd.image = itemWithPhoto.image_url;

  // Kategori distinct, diurutkan — dipakai buat filter pill di bawah
  // (mirip CategoryFilterTabs Bilbo-Outdoors, lihat
  // ~/Bilbo-Outdoors/src/components/client/CategoryFilterTabs.tsx — tapi
  // TANPA cart/quantity-selector yang ada di layar itu, karena itu bagian
  // storefront+checkout Bilbo yang eksplisit BUKAN yang dibangun di sini).
  // Filter murni show/hide sisi klien, tidak fetch ulang — semua item
  // sudah ada di HTML ini sejak awal.
  const categories = Array.from(
    new Set(page.items.map((item) => item.category).filter((c): c is string => Boolean(c))),
  ).sort((a, b) => a.localeCompare(b, 'id'));

  // Panah geser kiri/kanan meniru ScrollableRow.tsx (frontend/src/
  // components/ScrollableRow.tsx) — dua tombol chevron di kiri-kanan
  // baris pill yang scroll-nya sendiri, dipakai juga buat baris tab
  // navbar in-app. Di sini plain button + scrollBy() vanilla JS, bukan
  // komponen React, tapi UX-nya sama persis.
  const categoryFilterHtml =
    categories.length > 1
      ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
    <button type="button" id="cat-scroll-left" aria-label="Geser ke kiri" style="flex-shrink:0;width:28px;height:28px;border-radius:8px;border:1px solid #DBD5C1;background:#FBFAF4;color:#26302B;font-weight:700;cursor:pointer;">&lsaquo;</button>
    <div id="cat-filter" class="cat-filter" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">
      <button type="button" class="cat-pill active" data-cat="">Semua</button>
      ${categories
        .map((cat) => `<button type="button" class="cat-pill" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`)
        .join('\n      ')}
    </div>
    <button type="button" id="cat-scroll-right" aria-label="Geser ke kanan" style="flex-shrink:0;width:28px;height:28px;border-radius:8px;border:1px solid #DBD5C1;background:#FBFAF4;color:#26302B;font-weight:700;cursor:pointer;">&rsaquo;</button>
  </div>`
      : '';

  // Ikon placeholder "tanpa foto" (point 5, keputusan Andi) — glyph gunung
  // sederhana, dipakai sama persis buat semua item tanpa foto (bukan kotak
  // abu-abu kosong seperti sebelumnya).
  const NO_PHOTO_ICON = `<div style="width:100%;height:160px;background:#F1EEE2;display:flex;align-items:center;justify-content:center;">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#B5AF95" stroke-width="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="9.5" r="1.4"/><path d="M4.5 16.5l4.8-5.5 3 3.3 2.4-2.7L19.5 16.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>`;

  const itemsHtml = page.items.length
    ? page.items
        .map((item) => {
          const details = [item.variant, item.size, item.color].filter(Boolean).join(' · ');
          return `<div class="item-card" data-cat="${escapeHtml(item.category ?? '')}" style="background:#FBFAF4;border:1px solid #DBD5C1;border-radius:16px;overflow:hidden;">
  ${
    item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" class="zoomable" style="width:100%;height:160px;object-fit:cover;display:block;" loading="lazy" onclick="openZoom(this)" />`
      : NO_PHOTO_ICON
  }
  <div style="padding:12px;">
    <p style="margin:0;font-weight:700;color:#26302B;">${escapeHtml(item.name)}</p>
    ${item.category ? `<p style="margin:2px 0 0;font-size:0.8rem;color:#6E6853;">${escapeHtml(item.category)}</p>` : ''}
    ${details ? `<p style="margin:3px 0 0;font-size:0.75rem;color:#6E6853;font-weight:600;">${escapeHtml(details)}</p>` : ''}
    <p style="margin:8px 0 0;font-weight:700;color:#2B4739;">${formatIDR(item.price_per_day)} <span style="font-weight:400;color:#6E6853;font-size:0.75rem;">/hari</span></p>
    ${
      item.extra_day_rate < item.price_per_day
        ? `<p style="margin:2px 0 0;font-size:0.75rem;color:#6E6853;">Mulai ${formatIDR(item.extra_day_rate)}/hari untuk sewa panjang</p>`
        : ''
    }
    <p data-total="${escapeHtml(item.id)}" style="display:none;margin:4px 0 0;font-size:0.8rem;font-weight:700;color:#26302B;"></p>
    <span data-avail="${escapeHtml(item.id)}" style="display:none;margin-top:6px;padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:700;"></span>
    <div data-action="${escapeHtml(item.id)}" style="display:none;margin-top:8px;">
      <button type="button" class="pesan-btn" data-item-id="${escapeHtml(item.id)}" data-item-name="${escapeHtml(item.name)}"
        data-item-detail="${escapeHtml(details)}"
        data-price-per-day="${item.price_per_day}" data-day2-rate="${item.day2_rate}" data-day3-rate="${item.day3_rate}"
        data-day4-rate="${item.day4_rate}" data-day5-rate="${item.day5_rate}" data-extra-day-rate="${item.extra_day_rate}"
        disabled
        style="width:100%;min-height:36px;padding:8px 10px;border-radius:10px;border:none;background:#2B4739;color:#fff;font-weight:700;font-size:0.75rem;cursor:pointer;">Pilih</button>
      <div class="qty-stepper-card" data-stepper="${escapeHtml(item.id)}" style="display:none;align-items:center;justify-content:space-between;gap:6px;border:1px solid #DBD5C1;border-radius:10px;padding:4px;background:#F1EEE2;">
        <button type="button" class="step-dec" data-item-id="${escapeHtml(item.id)}" style="width:30px;height:30px;border-radius:8px;border:1px solid #DBD5C1;background:#fff;font-weight:700;cursor:pointer;">&minus;</button>
        <span class="step-qty" data-qty="${escapeHtml(item.id)}" style="font-weight:700;color:#26302B;">0</span>
        <button type="button" class="step-inc" data-item-id="${escapeHtml(item.id)}" style="width:30px;height:30px;border-radius:8px;border:1px solid #DBD5C1;background:#fff;font-weight:700;cursor:pointer;">+</button>
      </div>
    </div>
  </div>
</div>`;
        })
        .join('\n')
    : `<p style="color:#6E6853;">Katalog alat belum ditambahkan.</p>`;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#2B4739" />

<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${escapeHtml(pageUrl)}" />

<meta property="og:type" content="website" />
<meta property="og:url" content="${escapeHtml(pageUrl)}" />
<meta property="og:site_name" content="Sewalog" />
<meta property="og:locale" content="id_ID" />
<meta property="og:title" content="${escapeHtml(shareTitleFull)}" />
<meta property="og:description" content="${escapeHtml(shareDescription)}" />
<meta property="og:image" content="${escapeHtml(ogImage)}" />
<meta property="og:image:secure_url" content="${escapeHtml(ogImage)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escapeHtml(page.business_name)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(shareTitleFull)}" />
<meta name="twitter:description" content="${escapeHtml(shareDescription)}" />
<meta name="twitter:image" content="${escapeHtml(ogImage)}" />
<link rel="image_src" href="${escapeHtml(ogImage)}" />

<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #F1EEE2; color: #26302B; font-family: system-ui, -apple-system, sans-serif; }
  /* Mobile-first: 640px cukup untuk HP (mayoritas kunjungan, lihat
     CLAUDE.md bagian 4), tapi tanpa breakpoint ini kolomnya tetap
     640px di layar tablet/desktop juga — jadi pulau sempit dengan
     banyak ruang kosong di kanan-kiri, bukan "responsive" beneran. */
  .wrap { max-width: 640px; margin: 0 auto; padding: 20px 16px 40px; }
  @media (min-width: 700px) { .wrap { max-width: 860px; } }
  @media (min-width: 1100px) { .wrap { max-width: 1100px; } }
  .items { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-top: 16px; }
  .cat-filter::-webkit-scrollbar { display: none; }
  .cat-filter { scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .cat-pill {
    flex-shrink: 0; padding: 6px 14px; border-radius: 999px; border: 1px solid #DBD5C1;
    background: #FBFAF4; color: #6E6853; font-size: 0.75rem; font-weight: 700; cursor: pointer;
    white-space: nowrap; font: inherit;
  }
  .cat-pill.active { background: #2B4739; border-color: #2B4739; color: #fff; }
  .zoomable { cursor: zoom-in; transition: opacity 0.15s; }
  .zoomable:hover, .zoomable:active { opacity: 0.85; }
  #lightbox {
    display: none; position: fixed; inset: 0; background: rgba(38,48,43,0.9); z-index: 50;
    align-items: center; justify-content: center; padding: 20px;
  }
  #lightbox img { max-width: 100%; max-height: 85vh; object-fit: contain; border-radius: 8px; }
  #lightbox-close {
    position: absolute; top: 16px; right: 16px; width: 36px; height: 36px; border-radius: 999px;
    border: none; background: #FBFAF4; color: #26302B; font-size: 1.1rem; font-weight: 700; cursor: pointer;
  }
  /* Kontrol cek-ketersediaan — dua input tanggal native lebar-instrinsik-
     nya sendiri-sendiri lumayan besar (format mm/dd/yyyy), jadi di HP
     sempit (di bawah 420px) ditumpuk vertikal + tombol full-width,
     bukan dipaksa muat sebaris (lihat komentar mobile-first di atas). */
  .avail-controls { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 4px; }
  .avail-field { display: flex; flex-direction: column; gap: 3px; font-size: 0.7rem; color: #6E6853; font-weight: 700; flex: 1 1 130px; min-width: 0; }
  .avail-field input {
    padding: 8px 10px; border-radius: 10px; border: 1px solid #DBD5C1; background: #fff;
    color: #26302B; font: inherit; width: 100%;
  }
  .avail-sep { color: #6E6853; font-size: 0.8rem; padding-bottom: 9px; }
  #avail-check { padding: 8px 14px; border-radius: 10px; border: none; background: #2B4739; color: #fff; font-weight: 700; font-size: 0.8rem; cursor: pointer; flex-shrink: 0; }
  .pesan-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 420px) {
    .avail-controls { flex-direction: column; align-items: stretch; }
    /* flex-basis 130px di .avail-field (atas) dimaksudkan sebagai
       lebar minimum buat layout sebaris — begitu flex-direction jadi
       column di sini, basis yang sama itu jadi dianggap TINGGI minimum
       tiap field (sumbu utama berubah ikut flex-direction), jadi tiap
       kotak tanggal melar ~130px dengan ruang kosong besar di bawahnya
       kalau tidak di-reset ke auto. */
    .avail-field { flex: 0 0 auto; }
    .avail-sep { display: none; }
    #avail-check { width: 100%; }
  }
  /* Rencana tahap 3: keranjang pesanan sederhana (vanilla JS, tanpa
     React — lihat larangan route React di komentar atas file ini).
     flex-direction column (bukan row seperti sebelumnya) — baris
     tombol tetap satu baris (#cart-bar-row), tapi panel rincian alat
     (poin "isi pesanan terlihat di bar", permintaan Andi) nampung di
     bawahnya kalau dibuka (HP saja, lihat #cart-bar-panel). */
  #cart-bar {
    display: none; flex-direction: column; position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
    background: #2B4739; color: #fff; padding: 12px 16px;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.15);
  }
  /* JS men-set style.display = 'flex' langsung saat keranjang terisi —
     aturan di atas cuma menyediakan default TERSEMBUNYI (none). */
  #cart-bar-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
  #cart-bar button { min-height: 44px; padding: 10px 16px; border-radius: 10px; border: none; background: #fff; color: #2B4739; font-weight: 700; font-size: 0.85rem; cursor: pointer; }
  /* Tombol ringkasan (kiri) — flex-shrink supaya TIDAK PERNAH mendorong
     keluar tombol "Lanjut pesan →" (flex-shrink:0, poin krusial dari
     permintaan Andi) kalau teksnya panjang (banyak alat berbeda di
     keranjang); overflow dipotong elipsis, bukan meluber/membungkus. */
  #cart-bar-toggle {
    flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px;
    background: none; border: none; color: #fff; font: inherit; text-align: left; padding: 0; cursor: pointer;
  }
  #cart-open-btn { flex-shrink: 0; }
  .cart-summary-desktop, .cart-summary-mobile {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Default mobile: tampilkan ringkasan singkat + panah, sembunyikan
     ringkasan panjang ala desktop (nama tiap alat). Dibalik di breakpoint
     768px (sama dengan breakpoint md Tailwind yang dipakai di tempat
     lain). Review -c1: panel rincian (#cart-bar-panel) SENGAJA selalu
     none di desktop lewat !important (bukan cuma lewat JS) — nama alat
     sudah terlihat langsung di ringkasan desktop, tidak perlu buka apa
     pun; defense-in-depth kalau breakpoint berubah sementara panel
     kebetulan lagi kebuka dari sesi mobile sebelumnya. */
  .cart-summary-mobile { display: block; }
  .cart-summary-desktop { display: none; }
  #cart-bar-panel { display: none; width: 100%; max-height: 40vh; overflow-y: auto; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.15); }
  @media (min-width: 768px) {
    .cart-summary-mobile { display: none; }
    .cart-summary-desktop { display: block; }
    #cart-bar-panel { display: none !important; }
  }
  .cart-panel-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.12); font-size: 0.8rem; }
  .cart-panel-row:last-child { border-bottom: none; }
  .cart-panel-name { font-weight: 700; }
  .cart-panel-detail { color: #DBD5C1; font-size: 0.7rem; margin-top: 1px; }
  .cart-panel-qty { color: #DBD5C1; flex-shrink: 0; }
  .cart-panel-subtotal { font-weight: 700; flex-shrink: 0; }
  .modal-overlay {
    display: none; position: fixed; inset: 0; background: rgba(38,48,43,0.55); z-index: 50;
    align-items: flex-end; justify-content: center; padding: 0;
  }
  .modal-panel {
    background: #F1EEE2; border-radius: 20px 20px 0 0; width: 100%; max-width: 480px;
    max-height: 88vh; overflow-y: auto; padding: 20px 16px 28px;
  }
  @media (min-width: 560px) {
    .modal-overlay { align-items: center; padding: 20px; }
    .modal-panel { border-radius: 20px; max-height: 85vh; }
  }
  .cart-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0; border-bottom: 1px solid #DBD5C1; }
  .cart-row-info { min-width: 0; }
  .cart-row-name { display: block; font-weight: 600; color: #26302B; }
  .cart-row-detail { display: block; font-size: 0.7rem; color: #6E6853; margin-top: 1px; }
  .cart-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
  .cart-row-subtotal { font-weight: 700; font-size: 0.8rem; color: #26302B; }
  .qty-stepper { display: flex; align-items: center; gap: 8px; }
  .qty-stepper button { width: 32px; height: 32px; border-radius: 8px; border: 1px solid #DBD5C1; background: #FBFAF4; font-weight: 700; cursor: pointer; }
  .field-label { display: block; font-size: 0.8rem; font-weight: 700; color: #6E6853; margin: 14px 0 4px; }
  .field-input {
    width: 100%; min-height: 44px; padding: 10px 12px; border-radius: 10px; border: 1px solid #DBD5C1;
    background: #fff; color: #26302B; font: inherit;
  }
  .pay-option { display: flex; align-items: center; gap: 8px; padding: 10px 0; min-height: 44px; }
  .pay-option input[type="radio"] { accent-color: #2B4739; width: 18px; height: 18px; }
  .honeypot-field { position: absolute; left: -9999px; top: -9999px; opacity: 0; height: 0; width: 0; overflow: hidden; }
  .submit-btn { width: 100%; min-height: 48px; margin-top: 16px; border-radius: 12px; border: none; background: #2B4739; color: #fff; font-weight: 700; font-size: 0.95rem; cursor: pointer; }
  .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .modal-close { background: none; border: none; color: #6E6853; font-size: 1rem; font-weight: 700; cursor: pointer; float: right; min-height: 44px; min-width: 44px; }
  .form-error { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: rgba(168,65,46,0.12); color: #A8412E; font-size: 0.85rem; display: none; }
  .cart-notice { margin-top: 6px; padding: 8px 10px; border-radius: 8px; background: rgba(166,92,42,0.12); color: #A65C2A; font-size: 0.75rem; display: none; }
</style>
</head>
<body>
<div class="wrap">
  <header style="padding-bottom:16px;border-bottom:1px solid #DBD5C1;margin-bottom:16px;">
    ${
      page.logo_url
        ? `<div style="display:flex;align-items:center;gap:12px;">
      <img src="${escapeHtml(page.logo_url)}" alt="" style="width:56px;height:56px;object-fit:contain;border-radius:12px;border:1px solid #DBD5C1;background:#fff;flex-shrink:0;" />
      <div style="min-width:0;">
        <p style="margin:0 0 4px;font-size:0.75rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#A65C2A;">Etalase Online</p>
        <h1 style="margin:0;font-size:1.5rem;color:#26302B;">${escapeHtml(page.business_name)}</h1>
        ${locationLabel ? `<p style="margin:4px 0 0;color:#6E6853;font-size:0.875rem;">${escapeHtml(locationLabel)}</p>` : ''}
      </div>
    </div>`
        : `<p style="margin:0 0 4px;font-size:0.75rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#A65C2A;">Etalase Online</p>
    <h1 style="margin:0;font-size:1.5rem;color:#26302B;">${escapeHtml(page.business_name)}</h1>
    ${locationLabel ? `<p style="margin:4px 0 0;color:#6E6853;font-size:0.875rem;">${escapeHtml(locationLabel)}</p>` : ''}`
    }
    ${page.description ? `<p style="margin:10px 0 0;color:#26302B;line-height:1.5;">${escapeHtml(page.description)}</p>` : ''}
    ${page.address ? `<p style="margin:10px 0 0;color:#6E6853;font-size:0.875rem;">📍 ${escapeHtml(page.address)}</p>` : ''}
    ${page.operating_hours ? `<p style="margin:4px 0 0;color:#6E6853;font-size:0.875rem;white-space:pre-line;">🕒 ${escapeHtml(page.operating_hours)}</p>` : ''}
    ${
      waUrl
        ? `<a href="${escapeHtml(waUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:14px;background:#2B4739;color:#fff;font-weight:700;font-size:0.875rem;padding:10px 18px;border-radius:12px;text-decoration:none;">Hubungi via WhatsApp</a>`
        : ''
    }
  </header>

  <section>
    <h2 style="font-size:1rem;margin:0 0 4px;color:#26302B;">Katalog Alat</h2>
    ${
      page.writable
        ? `<p style="margin:0 0 10px;font-size:0.8rem;color:#6E6853;">Pilih tanggal ambil &amp; kembali untuk melihat sisa unit dan harga total — atau langsung hubungi kami lewat WhatsApp.</p>
    <div class="avail-controls">
      <label class="avail-field">
        <span>Tanggal ambil</span>
        <input type="date" id="avail-start" />
      </label>
      <span class="avail-sep">s/d</span>
      <label class="avail-field">
        <span>Tanggal kembali</span>
        <input type="date" id="avail-end" />
      </label>
      <button type="button" id="avail-check">Cek Ketersediaan</button>
    </div>
    <p id="avail-status" style="margin:4px 0 0;font-size:0.75rem;color:#6E6853;min-height:1em;"></p>
    <div id="avail-chip" style="display:none;margin-top:6px;padding:6px 12px;border-radius:999px;background:#F1EEE2;border:1px solid #DBD5C1;font-size:0.8rem;font-weight:700;color:#26302B;width:fit-content;"></div>
    <p id="cart-date-notice" class="cart-notice"></p>`
        : // Review -c1 (rencana langganan): business hanya-baca — cek
          // ketersediaan+tombol pesan DIHILANGKAN SELURUHNYA (bukan
          // cuma tombol pesan), sesuai keputusan "Etalase publik: Tampil,
          // TANPA cek stok & tombol pesan". Katalog+harga tetap tampil.
          `<p style="margin:0 0 10px;font-size:0.8rem;color:#6E6853;">Hubungi kami langsung lewat WhatsApp untuk cek ketersediaan &amp; harga.</p>`
    }
    ${categoryFilterHtml}
    <div class="items">
      ${itemsHtml}
    </div>
  </section>

  ${
    // Syarat & Ketentuan (migration 047) — tampil TERLEPAS dari status
    // Pesanan Online (keputusan Andi), makanya dicek di sini (bagian
    // katalog, selalu dirender), bukan dikondisikan ke accept_online_orders.
    page.terms_content
      ? `<section style="margin-top:24px;">
    <h2 style="font-size:1rem;margin:0 0 4px;color:#26302B;">Syarat Sewa</h2>
    <p style="margin:0 0 10px;font-size:0.75rem;color:#6E6853;">Syarat ini dibuat oleh ${escapeHtml(page.business_name)} — Sewalog bukan pihak dalam perjanjian sewa ini.</p>
    <div style="background:#FBFAF4;border:1px solid #DBD5C1;border-radius:16px;padding:16px;white-space:pre-wrap;font-size:0.85rem;color:#26302B;">${escapeHtml(page.terms_content)}</div>
  </section>`
      : ''
  }

  <footer style="margin-top:32px;padding-top:16px;border-top:1px solid #DBD5C1;font-size:0.75rem;color:#6E6853;">
    Etalase online ini dibuat pakai <a href="https://sewalog.com" style="color:#2B4739;font-weight:600;">Sewalog</a>.
  </footer>
</div>

<div id="lightbox" onclick="closeZoom(event)">
  <button type="button" id="lightbox-close" onclick="closeZoom(event)" aria-label="Tutup">&times;</button>
  <img id="lightbox-img" src="" alt="" />
</div>

<div id="cart-bar">
  <div id="cart-bar-row">
    <button type="button" id="cart-bar-toggle">
      <span id="cart-summary-desktop" class="cart-summary-desktop"></span>
      <span id="cart-summary-mobile" class="cart-summary-mobile"></span>
      <span id="cart-toggle-arrow" class="cart-summary-mobile">&#9650;</span>
    </button>
    <button type="button" id="cart-open-btn">Lanjut pesan →</button>
  </div>
  <div id="cart-bar-panel"></div>
</div>

<div id="order-modal" class="modal-overlay">
  <div class="modal-panel">
    <button type="button" class="modal-close" id="order-modal-close" aria-label="Tutup">&times;</button>
    <h2 style="font-size:1.1rem;margin:0 0 4px;">Pesanan Anda</h2>
    <p id="cart-date-range" style="margin:0 0 10px;font-size:0.85rem;color:#6E6853;"></p>
    <div id="cart-items-list"></div>
    <p style="margin:10px 0 0;font-weight:700;">Total sewa: <span id="cart-total-price"></span></p>
    <p style="margin:2px 0 0;font-size:0.75rem;color:#6E6853;">Harga sesuai katalog. Total final tertera setelah rental mengonfirmasi pesanan.</p>

    <label class="field-label" for="order-name">Nama</label>
    <input type="text" id="order-name" class="field-input" maxlength="100" autocomplete="name" />

    <label class="field-label" for="order-phone">Nomor WhatsApp</label>
    <input type="tel" id="order-phone" class="field-input" placeholder="08xx atau +62xx" autocomplete="tel" />

    <label class="field-label" for="order-note">Catatan (opsional)</label>
    <textarea id="order-note" class="field-input" maxlength="500" rows="2"></textarea>

    <div class="honeypot-field" aria-hidden="true">
      <label for="order-website">Website</label>
      <input type="text" id="order-website" tabindex="-1" autocomplete="off" />
    </div>

    <label class="field-label">Cara bayar</label>
    <div id="order-payment-methods"></div>

    <div class="pay-option" id="order-terms-section" style="display:none;align-items:flex-start;gap:8px;margin-top:10px;">
      <input type="checkbox" id="order-terms-checkbox" style="margin-top:3px;" />
      <label for="order-terms-checkbox" style="margin:0;">
        Saya setuju dengan <a href="#" id="order-terms-link" style="color:#2B4739;font-weight:700;">Syarat &amp; Ketentuan</a> toko ini.
      </label>
    </div>

    <div class="form-error" id="order-form-error"></div>
    <button type="button" class="submit-btn" id="order-submit-btn">Kirim Pesanan</button>
  </div>
</div>

<div id="terms-modal" class="modal-overlay">
  <div class="modal-panel">
    <button type="button" class="modal-close" id="terms-modal-close" aria-label="Tutup">&times;</button>
    <h2 style="font-size:1.1rem;margin:0 0 4px;">Syarat &amp; Ketentuan</h2>
    <p style="margin:0 0 10px;font-size:0.75rem;color:#6E6853;">Syarat ini dibuat oleh ${escapeHtml(page.business_name)} — Sewalog bukan pihak dalam perjanjian sewa ini.</p>
    <div id="terms-modal-content" style="white-space:pre-wrap;font-size:0.85rem;color:#26302B;max-height:50vh;overflow-y:auto;"></div>
  </div>
</div>

<script>
// Global (BUKAN di dalam IIFE di bawah) karena dipanggil lewat atribut
// onclick inline di HTML (openZoom(this)/closeZoom(event)) — attribute
// handler cuma bisa menemukan identifier di scope global.
function openZoom(imgEl) {
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = document.getElementById('lightbox-img');
  lightboxImg.src = imgEl.src;
  lightboxImg.alt = imgEl.alt;
  lightbox.style.display = 'flex';
}
function closeZoom(e) {
  // Cuma tutup kalau klik di overlay/tombol close itu sendiri, bukan di
  // gambar yang lagi di-zoom (klik gambar tidak boleh ikut menutup).
  if (e.target.id !== 'lightbox' && e.target.id !== 'lightbox-close') return;
  document.getElementById('lightbox').style.display = 'none';
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') document.getElementById('lightbox').style.display = 'none';
});

(function () {
  // Filter kategori — murni show/hide sisi klien, semua item sudah ada
  // di HTML ini sejak awal (lihat komentar categoryFilterHtml di
  // renderPage()), tidak fetch ulang apapun.
  var catPills = document.querySelectorAll('.cat-pill');
  var itemCards = document.querySelectorAll('.item-card');
  catPills.forEach(function (pill) {
    pill.addEventListener('click', function () {
      catPills.forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      var cat = pill.getAttribute('data-cat');
      itemCards.forEach(function (card) {
        card.style.display = !cat || card.getAttribute('data-cat') === cat ? '' : 'none';
      });
    });
  });

  // Panah geser kiri/kanan buat baris pill kategori — sama persis
  // scrollBy() yang dipakai ScrollableRow.tsx di app (tab navbar).
  var catFilter = document.getElementById('cat-filter');
  var catScrollLeft = document.getElementById('cat-scroll-left');
  var catScrollRight = document.getElementById('cat-scroll-right');
  if (catFilter && catScrollLeft && catScrollRight) {
    catScrollLeft.addEventListener('click', function () {
      catFilter.scrollBy({ left: -150, behavior: 'smooth' });
    });
    catScrollRight.addEventListener('click', function () {
      catFilter.scrollBy({ left: 150, behavior: 'smooth' });
    });
  }

  // Review -c1 (rencana langganan): elemen avail-start dkk TIDAK ADA
  // sama sekali di HTML kalau !page.writable (lihat renderPage — seluruh
  // blok avail-controls dihilangkan server-side, bukan cuma disembunyikan
  // CSS) — bungkus SEMUA logic cek-ketersediaan+keranjang+form pesanan
  // di bawah ini dengan satu guard, supaya tidak crash null-reference
  // DAN sekaligus otomatis menonaktifkan form pesanan juga (dua-duanya
  // bergantung ke elemen yang sama).
  var startInput = document.getElementById('avail-start');
  if (startInput) {
  var slug = ${JSON.stringify(slug)};
  var endInput = document.getElementById('avail-end');
  var btn = document.getElementById('avail-check');
  var status = document.getElementById('avail-status');

  function addOneDayStr(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return localDateStr(d);
  }

  // Begitu tanggal ambil diisi, default-kan tanggal kembali — hari yang
  // sama kalau mode per hari kalender (kebanyakan pengunjung cuma mau
  // isi satu tanggal dulu buat cek sewa 1 hari), atau BESOKNYA kalau
  // per malam (ambil=kembali hari sama tidak valid di mode itu, sama
  // seperti Bilbo — lihat rentalDayMode, migration 049).
  startInput.addEventListener('change', function () {
    var minEnd = rentalDayMode === 'per_malam' ? addOneDayStr(startInput.value) : startInput.value;
    if (!endInput.value || endInput.value < minEnd) {
      endInput.value = minEnd;
    }
    endInput.min = minEnd;
  });

  // Threshold "sisa sedikit" ini SENGAJA disalin dari LOW_STOCK_RATIO di
  // backend/src/lib/availability.ts (0.2) — cuma dipakai buat warna badge
  // di sini, bukan sumber angka (angka remaining tetap dari server, jadi
  // tidak bisa dimanipulasi lewat sisi klien walau threshold-nya beda).
  function badgeFor(remaining) {
    if (remaining <= 0) return { text: 'Habis', color: '#A8412E', bg: 'rgba(168,65,46,0.12)' };
    var threshold = Math.max(1, Math.floor(remaining * 0.2));
    if (remaining <= threshold) return { text: 'Sisa ' + remaining + ' unit', color: '#A65C2A', bg: 'rgba(166,92,42,0.12)' };
    return { text: 'Sisa ' + remaining + ' unit', color: '#2B4739', bg: 'rgba(43,71,57,0.12)' };
  }

  function showChip(start, end) {
    var chip = document.getElementById('avail-chip');
    chip.textContent = formatDateRangeID(start, end) + ' · ' + rentalDaysCount(start, end) + ' hari';
    chip.style.display = 'inline-block';
  }
  function hideChip() {
    document.getElementById('avail-chip').style.display = 'none';
  }

  btn.addEventListener('click', function () {
    var start = startInput.value;
    var end = endInput.value || start;
    if (!start) {
      status.textContent = 'Pilih tanggal ambil dulu.';
      hideChip();
      return;
    }
    if (end < start) {
      status.textContent = 'Tanggal kembali tidak boleh sebelum tanggal ambil.';
      hideChip();
      return;
    }
    // Cara hitung durasi sewa (migration 049) — kalau toko ini pakai
    // per malam, tanggal ambil & kembali TIDAK BOLEH sama (beda dari
    // per hari kalender yang menganggap itu sewa 1 hari). Pesan jelas
    // di sini, bukan dibiarkan lolos ke submit lalu gagal dengan pesan
    // server mentah (instruksi review -c1: jangan gagal diam-diam).
    if (rentalDayMode === 'per_malam' && end === start) {
      status.textContent = 'Tanggal ambil dan kembali tidak boleh di hari yang sama — pilih tanggal kembali minimal besoknya.';
      hideChip();
      return;
    }
    // Paket minimal/maksimal hari (migration 054) — Pesanan Online
    // DIBLOKIR di luar paket, ditegakkan ulang server-side.
    var checkedDays = rentalDaysCount(start, end);
    if (minRentalDays != null && checkedDays < minRentalDays) {
      status.textContent = 'Minimal sewa ' + minRentalDays + ' hari.';
      hideChip();
      return;
    }
    if (maxRentalDays != null && checkedDays > maxRentalDays) {
      status.textContent = 'Maksimal sewa ' + maxRentalDays + ' hari untuk pesanan online.';
      hideChip();
      return;
    }
    status.textContent = 'Memuat ketersediaan...';
    hideChip();
    fetch(
      '/api/public/etalase/' + encodeURIComponent(slug) + '/availability?start_date=' + encodeURIComponent(start) +
        '&end_date=' + encodeURIComponent(end)
    )
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.items) {
          status.textContent = 'Gagal memuat ketersediaan.';
          return;
        }
        status.textContent = '';
        // setOrderDates() dulu SEBELUM loop di bawah — kalau tanggal
        // berubah dari pengecekan sebelumnya, ini mengosongkan keranjang.
        // Loop update kartu di bawah lalu jalan terhadap keranjang yang
        // SUDAH kosong, jadi setiap kartu otomatis balik ke tombol
        // "Tambah" (bukan stepper basi) — review -c1 (poin 2): reset
        // stepper per-kartu ikut reset tanggal, bukan cuma keranjang.
        setOrderDates(start, end);
        showChip(start, end);
        data.items.forEach(function (it) {
          var badgeEl = document.querySelector('[data-avail="' + it.id + '"]');
          if (badgeEl) {
            var b = badgeFor(it.remaining);
            badgeEl.textContent = b.text;
            badgeEl.style.color = b.color;
            badgeEl.style.background = b.bg;
            badgeEl.style.display = 'inline-block';
          }
          // Review -c1 (poin 3): total harga per periode & badge stok
          // SELALU dihitung/ditampilkan di sini terlepas dari
          // orderingEnabled — berguna buat pelanggan walau toko belum
          // aktifkan Pesanan Online (cuma tombol/stepper pesan yang
          // digerbangi orderingEnabled, lihat updateCardAction()).
          var totalEl = document.querySelector('[data-total="' + it.id + '"]');
          var rates = getItemRates(it.id);
          if (totalEl && rates) {
            totalEl.textContent = 'Total ' + rentalDaysCount(start, end) + ' hari: ' + formatIDRClient(computeItemRentalPrice(rates, rentalDaysCount(start, end)));
            totalEl.style.display = 'block';
          }
          updateCardAction(it.id, it.remaining);
        });
      })
      .catch(function () {
        status.textContent = 'Gagal memuat ketersediaan.';
        hideChip();
      });
  });

  // ------------------------------------------------------------
  // Rencana tahap 3: Pesanan Online dari Etalase (form + keranjang)
  // ------------------------------------------------------------
  // min date picker = BESOK menurut zona RENTAL (migration 053), dihitung
  // server saat render — pelanggan bisa membuka dari zona lain, dan
  // validasi server (bookingRequests.ts) juga memakai zona rental.
  function localDateStr(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  var minDateStr = ${JSON.stringify(addDays(todayInTz(page.timezone), 1))};
  startInput.min = minDateStr;
  endInput.min = minDateStr;

  var orderingEnabled = false;
  var paymentMethods = { transfer: false, qris: false, cash: false };
  // Cara hitung durasi sewa (migration 049) — default aman SEBELUM
  // ordering-config selesai dimuat adalah 'per_hari_kalender' (perilaku
  // lama, paling longgar — tidak menolak apa pun sebelum nilai
  // sebenarnya diketahui).
  var rentalDayMode = 'per_hari_kalender';
  // Paket minimal/maksimal hari (migration 054) — null = tanpa batas.
  var minRentalDays = null;
  var maxRentalDays = null;
  var cart = []; // [{item_id, name, quantity, remaining, rates: {...}}]
  var orderDates = { start: null, end: null };
  // Syarat & Ketentuan (migration 047/048) — diisi ulang tiap fetch
  // ordering-config (sekali saat load halaman, dan sekali lagi kalau
  // create_booking_request menolak karena basi, lihat loadOrderingConfig
  // di bawah), bukan sekali-jadi saat load — supaya selalu fresh.
  var termsContent = null;
  var termsVersionId = null;

  function loadOrderingConfig() {
    return fetch('/api/public/etalase/' + encodeURIComponent(slug) + '/ordering-config')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        orderingEnabled = !!(cfg && cfg.enabled);
        paymentMethods = (cfg && cfg.payment_methods) || paymentMethods;
        rentalDayMode = (cfg && cfg.rental_day_mode) || 'per_hari_kalender';
        minRentalDays = (cfg && cfg.min_rental_days) || null;
        maxRentalDays = (cfg && cfg.max_rental_days) || null;
        termsContent = (cfg && cfg.terms_content) || null;
        termsVersionId = (cfg && cfg.terms_version_id) || null;
        var termsSection = document.getElementById('order-terms-section');
        if (termsSection) termsSection.style.display = termsContent ? 'flex' : 'none';
        // Review -c1 (poin 3): kontainer tombol/stepper pesan per-kartu
        // cuma ditampilkan kalau Pesanan Online aktif — badge stok & total
        // harga (di luar kontainer ini) TETAP tampil terlepas dari ini.
        document.querySelectorAll('[data-action]').forEach(function (el) {
          el.style.display = orderingEnabled ? 'block' : 'none';
        });
      })
      .catch(function () { orderingEnabled = false; });
  }
  loadOrderingConfig();

  var termsModal = document.getElementById('terms-modal');
  document.getElementById('order-terms-link').addEventListener('click', function (e) {
    e.preventDefault();
    document.getElementById('terms-modal-content').textContent = termsContent || '';
    termsModal.style.display = 'flex';
  });
  document.getElementById('terms-modal-close').addEventListener('click', function () {
    termsModal.style.display = 'none';
  });

  // Dipanggil tiap kali hasil cek ketersediaan baru datang (lihat
  // pemanggilan di atas). Kalau tanggal yang baru dicek BEDA dari
  // tanggal yang sedang dipakai keranjang, keranjang dikosongkan +
  // notice — keranjang terikat ke SATU rentang tanggal, bukan
  // multi-tanggal (rencana tahap 3 poin 3).
  function setOrderDates(start, end) {
    if (cart.length > 0 && (orderDates.start !== start || orderDates.end !== end)) {
      cart = [];
      renderCart();
      var notice = document.getElementById('cart-date-notice');
      if (notice) {
        notice.style.display = 'block';
        notice.textContent = 'Keranjang dikosongkan karena tanggal diubah — pilih ulang alat untuk tanggal baru.';
        setTimeout(function () { notice.style.display = 'none'; }, 4000);
      }
    }
    orderDates = { start: start, end: end };
  }

  // Cara hitung durasi sewa (migration 049) — HARUS sama persis dengan
  // rentalDuration() backend (backend/src/lib/dates.ts) yang dipakai
  // bookingRequests.ts menghitung ulang p_estimated_price saat submit,
  // supaya perkiraan yang dilihat pelanggan di sini tidak pernah beda
  // dari yang benar-benar tersimpan di server.
  function rentalDaysCount(start, end) {
    var nights = Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000);
    return rentalDayMode === 'per_malam' ? nights : nights + 1;
  }

  // Review -c1: rentang tanggal di header keranjang sebelumnya tampil
  // mentah ISO ("2026-11-03 – 2026-11-04"), kurang ramah dibaca pelanggan
  // awam. Format pendek ala Indonesia: "3–4 Nov 2026" kalau bulan+tahun
  // sama, "30 Nov – 2 Des 2026" kalau beda bulan (tahun sama), atau
  // "30 Des 2026 – 2 Jan 2027" kalau beda tahun — tanggal tunggal cuma
  // "3 November 2026" (dieja penuh, konsisten dengan formatDateID() di
  // halaman status).
  var MONTH_ABBR_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  function formatDateRangeID(startStr, endStr) {
    var s = new Date(startStr + 'T00:00:00');
    var e = new Date(endStr + 'T00:00:00');
    if (startStr === endStr) {
      return s.getDate() + ' ' + s.toLocaleDateString('id-ID', { month: 'long' }) + ' ' + s.getFullYear();
    }
    var sameYear = s.getFullYear() === e.getFullYear();
    var sameMonth = sameYear && s.getMonth() === e.getMonth();
    if (sameMonth) {
      return s.getDate() + '–' + e.getDate() + ' ' + MONTH_ABBR_ID[e.getMonth()] + ' ' + e.getFullYear();
    }
    var startLabel = s.getDate() + ' ' + MONTH_ABBR_ID[s.getMonth()] + (sameYear ? '' : ' ' + s.getFullYear());
    var endLabel = e.getDate() + ' ' + MONTH_ABBR_ID[e.getMonth()] + ' ' + e.getFullYear();
    return startLabel + ' – ' + endLabel;
  }

  // Salinan vanilla-JS dari computeItemRentalPrice() (frontend/src/utils/
  // formatters.ts, backend/src/lib/pricing.ts, scripts/seed-demo.mjs) —
  // runtime KEEMPAT, pola yang sama (tiap runtime punya salinannya
  // sendiri, lihat CLAUDE.md bagian 6 soal tiga runtime yang ada
  // sebelumnya). Hasil di sini MURNI tampilan perkiraan — harga final
  // tetap dihitung server (POST /api/public/booking-requests sendiri
  // juga menghitung ulang dari harga katalog, tidak percaya nilai ini).
  function computeItemRentalPrice(rates, days) {
    if (days <= 0) return 0;
    var perDay = [rates.price_per_day, rates.day2_rate, rates.day3_rate, rates.day4_rate, rates.day5_rate];
    var total = 0;
    for (var d = 1; d <= Math.min(days, 5); d++) total += perDay[d - 1];
    if (days > 5) total += (days - 5) * rates.extra_day_rate;
    return total;
  }

  function formatIDRClient(n) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
  }

  // Tarif per-alat dibaca dari dataset tombol pesan-btn (sudah di-render
  // SSR, di-escape lewat atribut HTML biasa) — satu sumber dipakai baik
  // buat isi keranjang (pesan-btn click) maupun hitung "Total X hari" di
  // kartu (avail-check), supaya tidak ada salinan ketiga nilai yang sama.
  function getItemRates(itemId) {
    var btnEl = document.querySelector('.pesan-btn[data-item-id="' + itemId + '"]');
    if (!btnEl) return null;
    return {
      price_per_day: Number(btnEl.dataset.pricePerDay),
      day2_rate: Number(btnEl.dataset.day2Rate),
      day3_rate: Number(btnEl.dataset.day3Rate),
      day4_rate: Number(btnEl.dataset.day4Rate),
      day5_rate: Number(btnEl.dataset.day5Rate),
      extra_day_rate: Number(btnEl.dataset.extraDayRate),
    };
  }

  // Satu fungsi dipanggil tiap kali kartu suatu alat perlu disinkronkan ke
  // state terbaru (hasil cek ketersediaan baru, atau keranjang berubah
  // lewat +/-/klik tombol) — satu-satunya tempat yang memutuskan kartu ini
  // menampilkan tombol "Tambah"/"Habis" atau stepper, supaya kartu dan
  // modal keranjang tidak pernah berbeda cerita (review -c1 poin 2).
  function updateCardAction(itemId, remainingOverride) {
    var actionEl = document.querySelector('[data-action="' + itemId + '"]');
    if (!actionEl) return;
    if (typeof remainingOverride === 'number') actionEl.dataset.remaining = String(remainingOverride);
    var remaining = Number(actionEl.dataset.remaining || 0);
    actionEl.style.display = orderingEnabled ? 'block' : 'none';
    if (!orderingEnabled) return;

    var btnEl = actionEl.querySelector('.pesan-btn');
    var stepperEl = actionEl.querySelector('.qty-stepper-card');
    var cartEntry = cart.find(function (c) { return c.item_id === itemId; });

    if (cartEntry && cartEntry.quantity > 0) {
      btnEl.style.display = 'none';
      stepperEl.style.display = 'flex';
      stepperEl.querySelector('.step-qty').textContent = String(cartEntry.quantity);
      stepperEl.querySelector('.step-inc').disabled = cartEntry.quantity >= remaining;
      return;
    }

    stepperEl.style.display = 'none';
    btnEl.style.display = 'block';
    if (remaining <= 0) {
      btnEl.disabled = true;
      btnEl.textContent = 'Habis';
    } else {
      btnEl.disabled = false;
      btnEl.textContent = 'Tambah';
    }
  }

  var cartBar = document.getElementById('cart-bar');
  var cartSummaryDesktop = document.getElementById('cart-summary-desktop');
  var cartSummaryMobile = document.getElementById('cart-summary-mobile');
  var cartToggleArrow = document.getElementById('cart-toggle-arrow');
  var cartBarPanel = document.getElementById('cart-bar-panel');
  var wrapEl = document.querySelector('.wrap');
  var orderModal = document.getElementById('order-modal');
  var MOBILE_BREAKPOINT = 768; // sama dengan breakpoint md di CSS #cart-bar-panel di atas.

  function cartTotalPrice() {
    var days = orderDates.start && orderDates.end ? rentalDaysCount(orderDates.start, orderDates.end) : 1;
    return cart.reduce(function (sum, c) { return sum + computeItemRentalPrice(c.rates, days) * c.quantity; }, 0);
  }

  // Tinggi bar (+panel kalau terbuka) berubah-ubah — padding bawah
  // halaman disesuaikan ke tinggi SUNGGUHAN tiap kali, bukan angka tetap
  // (permintaan Andi: "Page bottom padding needs to adjust to the
  // bar/panel's actual height"), supaya baris kartu terakhir & footer
  // tidak pernah ketutupan di kombinasi state manapun (bar tertutup,
  // bar ringkas, bar+panel terbuka).
  function syncCartBarPadding() {
    if (cartBar.style.display === 'flex') {
      wrapEl.style.paddingBottom = (cartBar.offsetHeight + 16) + 'px';
    } else {
      wrapEl.style.paddingBottom = '';
    }
  }

  function closeCartPanel() {
    cartBarPanel.style.display = 'none';
    cartToggleArrow.textContent = '▲'; // ▲ tertutup — bisa dibuka
    syncCartBarPadding();
  }

  // Panel rincian isi keranjang (poin Andi: nama+varian, ×qty, subtotal
  // per alat) — HP saja (lihat guard innerWidth di bawah dan CSS
  // #cart-bar-panel yang di-none-kan paksa di >=768px). Dibangun lewat
  // createElement/textContent, bukan innerHTML dengan nilai dari data
  // (nama/varian alat bisa diisi bebas oleh vendor) — pola sama seperti
  // perbaikan XSS keranjang modal sebelumnya.
  function renderCartPanel(days) {
    cartBarPanel.innerHTML = '';
    cart.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'cart-panel-row';

      var left = document.createElement('div');
      var nameEl = document.createElement('div');
      nameEl.className = 'cart-panel-name';
      nameEl.textContent = c.name;
      left.appendChild(nameEl);
      if (c.detail) {
        var detailEl = document.createElement('div');
        detailEl.className = 'cart-panel-detail';
        detailEl.textContent = c.detail;
        left.appendChild(detailEl);
      }
      row.appendChild(left);

      var qtyEl = document.createElement('span');
      qtyEl.className = 'cart-panel-qty';
      qtyEl.textContent = '×' + c.quantity;
      row.appendChild(qtyEl);

      var subtotalEl = document.createElement('span');
      subtotalEl.className = 'cart-panel-subtotal';
      subtotalEl.textContent = formatIDRClient(computeItemRentalPrice(c.rates, days) * c.quantity);
      row.appendChild(subtotalEl);

      cartBarPanel.appendChild(row);
    });
  }

  function renderCart() {
    var totalQty = cart.reduce(function (sum, c) { return sum + c.quantity; }, 0);
    if (totalQty > 0) {
      cartBar.style.display = 'flex';
      var totalLabel = totalQty + ' alat · ' + formatIDRClient(cartTotalPrice());
      // Ringkasan desktop: nama tiap alat (maks 3, sisanya "+N lainnya")
      // + ringkasan total — permintaan Andi, beda dari HP yang cuma
      // ringkas (nama-nama alat ada di panel yang baru dibuka, bukan di
      // bar). CSS yang memutuskan mana yang TAMPIL di breakpoint mana
      // (lihat .cart-summary-desktop/.cart-summary-mobile) — dua-duanya
      // selalu diisi, supaya tidak ada teks basi kalau viewport di-resize.
      // Nama alat bisa duplikat (dua varian "Carrier 60L" berbeda) —
      // begitu nama yang sama muncul lebih dari sekali, tempelkan
      // varian/ukuran/warnanya di kurung supaya tetap bisa dibedakan di
      // ringkasan desktop (panel HP sudah selalu tampilkan varian di
      // baris sendiri, jadi ini cuma masalah di ringkasan satu-baris
      // ini). Alat dengan nama unik TETAP tanpa kurung, tidak perlu.
      var nameCounts = {};
      cart.forEach(function (c) { nameCounts[c.name] = (nameCounts[c.name] || 0) + 1; });
      var shown = cart.slice(0, 3).map(function (c) {
        var label = c.name;
        if (nameCounts[c.name] > 1 && c.detail) label += ' (' + c.detail + ')';
        return label + ' ×' + c.quantity;
      }).join(', ');
      var extra = cart.length > 3 ? ', +' + (cart.length - 3) + ' lainnya' : '';
      cartSummaryDesktop.textContent = shown + extra + ' · ' + totalLabel;
      cartSummaryMobile.textContent = totalLabel;
      var days = orderDates.start && orderDates.end ? rentalDaysCount(orderDates.start, orderDates.end) : 1;
      renderCartPanel(days);
      if (cartBarPanel.style.display !== 'block') cartToggleArrow.textContent = '▲';
    } else {
      cartBar.style.display = 'none';
      closeCartPanel();
    }
    syncCartBarPadding();

    // Review -c1 (poin 5): tampilkan rentang tanggal di atas daftar
    // alat di modal, supaya pelanggan bisa cek ulang tanggalnya benar
    // SEBELUM kirim — bukan cuma tersirat dari langkah cek ketersediaan
    // sebelumnya yang sudah tertutup modal ini.
    var dateRangeEl = document.getElementById('cart-date-range');
    if (orderDates.start && orderDates.end) {
      var daysForLabel = rentalDaysCount(orderDates.start, orderDates.end);
      var dateLabel = formatDateRangeID(orderDates.start, orderDates.end);
      dateRangeEl.textContent = dateLabel + ' · ' + daysForLabel + ' hari';
    } else {
      dateRangeEl.textContent = '';
    }

    var listEl = document.getElementById('cart-items-list');
    var totalPrice = 0;
    var days = orderDates.start && orderDates.end ? rentalDaysCount(orderDates.start, orderDates.end) : 1;

    // Review -c1 (security): c.name datang dari btn.dataset.itemName, yang
    // SUDAH DI-DECODE browser dari atribut HTML yang di-escape SSR — kalau
    // dibangun lewat string concat + innerHTML seperti sebelumnya, nama
    // alat berisi markup (mis. diketik vendor sendiri, atau lolos dari
    // Impor Excel) akan DIEKSEKUSI ULANG sebagai HTML/script di halaman
    // ini (stored XSS lintas-tenant, dijalankan di domain Sewalog sendiri
    // ke pelanggan vendor lain). Dibangun lewat createElement+textContent
    // di sini — textContent TIDAK PERNAH mem-parsing isinya sebagai HTML,
    // apa pun isinya (termasuk "<img onerror=...>") tampil sebagai teks
    // literal apa adanya. Listener qty +/- juga dipasang LANGSUNG ke
    // tombol yang baru dibuat (closure atas idx), bukan event delegation
    // lewat data-idx seperti sebelumnya — sama amannya, cuma lebih
    // sederhana sekarang sudah tidak ada string HTML yang disusun manual.
    listEl.innerHTML = '';
    cart.forEach(function (c, idx) {
      var subtotal = computeItemRentalPrice(c.rates, days) * c.quantity;
      totalPrice += subtotal;

      var row = document.createElement('div');
      row.className = 'cart-row';

      // Review -c1 (3 Nov 2026): dua "Carrier 60L" beda varian di modal
      // ini sebelumnya sama-sama cuma tampil "Carrier 60L" tanpa cara
      // bedakan — sama persis masalah yang sudah diperbaiki di ringkasan
      // desktop cart-bar. Di sini SELALU tampilkan varian (bukan cuma
      // saat nama duplikat) karena ruang per-baris cukup lega, konsisten
      // dengan panel rincian HP yang juga selalu menampilkannya.
      var info = document.createElement('div');
      info.className = 'cart-row-info';
      var nameSpan = document.createElement('span');
      nameSpan.className = 'cart-row-name';
      nameSpan.textContent = c.name;
      info.appendChild(nameSpan);
      if (c.detail) {
        var detailSpan = document.createElement('span');
        detailSpan.className = 'cart-row-detail';
        detailSpan.textContent = c.detail;
        info.appendChild(detailSpan);
      }
      row.appendChild(info);

      var right = document.createElement('div');
      right.className = 'cart-row-right';

      var stepper = document.createElement('div');
      stepper.className = 'qty-stepper';

      var decBtn = document.createElement('button');
      decBtn.type = 'button';
      decBtn.textContent = '−';
      decBtn.addEventListener('click', function () {
        var itemId = cart[idx].item_id;
        cart[idx].quantity--;
        if (cart[idx].quantity <= 0) cart.splice(idx, 1);
        renderCart();
        updateCardAction(itemId);
      });
      stepper.appendChild(decBtn);

      var qtySpan = document.createElement('span');
      qtySpan.textContent = String(c.quantity);
      stepper.appendChild(qtySpan);

      var incBtn = document.createElement('button');
      incBtn.type = 'button';
      incBtn.textContent = '+';
      incBtn.addEventListener('click', function () {
        var itemId = cart[idx].item_id;
        if (cart[idx].quantity < cart[idx].remaining) cart[idx].quantity++;
        renderCart();
        updateCardAction(itemId);
      });
      stepper.appendChild(incBtn);
      right.appendChild(stepper);

      var subtotalSpan = document.createElement('span');
      subtotalSpan.className = 'cart-row-subtotal';
      subtotalSpan.textContent = formatIDRClient(subtotal);
      right.appendChild(subtotalSpan);

      row.appendChild(right);
      listEl.appendChild(row);
    });

    document.getElementById('cart-total-price').textContent = formatIDRClient(totalPrice);
  }

  document.querySelectorAll('.pesan-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      var itemId = btn.dataset.itemId;
      var actionEl = document.querySelector('[data-action="' + itemId + '"]');
      var remaining = Number(actionEl ? actionEl.dataset.remaining : 0) || 0;
      var existing = cart.find(function (c) { return c.item_id === itemId; });
      if (existing) {
        if (existing.quantity < remaining) existing.quantity++;
      } else {
        cart.push({ item_id: itemId, name: btn.dataset.itemName, detail: btn.dataset.itemDetail || '', quantity: 1, remaining: remaining, rates: getItemRates(itemId) });
      }
      renderCart();
      updateCardAction(itemId);
    });
  });

  // Stepper langsung di kartu (poin 1) — elemen .step-dec/.step-inc sudah
  // di-render SSR (hidden) di setiap kartu, dipasangi listener sekali di
  // sini (bukan dibuat lewat innerHTML) sama seperti .pesan-btn di atas.
  document.querySelectorAll('.step-inc').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var itemId = btn.dataset.itemId;
      var entry = cart.find(function (c) { return c.item_id === itemId; });
      if (entry && entry.quantity < entry.remaining) entry.quantity++;
      renderCart();
      updateCardAction(itemId);
    });
  });
  document.querySelectorAll('.step-dec').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var itemId = btn.dataset.itemId;
      var idx = cart.findIndex(function (c) { return c.item_id === itemId; });
      if (idx === -1) return;
      cart[idx].quantity--;
      if (cart[idx].quantity <= 0) cart.splice(idx, 1);
      renderCart();
      updateCardAction(itemId);
    });
  });

  function renderPaymentMethods() {
    var container = document.getElementById('order-payment-methods');
    var options = [];
    if (paymentMethods.transfer) options.push({ value: 'transfer', label: 'Transfer Bank' });
    if (paymentMethods.qris) options.push({ value: 'qris', label: 'QRIS' });
    if (paymentMethods.cash) options.push({ value: 'cash', label: 'Tunai saat ambil' });
    container.innerHTML = options.map(function (opt, i) {
      return '<label class="pay-option"><input type="radio" name="order-payment-method" value="' + opt.value + '"' + (i === 0 ? ' checked' : '') + ' /> ' + opt.label + '</label>';
    }).join('');
  }

  document.getElementById('cart-open-btn').addEventListener('click', function () {
    renderPaymentMethods();
    renderCart();
    orderModal.style.display = 'flex';
  });

  // Tap bagian kiri bar (ringkasan) buka/tutup panel rincian — HP saja.
  // Di desktop ini no-op (nama alat sudah kelihatan langsung di
  // ringkasan, lihat renderCart()) — guard innerWidth, bukan cuma andalan
  // CSS, supaya state JS (display panel) tidak pernah "terbuka" diam-diam
  // kalau breakpoint berubah (lihat listener resize di bawah juga).
  document.getElementById('cart-bar-toggle').addEventListener('click', function () {
    if (window.innerWidth >= MOBILE_BREAKPOINT) return;
    if (cartBarPanel.style.display === 'block') {
      closeCartPanel();
    } else {
      cartBarPanel.style.display = 'block';
      cartToggleArrow.textContent = '▼'; // ▼ terbuka — tap lagi untuk tutup
      syncCartBarPadding();
    }
  });

  // Resize lintas breakpoint (rotasi HP/tablet, window di-resize) —
  // tutup paksa panel kalau sudah masuk ukuran desktop (CSS sendiri
  // sudah menyembunyikannya paksa, ini cuma supaya tap balik ke ukuran
  // HP tidak mewarisi panah "▼ terbuka" yang sebenarnya sudah force-
  // closed oleh CSS) dan selalu sinkronkan ulang padding (tinggi bar
  // beda antara layout mobile/desktop).
  window.addEventListener('resize', function () {
    if (window.innerWidth >= MOBILE_BREAKPOINT && cartBarPanel.style.display === 'block') {
      closeCartPanel();
    } else {
      syncCartBarPadding();
    }
  });
  document.getElementById('order-modal-close').addEventListener('click', function () {
    orderModal.style.display = 'none';
  });

  var PHONE_RE_CLIENT = /^(\\+?62|0)8[0-9]{8,12}$/;

  document.getElementById('order-submit-btn').addEventListener('click', function () {
    var errorEl = document.getElementById('order-form-error');
    errorEl.style.display = 'none';
    var name = document.getElementById('order-name').value.trim();
    var phone = document.getElementById('order-phone').value.trim();
    var note = document.getElementById('order-note').value.trim();
    var paymentMethodInput = document.querySelector('input[name="order-payment-method"]:checked');

    if (!name) { errorEl.textContent = 'Nama wajib diisi.'; errorEl.style.display = 'block'; return; }
    if (!PHONE_RE_CLIENT.test(phone.replace(/[\\s-]/g, ''))) {
      errorEl.textContent = 'Nomor WhatsApp tidak valid. Pakai format 08xx atau +62xx.';
      errorEl.style.display = 'block';
      return;
    }
    if (!orderDates.start || !orderDates.end) {
      errorEl.textContent = 'Cek ketersediaan tanggal dulu sebelum memesan.';
      errorEl.style.display = 'block';
      return;
    }
    if (cart.length === 0) {
      errorEl.textContent = 'Keranjang masih kosong.';
      errorEl.style.display = 'block';
      return;
    }
    if (!paymentMethodInput) {
      errorEl.textContent = 'Pilih cara bayar dulu.';
      errorEl.style.display = 'block';
      return;
    }
    var termsCheckbox = document.getElementById('order-terms-checkbox');
    if (termsContent && !termsCheckbox.checked) {
      errorEl.textContent = 'Centang persetujuan Syarat & Ketentuan dulu sebelum kirim pesanan.';
      errorEl.style.display = 'block';
      return;
    }

    var submitBtn = document.getElementById('order-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Mengirim...';

    fetch('/api/public/booking-requests/' + encodeURIComponent(slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: name,
        customer_phone: phone,
        note: note || null,
        start_date: orderDates.start,
        end_date: orderDates.end,
        items: cart.map(function (c) { return { item_id: c.item_id, quantity: c.quantity }; }),
        payment_method: paymentMethodInput.value,
        terms_version_id: termsContent ? termsVersionId : null,
        website: document.getElementById('order-website').value, // honeypot
      }),
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Pesanan';
        if (!res.ok || !res.body.token) {
          // stale_terms (migration 047/048): vendor ubah syaratnya di
          // antara halaman dibuka dan pelanggan submit — muat ulang teks
          // terbaru + minta centang lagi, BUKAN cuma tampilkan error dan
          // diam, supaya pelanggan tahu kenapa dan bisa langsung lanjut.
          if (res.body && res.body.stale_terms) {
            termsCheckbox.checked = false;
            loadOrderingConfig();
          }
          errorEl.textContent = (res.body && res.body.error) || 'Gagal mengirim pesanan. Coba lagi.';
          errorEl.style.display = 'block';
          return;
        }
        window.location.href = '/pesanan/' + res.body.token;
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Pesanan';
        errorEl.textContent = 'Gagal mengirim pesanan. Periksa koneksi internet Anda.';
        errorEl.style.display = 'block';
      });
  });
  } // end if (startInput)
})();
</script>
</body>
</html>`;
}

export default router;
