import { Router } from 'express';
import { createAnonClient } from '../lib/supabaseClient.js';
import { escapeHtml } from '../lib/html.js';
import { buildWhatsAppUrl } from '../lib/whatsapp.js';

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
  operating_hours: string | null;
  public_phone: string | null;
  writable: boolean;
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
  const { data, error } = await supabase.rpc('get_public_page', { p_slug: slug });

  if (error || !data) {
    res.status(404).type('html').send(renderNotFound());
    return;
  }

  res.type('html').send(renderPage(data as PublicPageData, slug, req));
}

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
  };
  res.json({
    enabled: true,
    payment_methods: {
      transfer: page.pay_transfer_enabled,
      qris: page.pay_qris_enabled,
      cash: page.pay_cash_enabled,
    },
  });
});

type BookingRequestStatus = {
  status: 'menunggu' | 'dikonfirmasi' | 'ditolak' | 'kedaluwarsa';
  customer_name: string;
  start_date: string;
  end_date: string;
  estimated_price: number;
  payment_method: 'transfer' | 'qris' | 'cash' | null;
  dp_amount: number | null;
  rejection_reason: string | null;
  business_name: string;
  logo_url: string | null;
  public_phone: string | null;
  slug: string | null;
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

  res.type('html').send(renderStatusPage(data as BookingRequestStatus, req));
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

// Review -c1 (tahap 3, poin 1): OG tags di halaman ini SENGAJA generik
// (cuma nama toko) — link ini dibagikan lewat WA, jadi preview-nya
// terlihat oleh SIAPA PUN yang menerima forward link itu. Nama
// pelanggan/alat/harga TIDAK PERNAH masuk og:title/og:description di
// sini, beda dari halaman Etalase (/toko/{slug}) yang memang untuk
// katalog publik.
function renderStatusPage(data: BookingRequestStatus, req: import('express').Request): string {
  // reuse resolvePageUrl() (dipakai juga di renderPage Etalase) supaya
  // link "Lihat katalog" ini benar di kedua domain (toko.sewalog.com vs
  // /toko/{slug} fallback) — bukan hardcode "/toko/" di sini.
  const catalogUrl = data.slug ? resolvePageUrl(req, data.slug) : null;
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
  let waButtonLabel = `Kirim pesanan ke WA ${data.business_name}`;
  let waBookingText = `Halo ${data.business_name}, saya sudah kirim pesanan online untuk ${data.start_date} s/d ${data.end_date}.`;
  if (data.status === 'dikonfirmasi' && data.payment_snapshot) {
    const amount = data.payment_snapshot.dp_mode === 'none' ? data.payment_snapshot.total_final : data.payment_snapshot.dp_amount_computed;
    waButtonLabel = `Kirim bukti bayar ke WA ${data.business_name}`;
    waBookingText = `Halo ${data.business_name}, ini bukti bayar ${formatIDR(amount)} untuk pesanan saya (${data.start_date} s/d ${data.end_date}).`;
  } else if (data.status === 'ditolak' || data.status === 'kedaluwarsa') {
    waButtonLabel = `Chat ${data.business_name} di WA`;
  }
  const waUrl = data.public_phone ? buildWhatsAppUrl(data.public_phone, waBookingText) : null;

  const waButtonHtml = waUrl
    ? `<a href="${escapeHtml(waUrl)}" target="_blank" rel="noopener noreferrer nofollow" style="display:block;text-align:center;margin-top:16px;background:#2B4739;color:#fff;font-weight:700;font-size:0.9rem;padding:13px 18px;border-radius:12px;text-decoration:none;min-height:44px;">${escapeHtml(waButtonLabel)}</a>`
    : '';

  let bodyExtraHtml = '';

  if (data.status === 'menunggu') {
    // Review -c1 (poin 4): jangan dobel kalau vendor sudah isi pesan
    // konfirmasi custom sendiri — default cuma tampil kalau itu kosong.
    bodyExtraHtml = data.confirmation_message
      ? ''
      : `<p style="margin:10px 0 0;font-size:0.85rem;color:#6E6853;">Vendor biasanya membalas dalam 24 jam. Kalau mendesak, langsung chat WA.</p>`;
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
    <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:0.75rem;font-weight:700;color:${label.color};background:${label.bg};">${label.text}</span>
    <p style="margin:12px 0 0;font-size:0.8rem;color:#6E6853;">Pemesan</p>
    <p style="margin:2px 0 0;font-weight:700;">${escapeHtml(data.customer_name)}</p>
    <p style="margin:10px 0 0;font-size:0.8rem;color:#6E6853;">Tanggal sewa</p>
    <p style="margin:2px 0 0;font-weight:700;">${escapeHtml(formatDateID(data.start_date))} s/d ${escapeHtml(formatDateID(data.end_date))}</p>
    <p style="margin:10px 0 0;font-size:0.8rem;color:#6E6853;">Alat</p>
    <ul style="margin:4px 0 0;padding-left:18px;">${itemsListHtml}</ul>
    ${
      // Review -c1 (poin 2): setelah dikonfirmasi, "Perkiraan harga" di
      // sini DISEMBUNYIKAN — membingungkan berdampingan dengan total
      // final sungguhan yang sudah tampil di bodyExtraHtml (mis.
      // Rp50.000 vs Rp120.000, padahal yang Rp120.000 itu yang benar).
      data.status === 'dikonfirmasi'
        ? ''
        : `<p style="margin:10px 0 0;font-size:0.8rem;color:#6E6853;">Perkiraan harga (saat pesan, bisa beda dari harga final rental)</p>
    <p style="margin:2px 0 0;font-weight:700;">${formatIDR(data.estimated_price)}</p>`
    }
    ${data.confirmation_message && data.status === 'menunggu' ? `<p style="margin:10px 0 0;font-size:0.85rem;color:#26302B;">${escapeHtml(data.confirmation_message)}</p>` : ''}
    ${bodyExtraHtml}
    ${waButtonHtml}
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

function renderPage(page: PublicPageData, slug: string, req: import('express').Request): string {
  const pageUrl = resolvePageUrl(req, slug);

  // Prioritas og:image (migration 035): logo usaha (representasi brand
  // paling otentik untuk preview link WA) -> foto alat pertama (perilaku
  // sebelum logo ada) -> fallback generik. Logo hasil upload di-resize ke
  // 512px (BusinessInfoSection.tsx) — cukup di atas ambang render WA
  // (umumnya ~200px), dan sama seperti foto alat sebagai og:image
  // sebelumnya, bisa saja persegi (bukan 1200x630) tergantung WA
  // merender; ini bukan regresi, Etalase sudah begini dari awal.
  const itemWithPhoto = page.items.find((item) => item.image_url);
  const ogImage = page.logo_url ?? itemWithPhoto?.image_url ?? FALLBACK_OG_IMAGE;

  const title = `${page.business_name} — Etalase Online | Sewalog`;
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
  if (page.address || page.regency_name) {
    jsonLd.address = {
      '@type': 'PostalAddress',
      ...(page.address ? { streetAddress: page.address } : {}),
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

  const itemsHtml = page.items.length
    ? page.items
        .map((item) => {
          const details = [item.variant, item.size, item.color].filter(Boolean).join(' · ');
          return `<div class="item-card" data-cat="${escapeHtml(item.category ?? '')}" style="background:#FBFAF4;border:1px solid #DBD5C1;border-radius:16px;overflow:hidden;">
  ${
    item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" class="zoomable" style="width:100%;height:160px;object-fit:cover;display:block;" loading="lazy" onclick="openZoom(this)" />`
      : `<div style="width:100%;height:160px;background:#E6E1D2;"></div>`
  }
  <div style="padding:12px;">
    <p style="margin:0;font-weight:700;color:#26302B;">${escapeHtml(item.name)}</p>
    ${item.category ? `<p style="margin:2px 0 0;font-size:0.8rem;color:#6E6853;">${escapeHtml(item.category)}</p>` : ''}
    ${details ? `<p style="margin:2px 0 0;font-size:0.75rem;color:#6E6853;">${escapeHtml(details)}</p>` : ''}
    <p style="margin:6px 0 0;font-weight:700;color:#2B4739;">${formatIDR(item.price_per_day)} <span style="font-weight:400;color:#6E6853;font-size:0.75rem;">/hari</span></p>
    ${
      item.extra_day_rate < item.price_per_day
        ? `<p style="margin:2px 0 0;font-size:0.75rem;color:#6E6853;">Mulai ${formatIDR(item.extra_day_rate)}/hari untuk sewa panjang</p>`
        : ''
    }
    <span data-avail="${escapeHtml(item.id)}" style="display:none;margin-top:6px;padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:700;"></span>
    <button type="button" class="pesan-btn" data-item-id="${escapeHtml(item.id)}" data-item-name="${escapeHtml(item.name)}"
      data-price-per-day="${item.price_per_day}" data-day2-rate="${item.day2_rate}" data-day3-rate="${item.day3_rate}"
      data-day4-rate="${item.day4_rate}" data-day5-rate="${item.day5_rate}" data-extra-day-rate="${item.extra_day_rate}"
      style="display:none;margin-top:8px;width:100%;min-height:36px;padding:8px 10px;border-radius:10px;border:none;background:#2B4739;color:#fff;font-weight:700;font-size:0.75rem;cursor:pointer;">Pesan Sekarang</button>
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
<meta property="og:title" content="${escapeHtml(page.business_name)} — Etalase Online" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(ogImage)}" />

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
     React — lihat larangan route React di komentar atas file ini). */
  #cart-bar {
    display: none; position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
    background: #2B4739; color: #fff; padding: 12px 16px;
    align-items: center; justify-content: space-between; gap: 12px;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.15);
  }
  /* JS men-set style.display = 'flex' langsung saat keranjang terisi —
     aturan di atas cuma menyediakan default TERSEMBUNYI (none). */
  #cart-bar button { min-height: 44px; padding: 10px 16px; border-radius: 10px; border: none; background: #fff; color: #2B4739; font-weight: 700; font-size: 0.85rem; cursor: pointer; }
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
        ${page.regency_name ? `<p style="margin:4px 0 0;color:#6E6853;font-size:0.875rem;">${escapeHtml(page.regency_name)}</p>` : ''}
      </div>
    </div>`
        : `<p style="margin:0 0 4px;font-size:0.75rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#A65C2A;">Etalase Online</p>
    <h1 style="margin:0;font-size:1.5rem;color:#26302B;">${escapeHtml(page.business_name)}</h1>
    ${page.regency_name ? `<p style="margin:4px 0 0;color:#6E6853;font-size:0.875rem;">${escapeHtml(page.regency_name)}</p>` : ''}`
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
        ? `<p style="margin:0 0 10px;font-size:0.8rem;color:#6E6853;">Pilih tanggal ambil &amp; kembali untuk cek sisa unit tersedia per alat sepanjang periode itu (butuh JavaScript aktif) — atau langsung hubungi kami lewat WhatsApp.</p>
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

  <footer style="margin-top:32px;padding-top:16px;border-top:1px solid #DBD5C1;font-size:0.75rem;color:#6E6853;">
    Etalase online ini dibuat pakai <a href="https://sewalog.com" style="color:#2B4739;font-weight:600;">Sewalog</a>.
  </footer>
</div>

<div id="lightbox" onclick="closeZoom(event)">
  <button type="button" id="lightbox-close" onclick="closeZoom(event)" aria-label="Tutup">&times;</button>
  <img id="lightbox-img" src="" alt="" />
</div>

<div id="cart-bar">
  <span id="cart-summary">0 alat</span>
  <button type="button" id="cart-open-btn">Lanjut pesan →</button>
</div>

<div id="order-modal" class="modal-overlay">
  <div class="modal-panel">
    <button type="button" class="modal-close" id="order-modal-close" aria-label="Tutup">&times;</button>
    <h2 style="font-size:1.1rem;margin:0 0 4px;">Pesanan Anda</h2>
    <p id="cart-date-range" style="margin:0 0 10px;font-size:0.85rem;color:#6E6853;"></p>
    <div id="cart-items-list"></div>
    <p style="margin:10px 0 0;font-weight:700;">Perkiraan total: <span id="cart-total-price"></span></p>
    <p style="margin:2px 0 0;font-size:0.75rem;color:#6E6853;">Perkiraan, harga final dikonfirmasi rental.</p>

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

    <div class="form-error" id="order-form-error"></div>
    <button type="button" class="submit-btn" id="order-submit-btn">Kirim Pesanan</button>
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

  // Begitu tanggal ambil diisi, default-kan tanggal kembali ke hari yang
  // sama kalau belum diisi/masih lebih awal — kebanyakan pengunjung cuma
  // mau isi satu tanggal dulu buat cek sewa 1 hari.
  startInput.addEventListener('change', function () {
    if (!endInput.value || endInput.value < startInput.value) {
      endInput.value = startInput.value;
    }
  });

  // Threshold "sisa sedikit" ini SENGAJA disalin dari LOW_STOCK_RATIO di
  // backend/src/lib/availability.ts (0.2) — cuma dipakai buat warna badge
  // di sini, bukan sumber angka (angka remaining tetap dari server, jadi
  // tidak bisa dimanipulasi lewat sisi klien walau threshold-nya beda).
  function badgeFor(remaining, total) {
    if (remaining <= 0) return { text: 'Penuh', color: '#A8412E', bg: 'rgba(168,65,46,0.12)' };
    var threshold = Math.max(1, Math.floor(total * 0.2));
    if (remaining <= threshold) {
      return { text: 'Sisa ' + remaining + ' dari ' + total, color: '#A65C2A', bg: 'rgba(166,92,42,0.12)' };
    }
    return { text: 'Tersedia ' + remaining + ' dari ' + total, color: '#2B4739', bg: 'rgba(43,71,57,0.12)' };
  }

  btn.addEventListener('click', function () {
    var start = startInput.value;
    var end = endInput.value || start;
    if (!start) {
      status.textContent = 'Pilih tanggal ambil dulu.';
      return;
    }
    if (end < start) {
      status.textContent = 'Tanggal kembali tidak boleh sebelum tanggal ambil.';
      return;
    }
    status.textContent = 'Memuat ketersediaan...';
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
        status.textContent = start === end
          ? 'Ketersediaan untuk tanggal ' + start + ':'
          : 'Ketersediaan untuk ' + start + ' s/d ' + end + ' (sisa unit terendah sepanjang periode ini):';
        data.items.forEach(function (it) {
          var el = document.querySelector('[data-avail="' + it.id + '"]');
          if (el) {
            var b = badgeFor(it.remaining, it.total_units);
            el.textContent = b.text;
            el.style.color = b.color;
            el.style.background = b.bg;
            el.style.display = 'inline-block';
          }
          // Rencana tahap 3: tombol "Pesan Sekarang" cuma muncul kalau
          // pesanan online aktif untuk toko ini DAN alat itu masih
          // tersedia (remaining > 0) di rentang yang baru dicek —
          // remaining-nya disimpan di dataset tombol supaya qty stepper
          // di keranjang tahu batas atasnya tanpa fetch ulang.
          var pesanBtn = document.querySelector('.pesan-btn[data-item-id="' + it.id + '"]');
          if (pesanBtn) {
            pesanBtn.dataset.remaining = it.remaining;
            pesanBtn.style.display = orderingEnabled && it.remaining > 0 ? 'block' : 'none';
          }
        });
        setOrderDates(start, end);
      })
      .catch(function () {
        status.textContent = 'Gagal memuat ketersediaan.';
      });
  });

  // ------------------------------------------------------------
  // Rencana tahap 3: Pesanan Online dari Etalase (form + keranjang)
  // ------------------------------------------------------------
  // min date picker = BESOK, dihitung dari waktu LOKAL BROWSER (bukan
  // offset WIB manual) — CLAUDE.md bagian 4: device pengunjung secara
  // fisik ada di WIB, jadi waktu lokal browser sudah benar tanpa perlu
  // offset. Sama pola dengan todayStr() di frontend/src/utils/formatters.ts.
  function localDateStr(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  var tomorrowLocal = new Date();
  tomorrowLocal.setDate(tomorrowLocal.getDate() + 1);
  var minDateStr = localDateStr(tomorrowLocal);
  startInput.min = minDateStr;
  endInput.min = minDateStr;

  var orderingEnabled = false;
  var paymentMethods = { transfer: false, qris: false, cash: false };
  var cart = []; // [{item_id, name, quantity, remaining, rates: {...}}]
  var orderDates = { start: null, end: null };

  fetch('/api/public/etalase/' + encodeURIComponent(slug) + '/ordering-config')
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      orderingEnabled = !!(cfg && cfg.enabled);
      paymentMethods = (cfg && cfg.payment_methods) || paymentMethods;
    })
    .catch(function () { orderingEnabled = false; });

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

  function rentalDaysCount(start, end) {
    return Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000) + 1;
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

  var cartBar = document.getElementById('cart-bar');
  var cartSummary = document.getElementById('cart-summary');
  var orderModal = document.getElementById('order-modal');

  function renderCart() {
    var totalQty = cart.reduce(function (sum, c) { return sum + c.quantity; }, 0);
    if (totalQty > 0) {
      cartBar.style.display = 'flex';
      cartSummary.textContent = totalQty + ' alat dipilih';
    } else {
      cartBar.style.display = 'none';
    }

    // Review -c1 (poin 5): tampilkan rentang tanggal di atas daftar
    // alat di modal, supaya pelanggan bisa cek ulang tanggalnya benar
    // SEBELUM kirim — bukan cuma tersirat dari langkah cek ketersediaan
    // sebelumnya yang sudah tertutup modal ini.
    var dateRangeEl = document.getElementById('cart-date-range');
    if (orderDates.start && orderDates.end) {
      var daysForLabel = rentalDaysCount(orderDates.start, orderDates.end);
      var dateLabel = orderDates.start === orderDates.end ? orderDates.start : orderDates.start + ' – ' + orderDates.end;
      dateRangeEl.textContent = dateLabel + ' · ' + daysForLabel + ' hari';
    } else {
      dateRangeEl.textContent = '';
    }

    var listEl = document.getElementById('cart-items-list');
    var totalPrice = 0;
    var days = orderDates.start && orderDates.end ? rentalDaysCount(orderDates.start, orderDates.end) : 1;
    listEl.innerHTML = cart.map(function (c, idx) {
      var subtotal = computeItemRentalPrice(c.rates, days) * c.quantity;
      totalPrice += subtotal;
      return '<div class="cart-row">' +
        '<span>' + c.name + '</span>' +
        '<div class="qty-stepper">' +
          '<button type="button" data-action="dec" data-idx="' + idx + '">&minus;</button>' +
          '<span>' + c.quantity + '</span>' +
          '<button type="button" data-action="inc" data-idx="' + idx + '">+</button>' +
        '</div>' +
      '</div>';
    }).join('');
    document.getElementById('cart-total-price').textContent = formatIDRClient(totalPrice);

    listEl.querySelectorAll('button[data-action]').forEach(function (b) {
      b.addEventListener('click', function () {
        var idx = Number(b.getAttribute('data-idx'));
        var action = b.getAttribute('data-action');
        if (action === 'inc' && cart[idx].quantity < cart[idx].remaining) cart[idx].quantity++;
        if (action === 'dec') {
          cart[idx].quantity--;
          if (cart[idx].quantity <= 0) cart.splice(idx, 1);
        }
        renderCart();
      });
    });
  }

  document.querySelectorAll('.pesan-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var itemId = btn.dataset.itemId;
      var remaining = Number(btn.dataset.remaining || 0);
      var existing = cart.find ? cart.find(function (c) { return c.item_id === itemId; }) : null;
      if (existing) {
        if (existing.quantity < remaining) existing.quantity++;
      } else {
        cart.push({
          item_id: itemId,
          name: btn.dataset.itemName,
          quantity: 1,
          remaining: remaining,
          rates: {
            price_per_day: Number(btn.dataset.pricePerDay),
            day2_rate: Number(btn.dataset.day2Rate),
            day3_rate: Number(btn.dataset.day3Rate),
            day4_rate: Number(btn.dataset.day4Rate),
            day5_rate: Number(btn.dataset.day5Rate),
            extra_day_rate: Number(btn.dataset.extraDayRate),
          },
        });
      }
      renderCart();
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
        website: document.getElementById('order-website').value, // honeypot
      }),
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Pesanan';
        if (!res.ok || !res.body.token) {
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
