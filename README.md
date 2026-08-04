# Sewalog

SaaS tools operasional untuk UKM rental alat kamping/outdoor di Malang Raya (Kota Malang, Kabupaten Malang, Kota Batu). Fase sekarang adalah **SaaS-wedge**: tools gratis/uji coba untuk vendor kelola stok, transaksi, jaminan, dan denda — belum jadi marketplace publik. Konteks produk lengkap ada di [CLAUDE.md](CLAUDE.md).

## Fitur yang tersedia saat ini

**Fondasi**
- Login & daftar (email/password, Supabase Auth)
- Onboarding — buat profil usaha otomatis saat pertama login
- Katalog & stok alat — kode alat, kategori, foto (URL), deskripsi, catatan kondisi, jumlah unit, harga sewa/hari; bisa diedit atau dinonaktifkan (soft-delete, histori booking lama tetap utuh)

**Tiga fitur inti MVP**
1. **Kalender ketersediaan** — daftar per-alat dengan strip status beberapa hari ke depan (tersedia / sisa sedikit / penuh), bisa geser tanggal maju-mundur, filter kategori & pencarian. Dihitung on-the-fly dari data booking, bukan tabel tersimpan terpisah.
2. **Catat transaksi** — form bertahap: data penyewa (nama, WhatsApp, alamat), periode sewa, pilih alat (multi-item dengan validasi kapasitas otomatis), jenis jaminan (KTP/SIM/STNK/Paspor/Uang/Lainnya + catatan), uang muka (DP), total harga otomatis. Booking dengan tanggal ambil hari ini langsung berstatus aktif; tanggal ambil di masa depan berstatus "dipesan" sampai ditandai diambil. Nomor booking (`SWL-YYYYMMDD-NN`) dan struk WhatsApp otomatis (`wa.me`) dibuat setiap transaksi.
3. **Jaminan & denda** — dashboard ringkasan (jumlah telat, jaminan ditahan, sedang disewa, tunggakan denda) dengan filter & pencarian. Bisa tambah denda ad-hoc kapan saja (tanpa harus lewat proses pengembalian), lalu proses pengembalian: denda keterlambatan (saran otomatis berbasis toleransi jam per-vendor, bisa ditimpa), denda kerusakan, dan denda kehilangan dicatat sebagai tiga hal terpisah — tidak digabung jadi satu angka — plus opsi tandai jaminan sudah dikembalikan. Transaksi juga bisa dibatalkan sebelum diproses.

## Tech stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS v4, ikon [lucide-react](https://lucide.dev/) (`frontend/`)
- **Landing page**: React + Vite + TypeScript (`landing/`) — situs marketing statis, terpisah dari app produk, tanpa dependensi Supabase/backend
- **Backend**: Express + TypeScript (`backend/`)
- **Database & Auth**: Supabase (Postgres + Row Level Security)

Backend tidak pernah memakai Supabase Secret Key — semua request diteruskan dengan JWT milik user yang login, supaya RLS (`owner_id = auth.uid()`) tetap jadi satu-satunya penjaga isolasi antar-vendor.

## Struktur project

```
frontend/       React SPA (Vite) — app produk (login, kalender, transaksi, jaminan & denda)
landing/        React SPA (Vite) — landing page marketing, CTA WhatsApp, deploy terpisah dari frontend/
backend/        REST API kecil untuk agregasi ketersediaan, transaksi, tracking denda
migrations/     SQL schema — dijalankan manual di Supabase SQL Editor, urutan penting
```

## Setup lokal

1. **Install dependencies** (root, otomatis meng-cover frontend + backend lewat npm workspaces):
   ```bash
   npm install
   ```

2. **Setup Supabase project** — buat project baru di [supabase.com](https://supabase.com), lalu jalankan file-file di `migrations/` **berurutan** lewat SQL Editor:
   1. `skema-final.sql`
   2. `002_businesses_deactivated_at.sql`
   3. `003_bookings_return_time_and_tolerance.sql`
   4. `004_items_deactivated_at.sql`
   5. `005_bookings_cancel_status.sql`
   6. `006_richer_catalog_and_booking_fields.sql`

3. **Isi env var** — copy `.env.example` jadi `.env` di masing-masing folder, isi dari Supabase Dashboard → Connect → App Frameworks:
   - `backend/.env` → `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
   - `frontend/.env` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

4. **Jalankan dev server** (terminal terpisah per bagian yang mau dijalankan):
   ```bash
   npm run dev:backend    # http://localhost:3001
   npm run dev:frontend   # http://localhost:5173
   npm run dev:landing    # http://localhost:5173 (workspace terpisah, jalankan salah satu saja per port default Vite)
   ```

## Deploy ke Render (free tier) untuk demo vendor

Render dipakai karena free tier-nya cukup untuk demo: dua **Static Site** (frontend, landing) + satu **Web Service** (backend). Supabase sudah di-setup dari langkah lokal di atas — kalau belum, lakukan itu dulu.

### 1. Push ke GitHub

Render deploy dari repo Git. Push project ini ke GitHub (repo boleh privat, Render bisa akses lewat OAuth).

### 2. Deploy backend (Web Service)

Di Render Dashboard → **New → Web Service** → hubungkan repo ini.

| Setting | Nilai |
|---|---|
| Root Directory | *(kosongkan, biarkan root repo)* |
| Runtime | Node |
| Build Command | `npm install --include=dev && npm run build --workspace backend` |
| Start Command | `npm run start --workspace backend` |
| Instance Type | Free |

Environment variables (Render → service ini → **Environment**):
- `SUPABASE_URL` = URL project Supabase
- `SUPABASE_PUBLISHABLE_KEY` = publishable key project Supabase
- `FRONTEND_ORIGIN` = *(isi belakangan, setelah frontend dideploy dan tahu URL-nya — lihat langkah 5)*

> Catatan: `--include=dev` sengaja dipakai supaya `typescript` (devDependency, dibutuhkan buat build) tetap ke-install meski platform men-set `NODE_ENV=production`.

Setelah deploy sukses, catat URL backend-nya, contoh: `https://sewalog-backend.onrender.com`.

### 3. Deploy frontend (Static Site)

Di Render Dashboard → **New → Static Site** → hubungkan repo yang sama.

| Setting | Nilai |
|---|---|
| Root Directory | *(kosongkan, biarkan root repo)* |
| Build Command | `npm install --include=dev && npm run build --workspace frontend` |
| Publish Directory | `frontend/dist` |

Environment variables (harus diisi **sebelum** build pertama, karena Vite meng-inline nilainya saat build):
- `VITE_SUPABASE_URL` = URL project Supabase
- `VITE_SUPABASE_PUBLISHABLE_KEY` = publishable key project Supabase
- `VITE_API_BASE_URL` = URL backend dari langkah 2 (contoh: `https://sewalog-backend.onrender.com`)

Setelah deploy sukses, catat URL frontend-nya, contoh: `https://sewalog-frontend.onrender.com`.

### 4. Deploy landing page (Static Site)

Di Render Dashboard → **New → Static Site** → hubungkan repo yang sama lagi (jadi service ketiga, terpisah dari frontend).

| Setting | Nilai |
|---|---|
| Root Directory | *(kosongkan, biarkan root repo)* |
| Build Command | `npm install --include=dev && npm run build --workspace landing` |
| Publish Directory | `landing/dist` |

Tidak ada environment variable yang perlu diisi — `landing/` murni statis, tanpa Supabase atau panggilan ke backend sama sekali (CTA-nya cuma link `wa.me`).

> Ingat ganti nomor placeholder di `landing/src/lib/whatsapp.ts` (`62xxxxxxxxxx`) ke nomor WhatsApp asli sebelum atau langsung setelah deploy pertama — kalau lupa, tombol CTA akan mengarah ke nomor yang salah.

Setelah deploy sukses, catat URL landing-nya, contoh: `https://sewalog.onrender.com`. Ini yang cocok dibagikan sebagai link utama ke calon vendor (lewat DM/kunjungan) — URL frontend dari langkah 3 di atas tetap tersedia terpisah untuk vendor yang sudah punya akun.

### 5. Sambungkan CORS backend → frontend

Balik ke service **backend** di Render → Environment → set `FRONTEND_ORIGIN` ke URL frontend dari langkah 3 (contoh: `https://sewalog-frontend.onrender.com`) → simpan (otomatis redeploy). Landing page tidak perlu ditambahkan ke sini karena tidak pernah memanggil backend.

### 6. Update Supabase Auth URL Configuration

Supabase Dashboard → Authentication → URL Configuration:
- **Site URL** → isi URL frontend production
- **Redirect URLs** → tambahkan URL frontend production juga

### 7. Cek "Confirm email" sebelum demo ke vendor

Authentication → Providers → Email → toggle **Confirm email**. Untuk pilot awal ke vendor beneran, pertimbangkan **dinyalakan** (vendor daftar pakai email asli, biar tervalidasi) — beda dengan waktu development kemarin yang sengaja dimatikan untuk mempercepat testing. Ini keputusanmu, sesuaikan dengan seberapa terkontrol grup vendornya.

### Catatan soal free tier

- **Static Site** (frontend, landing) tidak pernah "tidur" — selalu langsung responsif.
- **Web Service** (backend) di free tier akan *spin down* setelah idle beberapa saat, dan butuh waktu untuk "bangun" lagi (cold start) di request pertama setelahnya — bisa terasa lambat beberapa puluh detik. Kalau mau demo langsung ke vendor, buka dulu halaman Kalender/Catat Transaksi/Jaminan & Denda beberapa menit sebelum sesi demo dimulai supaya backend sudah "bangun".
- Login, onboarding, dan Kelola Alat memanggil Supabase langsung dari frontend (tidak lewat backend), jadi tidak kena cold start ini — hanya tiga fitur inti MVP yang lewat backend.
- Landing page tidak kena cold start apa pun — full statis, tidak ada dependensi runtime.

## Keterbatasan yang disengaja (sesuai fase sekarang)

Lihat CLAUDE.md bagian 8 untuk daftar lengkap non-goals. Yang relevan secara teknis:
- Tabel `businesses` sengaja tidak punya RLS policy `delete` (mencegah kehilangan histori booking) — kalau perlu hapus data uji coba, lakukan lewat SQL Editor langsung.
- Belum ada manifest/ikon PWA — logo master ada di `frontend/public/logo.svg`, tinggal diekspor kalau fitur ini mau diaktifkan.
- Belum ada rekap laporan, multi-cabang, atau marketplace publik.
