# CLAUDE.md

Konteks lengkap project ini untuk sesi Claude Code. Baca seluruh file ini sebelum mulai kerja — banyak keputusan di sini punya alasan eksplisit yang sengaja ditulis supaya tidak diubah balik tanpa sadar (misalnya soal tema warna dan urutan fitur).

## 1. Apa project ini

SaaS tools operasional untuk UKM rental alat kamping/outdoor di **Malang Raya** (Kota Malang, Kabupaten Malang, Kota Batu), dengan rencana jangka panjang berkembang jadi marketplace publik — tapi **belum sekarang**.

**Project ini terpisah dari `bilbo-outdoors`** (repo lain milik owner yang sama). Tidak ada relasi kode atau data antara keduanya, kecuali kemungkinan pola stack teknis yang mirip.

### Nama produk
- **Sewalog** — nama produk SaaS-tool fase sekarang. Ini nama yang tampil di UI aplikasi (header, judul halaman, dsb), bukan cuma istilah internal. Nama repo `saas-wedge-camp-rent` sifatnya teknis saja, jangan dipakai sebagai nama tampilan.
- **Rimbasewa** — nama produk marketplace fase nanti (belum aktif, lihat bagian 2). Jangan dipakai di UI sebelum fase marketplace resmi dimulai.

## 2. Strategi produk — kenapa urutannya begini

Marketplace rental dua sisi (vendor + penyewa) yang langsung dibangun dari awal secara historis susah scale di Indonesia (contoh: Rentist, Cumi, Raggam — cold-start problem dua sisi sekaligus). Strategi yang lebih terbukti (dipakai Sewasam, MyRental): **bangun basis vendor dulu lewat tools operasional yang berdiri sendiri nilainya**, baru nyalakan marketplace di atas basis itu.

Urutan fase:
1. **Fase sekarang — SaaS-wedge**: tools gratis/uji coba untuk vendor kelola stok, transaksi, jaminan, denda. Tanpa embel-embel marketplace ke vendor di tahap ini.
2. **Fase nanti — Marketplace** (belum dimulai, tidak ada tanggal pasti): dibuka setelah ada bukti vendor pilot beneran pakai tools secara rutin. Skema database sudah disiapkan untuk fase ini (`business_profiles`, `marketplace_consents`) tapi belum diaktifkan secara fungsional.

**Jangan bangun fitur marketplace publik (listing, pencarian lintas vendor, dsb) sebelum ada instruksi eksplisit** — meski skemanya sudah ada, itu persiapan struktural, bukan sinyal untuk mulai build sekarang.

## 3. Target pengguna & scope wilayah

- Pemilik/staf UKM rental alat kamping — bukan technical user, butuh UI yang sangat sederhana dan minim friksi.
- Wilayah tervalidasi: **Malang Raya** saja untuk saat ini (Kota Malang, Kabupaten Malang, Kota Batu). Jangan asumsikan kebutuhan kota lain.
- Vendor prioritas untuk validasi/pilot: Jawa Timur Outdoor, Kubu Barat Camp Rental (Gelombang 1 — dikunjungi langsung), Merbabu Outdoor Malang, Wildtrack Adventure (Gelombang 2 — via DM dulu).

## 4. Tech stack

- Frontend: React
- Backend: Express
- Database & Auth: Supabase (Postgres + RLS)
- Platform: **Web app, mobile-first** — bukan native Android/iOS untuk tahap ini.

### Kenapa web, bukan native app
Distribusi ke vendor harus nol-friksi (kirim link, langsung buka browser — bukan sideload APK atau app store review) karena vendor masih tahap "coba dulu tanpa komitmen". Kecepatan iterasi juga lebih penting di fase validasi daripada pengalaman native.

### Kenapa mobile-first, bukan cuma responsive
Pemakaian nyata terjadi sambil berdiri di depan rak alat, pelanggan menunggu di depan — bukan di depan laptop. Desain alur inti (kalender, catat transaksi, tracking denda) dari mobile dulu, desktop jadi lapisan kedua untuk kebutuhan sekunder (rekap, setup katalog awal).

### Soal app-like / PWA
Boleh tambahkan manifest + ikon agar bisa "Add to Home Screen" (biaya kecil, murni penambahan). **Jangan implementasi offline-first caching agresif** — data stok yang di-cache offline berisiko menampilkan info basi ke vendor, yang justru menciptakan ulang masalah double-booking yang coba diselesaikan tools ini. Tunda sampai ada strategi caching yang jelas soal validitas data.

## 5. Sistem desain

**Prinsip: light theme, kontras tinggi.** Ini bukan pilihan estetika semata — pemakaian terjadi di luar ruangan siang hari, dark UI terbukti sulit dibaca di bawah sinar matahari langsung. **Jangan default ke dark mode** meski itu tren umum di banyak tool developer/SaaS — konteks pemakaian app ini berbeda (field use, sesi pendek, outdoor).

### Palet warna (token final)
| Token | Hex | Pemakaian |
|---|---|---|
| Background | `#F1EEE2` | dasar layar (kanvas/khaki) |
| Surface/card | `#FBFAF4` | kartu, input field |
| Border | `#DBD5C1` / `#E6E1D2` | garis pemisah |
| Primary (hijau pinus) | `#2B4739` | aksi utama, status "tersedia" |
| Warning (rust) | `#A65C2A` | status "sisa sedikit" |
| Danger | `#A8412E` | status "penuh", denda, keterlambatan |
| Text primary | `#26302B` | teks utama |
| Text muted | `#6E6853` | label, teks sekunder |

Warning dan text muted sudah digelapkan sedikit dari nilai awal (`#B5652E`, `#8A8368`) supaya lolos WCAG AA contrast 4.5:1 — ketahuan lewat Lighthouse accessibility audit di `sewalog.com` (skor sempat 93/100, dua token ini penyebabnya). Konsisten dengan alasan "kontras tinggi" di atas: kalau tokennya sendiri gagal kontras, prinsip outdoor-readability-nya ikut gagal. Jangan dikembalikan ke nilai lama tanpa evaluasi kontras ulang.

### Prinsip layout — "strategic minimalism ala Linear"
Padat tapi terstruktur, bukan kosong demi terlihat "bersih". Setiap elemen di layar harus punya alasan fungsional untuk ada. Fitur sekunder disembunyikan dari layar utama (progressive disclosure), fitur inti harian selalu terlihat langsung tanpa navigasi berlapis.

### Logo & aset gambar yang dibutuhkan

Logo mark: siluet tenda hijau `#3E8361` dengan aksen matahari `#F0913F` dan bayangan tanah `#8FBB6F`, di atas badge kanvas `#FBF2DA`. **SVG master sudah final**, ada di `frontend/public/logo.svg` — jangan generate ulang dari nol, pakai file ini sebagai sumber untuk semua ukuran/format turunan di bawah.

| Aset | Ukuran | Format | Keterangan |
|---|---|---|---|
| Favicon | 32×32, 16×16 | `.ico` / `.png` | Tab browser |
| PWA icon | 192×192 | `.png` | `manifest.json`, wajib buat "Add to Home Screen" |
| PWA icon (besar) | 512×512 | `.png` | `manifest.json`, dipakai splash saat app dibuka dari homescreen |
| PWA icon (maskable) | 512×512 | `.png` | Versi dengan safe-area padding di semua sisi (±20%), supaya tidak terpotong di Android adaptive icon |
| Apple touch icon | 180×180 | `.png` | iOS "Add to Home Screen" |
| Logo header in-app | — | `.svg` | Pakai SVG master langsung, bukan raster, biar tajam di semua ukuran layar |
| Open Graph / share image | 1200×630 | `.png`/`.jpg` | Penting karena kanal utama distribusi link ke vendor adalah WhatsApp — tanpa ini, preview link di WA cuma tampil teks polos, kurang meyakinkan buat vendor yang baru pertama kali diajak coba |

Warna logo (`#3E8361`, `#F0913F`, `#8FBB6F`, `#FBF2DA`) khusus dipakai untuk logo/ilustrasi, terpisah dari token warna UI di tabel palet di bagian 5 — jangan dicampur ke komponen interface (tombol, background, status, dsb), tetap pakai token UI utama untuk itu. Untuk aset turunan (favicon, ikon PWA, OG image) yang belum dibuat, generate dari `logo.svg` di atas, jangan dari default/palet generik AI.

## 6. Fitur inti MVP (urutan prioritas build)

1. **Kalender ketersediaan** — list per-item dengan strip status beberapa hari ke depan (bukan grid kalender bulanan penuh). Ketersediaan **dihitung on-the-fly**, tidak disimpan sebagai tabel terpisah — lihat catatan di `skema-final.sql`.
2. **Catat transaksi** — form input cepat: nama penyewa, kontak, pilih alat (multi-item), tanggal ambil/kembali, jenis jaminan, total harga. Minim ketikan, karena diisi sambil melayani pelanggan yang menunggu.
3. **Tracking jaminan & denda** — daftar transaksi aktif dengan status (telat/rusak/hilang), dan **dua jenis denda dipisah eksplisit**: denda keterlambatan vs denda kerusakan/kehilangan (bisa muncul bersamaan dalam satu booking, jangan digabung jadi satu angka).

Fitur di luar tiga ini (rekap laporan, manajemen multi-cabang, marketplace publik) **belum masuk MVP** — jangan ditambahkan tanpa validasi kebutuhan dari pilot.

## 7. Skema database

Skema lengkap dan RLS policy final ada di `skema-final.sql` (bawa ke folder migrations). Poin-poin kunci:

- **Multi-tenant dari awal** — setiap vendor adalah satu baris `businesses`, semua tabel operasional di-scope via `business_id`, diisolasi lewat Postgres RLS berbasis `auth.uid() = businesses.owner_id`.
- **`business_profiles` dan `marketplace_consents` dipisah dari `businesses`** — cuma terisi kalau vendor eksplisit opt-in ke marketplace nanti. `marketplace_consents` bersifat append-only (riwayat persetujuan, bukan satu status yang ditimpa) — jangan buat policy `update`/`delete` untuk tabel ini.
- **Tabel wilayah (`provinces`, `regencies`) sengaja di-scope kecil** — cuma berisi Malang Raya untuk saat ini. Jangan bangun tabel wilayah nasional lengkap di tahap ini.
- **Tidak ada tabel `availability`** — dihitung dari agregasi `booking_items` + `bookings.status`, lihat query di bagian bawah `skema-final.sql`.

## 8. Non-goals (sengaja belum dikerjakan)

- Marketplace publik / listing lintas vendor
- Native mobile app (Android/iOS)
- Offline-first / PWA caching agresif
- Manajemen multi-cabang / multi-karyawan per vendor
- Tabel wilayah di luar Malang Raya
- Level kecamatan di data wilayah

## 9. Timeline & fase kerja saat ini

1. Validasi vendor (kunjungan fisik + DM) — berjalan paralel dengan setup teknis
2. Setup fondasi teknis (repo, Supabase, scaffolding) — **fase ini**
3. Build tiga fitur inti MVP
4. Testing internal & polish mobile UX
5. Onboarding pilot ke vendor Gelombang 1 & 2
6. Iterasi berdasarkan feedback pilot
7. (Belum dimulai) Evaluasi mulai fase marketplace — berdasarkan sinyal validasi, bukan tanggal

## 10. Konvensi kerja untuk sesi Claude Code

- Kalau ragu soal scope fitur, cek bagian 6 dan 8 di file ini dulu sebelum menambah sesuatu yang belum divalidasi.
- Perubahan skema database harus tetap menjaga prinsip di bagian 7 (multi-tenant, RLS, tidak ada tabel availability tersimpan).
- Perubahan warna/tema harus tetap pakai token di bagian 5 — jangan revert ke default dark theme atau palet generik AI (krem-terracotta, dark-neon) tanpa diskusi eksplisit.