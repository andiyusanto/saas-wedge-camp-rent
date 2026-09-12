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
  image_url: string | null;
  variant: string | null;
  size: string | null;
  color: string | null;
};

type PublicPageData = {
  business_name: string;
  description: string | null;
  address: string | null;
  regency_name: string | null;
  operating_hours: string | null;
  public_phone: string | null;
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

  const itemWithPhoto = page.items.find((item) => item.image_url);
  const ogImage = itemWithPhoto?.image_url ?? FALLBACK_OG_IMAGE;

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
    <span data-avail="${escapeHtml(item.id)}" style="display:none;margin-top:6px;padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:700;"></span>
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
    .avail-sep { display: none; }
    #avail-check { width: 100%; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header style="padding-bottom:16px;border-bottom:1px solid #DBD5C1;margin-bottom:16px;">
    <p style="margin:0 0 4px;font-size:0.75rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#A65C2A;">Etalase Online</p>
    <h1 style="margin:0;font-size:1.5rem;color:#26302B;">${escapeHtml(page.business_name)}</h1>
    ${page.regency_name ? `<p style="margin:4px 0 0;color:#6E6853;font-size:0.875rem;">${escapeHtml(page.regency_name)}</p>` : ''}
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
    <p style="margin:0 0 10px;font-size:0.8rem;color:#6E6853;">Pilih tanggal ambil &amp; kembali untuk cek sisa unit tersedia per alat sepanjang periode itu (butuh JavaScript aktif) — atau langsung hubungi kami lewat WhatsApp.</p>
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

  var slug = ${JSON.stringify(slug)};
  var startInput = document.getElementById('avail-start');
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
          if (!el) return;
          var b = badgeFor(it.remaining, it.total_units);
          el.textContent = b.text;
          el.style.color = b.color;
          el.style.background = b.bg;
          el.style.display = 'inline-block';
        });
      })
      .catch(function () {
        status.textContent = 'Gagal memuat ketersediaan.';
      });
  });
})();
</script>
</body>
</html>`;
}

export default router;
