# Sewalog

SaaS tools operasional untuk UKM rental alat kamping/outdoor di Malang Raya (Kota Malang, Kabupaten Malang, Kota Batu). Fase sekarang adalah **SaaS-wedge**: tools gratis/uji coba untuk vendor kelola stok, transaksi, jaminan, dan denda — belum jadi marketplace publik. Konteks produk lengkap ada di [CLAUDE.md](CLAUDE.md).

## Fitur yang tersedia saat ini

**Fondasi**
- Login & daftar (email/password, Supabase Auth), termasuk lupa password (`resetPasswordForEmail` + link email, layar khusus buat set password baru saat kembali lewat link itu — `useAuth` mendeteksi event `PASSWORD_RECOVERY` dari Supabase, disela sebelum masuk ke app dengan sesi recovery-nya). Sama untuk owner & karyawan, karena auth terpisah dari role bisnis. **Perlu setup manual sekali di Supabase dashboard**: tambahkan URL app (dev & production) ke Auth → URL Configuration → Redirect URLs.
- Onboarding — buat profil usaha otomatis saat pertama login
- Katalog & stok alat — kode alat, kategori, varian/ukuran/warna opsional (pilih dari nilai yang sudah pernah dipakai di katalog atau ketik baru, pola sama seperti Bilbo-Outdoors), foto (unggah langsung dari galeri/kamera, otomatis dikompres & disimpan ke Cloudflare R2 — bukan tempel URL manual), deskripsi, catatan kondisi, jumlah unit, harga sewa/hari, harga bertingkat opsional (tarif lebih murah per hari setelah sewa melewati N hari); bisa diedit atau dinonaktifkan (soft-delete, histori booking lama tetap utuh)
- Kelola Usaha (owner-only, satu tab gabungan) — bagian **Info Usaha**: edit nama usaha, nama pemilik, no. telepon, dan toleransi telat (jam) kapan saja (migration 018 membatasi RLS `businesses` UPDATE ke owner, sebelumnya semua anggota bisa update). Bagian **Kelola Karyawan**: undang staf lewat link sekali-pakai (kedaluwarsa 7 hari), tanpa perlu pemilik membuatkan username/password. Peran (`karyawan`/`owner`) murni label atribusi untuk fitur operasional (kalender, transaksi, jaminan & denda, katalog) — akses di situ sama untuk semua anggota. Satu pengecualian: tab Kelola Usaha ini sendiri (Info Usaha maupun undang/keluarkan anggota) cuma bisa diakses pemilik, ditegakkan di RLS (migration 014, 018) dan backend, bukan cuma disembunyikan di UI. Layar login yang dibuka lewat link undangan (`?invite=...`) menampilkan nama usaha & peran yang mengundang **sebelum** login (`GET /api/team/invites/preview`, migration 016 — function `SECURITY DEFINER` yang dibatasi ketat, cuma untuk kode undangan yang valid).
- Riwayat Transaksi (owner-only) — rekap semua transaksi termasuk yang sudah Selesai/Dibatalkan (Jaminan & Denda cuma menampilkan status aktif, jadi transaksi yang sudah ditutup sebelumnya tidak terlihat di mana pun lagi). Kartu ringkasan (Total Transaksi, Sudah Diterima, Piutang, Jatuh Tempo Hari Ini — tiga pertama sengaja tidak menghitung transaksi Dibatalkan), filter tanggal/status/pencarian, ekspor CSV, dan bagian Peralatan Terlaris Disewa (dikelompokkan per kategori, collapsible, diurutkan dari jumlah unit tersewa terbanyak). Query langsung ke Supabase dari frontend (bukan lewat backend) karena tidak butuh perhitungan live seperti Jaminan & Denda — data historis sudah final.
- Panduan penggunaan — halaman referensi in-app yang menjelaskan tiap fitur dari sisi vendor (tab **Panduan** di navbar).
- Audit trail — setiap perubahan status transaksi (aktif/telat/selesai/dibatalkan) tercatat siapa & kapan (`booking_status_history`, append-only) dan bisa dilihat langsung lewat "Riwayat Status" di tiap kartu transaksi pada layar Jaminan & Denda; perubahan data alat (tambah/edit/nonaktifkan) tercatat otomatis lewat trigger database (`items.created_by`/`updated_by`/`updated_at`/`deactivated_by`) dan ditampilkan sebagai baris "Diperbarui oleh..." di tiap kartu Katalog & Stok Alat.

**Tiga fitur inti MVP**
1. **Kalender ketersediaan** — daftar per-alat dengan strip status beberapa hari ke depan (tersedia / sisa sedikit / penuh), bisa geser tanggal maju-mundur, filter kategori & pencarian. Dihitung on-the-fly dari data booking, bukan tabel tersimpan terpisah.
2. **Catat transaksi** — form bertahap: data penyewa (nama, WhatsApp, alamat — mengetik nama memicu pencarian pelanggan lama berdasar nama/HP/alamat sekaligus, tiap saran menampilkan HP+alamat supaya nama yang sama tetap bisa dibedakan, memilih salah satu reuse data pelanggan yang sama beserta catatan "Pernah sewa Nx" alih-alih selalu bikin baris pelanggan baru; foto wajah/setengah badan penyewa opsional lewat kamera, disimpan ke R2 — sengaja bukan foto KTP/dokumen identitas untuk membatasi data sensitif yang disimpan, ditampilkan sebagai thumbnail di kartu transaksi Jaminan & Denda), periode sewa, pilih alat (kotak pencarian nama/varian/ukuran/warna, label varian/ukuran/warna ditampilkan di tiap baris alat, multi-item dengan validasi kapasitas otomatis, harga bertingkat terhitung otomatis kalau alatnya punya diskon sewa lama), jenis jaminan (KTP/SIM/STNK/Paspor/Uang/Lainnya + catatan), uang muka (DP), total harga otomatis. Booking dengan tanggal ambil hari ini langsung berstatus aktif; tanggal ambil di masa depan berstatus "dipesan" sampai ditandai diambil. Nomor booking (`SWL-YYYYMMDD-NN`) dan struk WhatsApp otomatis (`wa.me`) dibuat setiap transaksi.
3. **Jaminan & denda** — dashboard ringkasan (jumlah telat, jaminan ditahan, sedang disewa, tunggakan denda) dengan filter & pencarian. Bisa tambah denda ad-hoc kapan saja (tanpa harus lewat proses pengembalian), lalu proses pengembalian: denda keterlambatan (saran otomatis berbasis toleransi jam per-vendor, bisa ditimpa), denda kerusakan, dan denda kehilangan dicatat sebagai tiga hal terpisah — tidak digabung jadi satu angka — plus opsi tandai jaminan sudah dikembalikan. Transaksi juga bisa dibatalkan sebelum diproses. Struk WhatsApp dan Nota Sewa cetak/PDF (tombol **Cetak Nota**, generate murni di browser lewat `window.print()` — tanpa library PDF atau endpoint baru) tersedia di tiap kartu transaksi.

## Tech stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS v4, ikon [lucide-react](https://lucide.dev/) (`frontend/`)
- **Landing page**: React + Vite + TypeScript (`landing/`) — situs marketing statis, terpisah dari app produk, tanpa dependensi Supabase/backend
- **Backend**: Express + TypeScript (`backend/`)
- **Database & Auth**: Supabase (Postgres + Row Level Security)
- **Object storage**: Cloudflare R2 (foto katalog alat) — diakses lewat `@aws-sdk/client-s3` (S3-compatible), kredensial hanya ada di backend

Backend tidak pernah memakai Supabase Secret Key — semua request diteruskan dengan JWT milik user yang login, supaya RLS (`is_member_of(business_id)`, diturunkan dari `owner_id = auth.uid()` saat business dibuat) tetap jadi satu-satunya penjaga isolasi antar-vendor. R2 sendiri tidak punya mekanisme setara RLS per-user, jadi upload foto selalu lewat endpoint backend (`POST /api/uploads/item-image`) yang mengecek keanggotaan usaha dulu sebelum mengunggah — kredensial R2 tidak pernah dikirim ke browser.

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
   7. `007_business_members_and_invites.sql`
   8. `008_audit_trail.sql`
   9. `009_tiered_pricing.sql`
   10. `010_business_members_email.sql`
   11. `012_business_members_owner_self_insert.sql`
   12. `013_fix_owner_self_insert_recursion.sql`
   13. `014_team_management_owner_only.sql`
   14. `015_items_variant_size_color.sql`
   15. `016_invite_preview.sql`
   16. `017_booking_customer_photo.sql`
   17. `018_business_settings_owner_only.sql`

3. **Buat bucket Cloudflare R2** — buat bucket baru di [dash.cloudflare.com](https://dash.cloudflare.com) → R2, aktifkan akses publik (custom domain atau URL `pub-xxxx.r2.dev` bawaan), lalu buat API Token (Account API Token, permission **Object Read & Write**, dibatasi ke bucket ini saja).

4. **Isi env var** — copy `.env.example` jadi `.env` di masing-masing folder, isi dari Supabase Dashboard → Connect → App Frameworks, dan dari langkah R2 di atas:
   - `backend/.env` → `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`
   - `frontend/.env` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

5. **Jalankan dev server** (terminal terpisah per bagian yang mau dijalankan):
   ```bash
   npm run dev:backend    # http://localhost:3001
   npm run dev:frontend   # http://localhost:5173
   npm run dev:landing    # http://localhost:5173 (workspace terpisah, jalankan salah satu saja per port default Vite)
   ```

## Akun demo untuk ditunjukkan ke calon vendor

Supaya calon vendor bisa langsung coba alur aplikasi (kalender, catat transaksi, jaminan & denda, kelola karyawan) tanpa harus isi data sendiri dulu, ada satu akun demo yang sudah terisi katalog alat + beberapa contoh transaksi di berbagai status (siap diambil, sedang disewa, terlambat + denda kerusakan) dan dua login (pemilik + karyawan) supaya "peran karyawan cuma label, bukan pembatas akses" bisa langsung dirasakan, bukan cuma dijelaskan. Kredensial yang sama ini juga ditampilkan di bagian "Mau Coba Sendiri Dulu?" pada landing page (`landing/src/LandingPage.tsx`) — jaga tetap sinkron kalau salah satu diubah.

**Cara 1 — tombol di layar login** (buat yang lagi demo langsung ke vendor, tidak perlu buka terminal): tautan **"Lagi demo ke calon vendor? Reset data demo"** di bawah tombol Masuk. Sekali tekan langsung reset + isi otomatis email/password login pemilik, tinggal tekan Masuk. Dibatasi cooldown 60 detik di server (`POST /api/demo/reset`, lihat `backend/src/routes/demo.ts`) supaya tidak bisa dispam — endpoint ini publik tanpa login, tapi dikunci cuma bisa menyentuh satu business demo yang hardcoded (`backend/src/lib/demoReset.ts`), tidak pernah menerima business_id dari request.

**Cara 2 — command line** (buat reset dari mesin developer, atau dijadwalkan lewat cron/GitHub Actions):
```bash
npm run seed:demo
```
Butuh `backend/.env` sudah terisi dan backend sedang jalan di `npm run dev:backend`. Untuk seed ke backend production, jalankan `API_BASE_URL=https://<url-backend-render-mu> npm run seed:demo`. Logika reset-nya sama persis dengan tombol di Cara 1 (`scripts/seed-demo.mjs` dan `backend/src/lib/demoReset.ts` sengaja dijaga sinkron).

Kedua cara **aman dijalankan berkali-kali** — setiap reset menutup transaksi demo dari run sebelumnya lewat endpoint yang sama dipakai vendor asli (bukan hard-delete, karena `booking_status_history` sengaja append-only — lihat bagian Keterbatasan di bawah), lalu reset katalog alat ke nilai default dan membuat transaksi contoh yang baru.

Login default (bisa ditimpa lewat env var `DEMO_OWNER_EMAIL`/`DEMO_KARYAWAN_EMAIL`/`DEMO_PASSWORD`, dibaca kedua cara di atas):
- Pemilik: `demo.pemilik@sewalog.test` / `CobaSewalog2026`
- Karyawan: `demo.karyawan@sewalog.test` / `CobaSewalog2026`

> Karena ini akun demo yang **dibagikan bersama** ke banyak calon vendor, dua orang yang mencoba bersamaan bisa saling menimpa perubahan satu sama lain (mis. batalkan transaksi contoh yang baru saja dilihat orang lain) — cukup tekan tombol reset di layar login (atau jalankan ulang `npm run seed:demo`) untuk mengembalikannya ke kondisi awal sebelum sesi demo berikutnya.

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
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` = dari setup bucket Cloudflare R2 (lihat langkah 3 di Setup lokal)
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

Environment variable (opsional, harus diisi **sebelum** build karena Vite meng-inline nilainya saat build):
- `VITE_APP_URL` = URL frontend dari langkah 3 (contoh: `https://sewalog-frontend.onrender.com`) — dipakai tombol "Buka Demo" di bagian akun demo. Kalau dikosongkan, fallback ke `http://localhost:5173` (cuma benar untuk dev lokal).

Selain itu `landing/` murni statis, tanpa Supabase atau panggilan ke backend sama sekali (CTA utamanya link `wa.me`).

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
- Login, onboarding, dan sebagian besar Kelola Alat memanggil Supabase langsung dari frontend (tidak lewat backend), jadi tidak kena cold start ini. Tiga fitur inti MVP, upload foto alat (harus lewat backend karena kredensial R2), dan Kelola Karyawan (invite) tetap lewat backend, jadi bisa terasa lambat di request pertama setelah idle.
- Landing page tidak kena cold start apa pun — full statis, tidak ada dependensi runtime.

## Keterbatasan yang disengaja (sesuai fase sekarang)

Lihat CLAUDE.md bagian 8 untuk daftar lengkap non-goals. Yang relevan secara teknis:
- Tabel `businesses` sengaja tidak punya RLS policy `delete` (mencegah kehilangan histori booking) — kalau perlu hapus data uji coba, lakukan lewat SQL Editor langsung.
- Tabel `booking_status_history` (audit trail) sengaja append-only, tidak ada policy `update`/`delete` sama sekali — termasuk untuk data uji coba/demo. `scripts/seed-demo.mjs` sengaja didesain menutup transaksi lama lewat endpoint asli (bukan hard-delete) karena batasan ini.
- Belum ada manifest/ikon PWA — logo master ada di `frontend/public/logo.svg`, tinggal diekspor kalau fitur ini mau diaktifkan.
- Belum ada rekap laporan, multi-cabang, atau marketplace publik.
