# Sewalog

SaaS tools operasional untuk UKM rental alat kamping/outdoor di Malang Raya (Kota Malang, Kabupaten Malang, Kota Batu). Fase sekarang adalah **SaaS-wedge**: tools gratis/uji coba untuk vendor kelola stok, transaksi, jaminan, dan denda — belum jadi marketplace publik. Konteks produk lengkap ada di [CLAUDE.md](CLAUDE.md).

## Fitur yang tersedia saat ini

**Fondasi**
- Login & daftar (email/password, Supabase Auth)
- Onboarding — buat profil usaha otomatis saat pertama login
- Kelola alat — tambah & lihat katalog alat (nama, jumlah unit, harga sewa/hari)

**Tiga fitur inti MVP**
1. **Kalender ketersediaan** — daftar per-alat dengan strip status 7 hari ke depan (tersedia / sisa sedikit / penuh). Dihitung on-the-fly dari data booking, bukan tabel tersimpan terpisah.
2. **Catat transaksi** — form input cepat: penyewa, kontak, pilih alat (multi-item), tanggal ambil/kembali, jenis jaminan, total harga (otomatis terhitung, bisa diubah manual). Validasi kapasitas otomatis mencegah alat di-booking melebihi stok yang tersedia.
3. **Jaminan & denda** — daftar transaksi aktif dengan status telat dihitung otomatis (toleransi jam bisa diatur per vendor). Saat pengembalian diproses: denda keterlambatan (saran otomatis, bisa ditimpa), denda kerusakan, dan denda kehilangan dicatat sebagai tiga hal terpisah — tidak digabung jadi satu angka — plus opsi tandai jaminan sudah dikembalikan.

## Tech stack

- **Frontend**: React + Vite + TypeScript (`frontend/`)
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

Render dipakai karena free tier-nya cukup untuk demo: satu **Static Site** (frontend) + satu **Web Service** (backend). Supabase sudah di-setup dari langkah lokal di atas — kalau belum, lakukan itu dulu.

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
- `FRONTEND_ORIGIN` = *(isi belakangan, setelah frontend dideploy dan tahu URL-nya — lihat langkah 4)*

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

### 4. Sambungkan CORS backend → frontend

Balik ke service **backend** di Render → Environment → set `FRONTEND_ORIGIN` ke URL frontend dari langkah 3 (contoh: `https://sewalog-frontend.onrender.com`) → simpan (otomatis redeploy).

### 5. Update Supabase Auth URL Configuration

Supabase Dashboard → Authentication → URL Configuration:
- **Site URL** → isi URL frontend production
- **Redirect URLs** → tambahkan URL frontend production juga

### 6. Cek "Confirm email" sebelum demo ke vendor

Authentication → Providers → Email → toggle **Confirm email**. Untuk pilot awal ke vendor beneran, pertimbangkan **dinyalakan** (vendor daftar pakai email asli, biar tervalidasi) — beda dengan waktu development kemarin yang sengaja dimatikan untuk mempercepat testing. Ini keputusanmu, sesuaikan dengan seberapa terkontrol grup vendornya.

### Catatan soal free tier

- **Static Site** (frontend) tidak pernah "tidur" — selalu langsung responsif.
- **Web Service** (backend) di free tier akan *spin down* setelah idle beberapa saat, dan butuh waktu untuk "bangun" lagi (cold start) di request pertama setelahnya — bisa terasa lambat beberapa puluh detik. Kalau mau demo langsung ke vendor, buka dulu halaman Kalender/Catat Transaksi/Jaminan & Denda beberapa menit sebelum sesi demo dimulai supaya backend sudah "bangun".
- Login, onboarding, dan Kelola Alat memanggil Supabase langsung dari frontend (tidak lewat backend), jadi tidak kena cold start ini — hanya tiga fitur inti MVP yang lewat backend.

## Keterbatasan yang disengaja (sesuai fase sekarang)

Lihat CLAUDE.md bagian 8 untuk daftar lengkap non-goals. Yang relevan secara teknis:
- Tabel `businesses` sengaja tidak punya RLS policy `delete` (mencegah kehilangan histori booking) — kalau perlu hapus data uji coba, lakukan lewat SQL Editor langsung.
- Belum ada manifest/ikon PWA — logo master ada di `frontend/public/logo.svg`, tinggal diekspor kalau fitur ini mau diaktifkan.
- Belum ada rekap laporan, multi-cabang, atau marketplace publik.
