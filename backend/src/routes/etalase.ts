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
router.get('/toko/:slug', async (req, res) => {
  const slug = req.params.slug;
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
});

// Pencarian ketersediaan per tanggal — JSON, dipanggil lewat fetch() dari
// script inline di renderPage() di bawah, BUKAN bagian dari HTML awal
// (jadi tidak mengganggu syarat "OG tags tanpa JS" di atas). Exposure
// jumlah unit tersisa persis di sini SENGAJA, keputusan produk yang
// membalik aturan "total_units privat" — lihat komentar di migration
// 020_public_availability_search.sql sebelum mengubah ini.
router.get('/api/public/etalase/:slug/availability', async (req, res) => {
  const slug = req.params.slug;
  const date = req.query.date;

  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Parameter date wajib diisi, format YYYY-MM-DD.' });
    return;
  }

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc('get_public_availability', { p_slug: slug, p_date: date });

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

function renderPage(page: PublicPageData, slug: string, req: import('express').Request): string {
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const pageUrl = `${baseUrl}/toko/${slug}`;

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

  const itemsHtml = page.items.length
    ? page.items
        .map((item) => {
          const details = [item.variant, item.size, item.color].filter(Boolean).join(' · ');
          return `<div style="background:#FBFAF4;border:1px solid #DBD5C1;border-radius:16px;overflow:hidden;">
  ${
    item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" style="width:100%;height:160px;object-fit:cover;display:block;" loading="lazy" />`
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
  .wrap { max-width: 640px; margin: 0 auto; padding: 20px 16px 40px; }
  .items { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-top: 16px; }
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
    ${page.operating_hours ? `<p style="margin:4px 0 0;color:#6E6853;font-size:0.875rem;">🕒 ${escapeHtml(page.operating_hours)}</p>` : ''}
    ${
      waUrl
        ? `<a href="${escapeHtml(waUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:14px;background:#2B4739;color:#fff;font-weight:700;font-size:0.875rem;padding:10px 18px;border-radius:12px;text-decoration:none;">Hubungi via WhatsApp</a>`
        : ''
    }
  </header>

  <section>
    <h2 style="font-size:1rem;margin:0 0 4px;color:#26302B;">Katalog Alat</h2>
    <p style="margin:0 0 10px;font-size:0.8rem;color:#6E6853;">Pilih tanggal untuk cek sisa unit tersedia per alat (butuh JavaScript aktif) — atau langsung hubungi kami lewat WhatsApp.</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
      <input type="date" id="avail-date" style="padding:8px 10px;border-radius:10px;border:1px solid #DBD5C1;background:#fff;color:#26302B;font:inherit;" />
      <button type="button" id="avail-check" style="padding:8px 14px;border-radius:10px;border:none;background:#2B4739;color:#fff;font-weight:700;font-size:0.8rem;cursor:pointer;">Cek Ketersediaan</button>
    </div>
    <p id="avail-status" style="margin:4px 0 0;font-size:0.75rem;color:#6E6853;min-height:1em;"></p>
    <div class="items">
      ${itemsHtml}
    </div>
  </section>

  <footer style="margin-top:32px;padding-top:16px;border-top:1px solid #DBD5C1;font-size:0.75rem;color:#6E6853;">
    Etalase online ini dibuat pakai <a href="https://sewalog.com" style="color:#2B4739;font-weight:600;">Sewalog</a>.
  </footer>
</div>

<script>
(function () {
  var slug = ${JSON.stringify(slug)};
  var dateInput = document.getElementById('avail-date');
  var btn = document.getElementById('avail-check');
  var status = document.getElementById('avail-status');

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
    var date = dateInput.value;
    if (!date) {
      status.textContent = 'Pilih tanggal dulu.';
      return;
    }
    status.textContent = 'Memuat ketersediaan...';
    fetch('/api/public/etalase/' + encodeURIComponent(slug) + '/availability?date=' + encodeURIComponent(date))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.items) {
          status.textContent = 'Gagal memuat ketersediaan.';
          return;
        }
        status.textContent = 'Ketersediaan untuk tanggal ' + date + ':';
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
