# Backup database mingguan (manual)

Supabase project ini masih paket Free — **tidak ada backup otomatis**.
`scripts/backup-db.sh` adalah backup manual yang Andi jalankan sendiri
(disarankan sekali seminggu, lewat cron/launchd di komputernya sendiri
kalau mau dijadwalkan — bukan GitHub Action, supaya password database
tidak perlu disimpan sebagai secret di GitHub).

Menghasilkan **dua file per run**, ke folder **di luar repo ini**:

1. `sewalog-public-<timestamp>.dump` — schema `public` lengkap
   (struktur + semua data: businesses, items, bookings, dst). Ini yang
   diuji restore-nya rutin (langkah di bawah).
2. `sewalog-auth-<timestamp>.dump` — **data-only** dari `auth.users` +
   `auth.identities` (akun login vendor, termasuk hash password).
   **Sensitif** — chmod 600 otomatis oleh skrip, jangan pernah
   diunggah ke tempat terbuka (termasuk ke cloud storage publik,
   email tanpa enkripsi, dll). Tidak direstore-test rutin karena
   restore penuhnya butuh project Supabase lain dengan schema `auth`
   yang cocok, bukan Postgres polos.

**Tidak termasuk dalam backup ini**: foto/gambar di Cloudflare R2 (foto
alat, foto pelanggan/pickup, logo usaha) — itu object storage terpisah
dari database Postgres, backup-nya di luar scope skrip ini.

## Setup pertama kali

### 1. Install `pg_dump` versi yang cocok

Cek versi Postgres yang dipakai Supabase project ini: Dashboard →
Settings → Database → bagian atas biasanya menyebut versi (mis.
Postgres 15/16/17). `pg_dump` HARUS versi yang sama atau lebih baru
dari versi server — kalau lebih lama, dump bisa gagal/tidak lengkap
untuk fitur Postgres yang lebih baru.

```bash
# Ubuntu/Debian — contoh untuk Postgres 17, sesuaikan angkanya
sudo apt install postgresql-client-17

# Cek versi terpasang
pg_dump --version
```

### 2. Ambil connection string

Dashboard Supabase → **Settings → Database → Connection string**. Ada
TIGA pilihan, jangan tertukar:

- **Direct connection** (host `db.xxxxx.supabase.co`, port `5432`) —
  **JANGAN pakai ini.** Paket Free Supabase cuma menyediakan alamat
  IPv6 untuk koneksi direct (butuh add-on berbayar untuk IPv4), dan
  banyak ISP rumahan di Indonesia belum mendukung IPv6 dengan baik —
  kemungkinan besar langsung gagal connect dari komputer Andi.
- **Transaction pooler** (host `aws-...-pooler.supabase.com`, port
  `6543`) — **JANGAN pakai ini juga.** Mode pooling transaksi ini bisa
  bikin `pg_dump` gagal di tengah jalan (tidak kompatibel dengan
  prepared statement/transaksi panjang yang dipakai pg_dump).
- **Session pooler** (host `aws-...-pooler.supabase.com`, port `5432`,
  user biasanya berbentuk `postgres.<project-ref>`) — **PAKAI INI.**
  Mendukung IPv4 (jalan dari ISP mana pun) dan aman dipakai untuk
  `pg_dump`.

Connection string Session pooler bentuknya kira-kira:
`postgresql://postgres.xxxxx:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`

### 3. Set environment variable (JANGAN disimpan ke file apa pun di repo)

```bash
export SEWALOG_DB_URL='postgresql://postgres.xxxxx:...@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
export SEWALOG_BACKUP_DIR="$HOME/sewalog-backups"   # folder di luar repo, bebas pilih lokasinya
```

Tulis dua baris ini ke `~/.zshrc`/`~/.bashrc` pribadi Andi kalau mau
permanen (bukan ke file manapun di repo `saas-wedge-camp-rent`).

### 4. Jalankan

```bash
./scripts/backup-db.sh
```

Skrip menolak jalan kalau `SEWALOG_BACKUP_DIR` ternyata ada di dalam
folder repo ini (pengaman tambahan, supaya dump tidak pernah ke-`git
add` tanpa sengaja).

## Uji restore (schema public) — lakukan sekali untuk memastikan dump valid

Pakai Postgres lokal lewat Docker, **bukan** project Supabase mana pun
(supaya tidak berisiko menimpa data asli):

Versi `pg_dump`/`pg_restore` di langkah 1 (setup pertama kali) DAN versi
image Docker `postgres:NN` di bawah ini HARUS disamakan dengan versi
Postgres yang dipakai project Supabase (Dashboard → Settings →
Database) — kalau beda, ada risiko gagal/tidak lengkap seperti
dijelaskan di langkah 1. Uji end-to-end yang jadi dasar langkah-langkah
di bawah ini dilakukan dengan Postgres 16 (karena itu versi client yang
tersedia saat pengujian) — kalau project Supabase kamu memang Postgres
16, langkahnya persis sama; kalau versinya 15/17, sesuaikan nomor versi
di semua tempat (apt install, docker image) tapi URUTAN langkahnya
(pre-data → data → isi stub auth.users → post-data) tetap berlaku.

```bash
# 1. Postgres kosong sementara
docker run --rm -d --name sewalog-restore-test \
  -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:17   # samakan versi dgn pg_dump di atas

# tunggu beberapa detik sampai siap
sleep 5

# 2. Database baru buat uji
PGPASSWORD=test createdb -h localhost -p 5433 -U postgres sewalog_test
```

**3. Siapkan dulu hal-hal yang di production disediakan Supabase sendiri**
(role, schema `auth`, dan fungsi `auth.uid()`/`auth.jwt()` yang dipakai
banyak RLS policy & fungsi security-definer) — Postgres polos tidak
punya semua ini secara bawaan. Tanpa langkah ini, `pg_restore` di
langkah 4 akan penuh error yang membingungkan (FK ke `auth.users`,
fungsi yang panggil `auth.uid()`, policy yang sebut role `anon`/
`authenticated`):

```bash
PGPASSWORD=test psql -h localhost -p 5433 -U postgres -d sewalog_test <<'EOF'
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create or replace function auth.jwt() returns jsonb language sql as $$ select null::jsonb $$;
EOF
```

**4. Restore DALAM TIGA TAHAP** (`--section=pre-data`, lalu isi stub
`auth.users`, baru `--section=data` dan `--section=post-data`) — BUKAN
satu `pg_restore` langsung ke seluruh file. Alasannya: FK ke
`auth.users` (owner_id, business_members.user_id, dll — lihat
`grep -rn "references auth.users" migrations/*.sql`) baru ditambahkan
di tahap **post-data** (setelah semua baris data dimuat), tapi stub
`auth.users` kosong di langkah 3 cuma punya 0 baris — kalau direstore
sekaligus, SEMUA baris yang owner_id/user_id-nya tidak ada di stub
kosong itu akan gagal dengan "violates foreign key constraint". Diuji
end-to-end (lihat catatan di bawah) — urutan ini yang BENAR-BENAR
menghasilkan nol error, bukan cuma teori:

```bash
# 4a. pre-data (schema: tabel, kolom — belum ada FK/index/constraint)
PGPASSWORD=test pg_restore -h localhost -p 5433 -U postgres \
  -d sewalog_test --no-owner --no-privileges --section=pre-data \
  "$SEWALOG_BACKUP_DIR/sewalog-public-<timestamp>.dump"
# Satu baris error "schema \"public\" already exists" DIHARAPKAN muncul
# di sini dan AMAN diabaikan — setiap database Postgres baru sudah
# punya schema public bawaan, pg_dump tetap menyertakan CREATE SCHEMA-
# nya. Ini satu-satunya error yang boleh muncul di seluruh proses ini.

# 4b. muat semua data tabel (belum ada FK yang mengecek)
PGPASSWORD=test pg_restore -h localhost -p 5433 -U postgres \
  -d sewalog_test --no-owner --no-privileges --section=data \
  "$SEWALOG_BACKUP_DIR/sewalog-public-<timestamp>.dump"

# 4c. isi stub auth.users dengan SEMUA uuid yang dipakai data yang baru
# dimuat (owner_id, business_members.user_id, business_invites.created_by/
# used_by, booking_status_history.changed_by, items.created_by/updated_by/
# deactivated_by) — SEBELUM tahap post-data menambahkan FK-nya.
PGPASSWORD=test psql -h localhost -p 5433 -U postgres -d sewalog_test <<'EOF'
insert into auth.users (id)
select distinct owner_id from businesses where owner_id is not null
union select distinct user_id from business_members where user_id is not null
union select distinct created_by from business_invites where created_by is not null
union select distinct used_by from business_invites where used_by is not null
union select distinct changed_by from booking_status_history where changed_by is not null
union select distinct created_by from items where created_by is not null
union select distinct updated_by from items where updated_by is not null
union select distinct deactivated_by from items where deactivated_by is not null
on conflict do nothing;
EOF

# 4d. post-data (FK, index, constraint — sekarang auth.users stub-nya
# sudah terisi, jadi tidak ada lagi yang gagal)
PGPASSWORD=test pg_restore -h localhost -p 5433 -U postgres \
  -d sewalog_test --no-owner --no-privileges --section=post-data \
  "$SEWALOG_BACKUP_DIR/sewalog-public-<timestamp>.dump"
```

```bash
# 5. Pembuktian: data benar-benar ada
PGPASSWORD=test psql -h localhost -p 5433 -U postgres -d sewalog_test \
  -c "select count(*) from businesses;" \
  -c "select count(*) from bookings;"

# 6. Bersihkan
docker stop sewalog-restore-test
```

**Hasil yang benar**: langkah 4a-4d selesai TANPA error SAMA SEKALI,
kecuali satu baris "schema public already exists" di 4a (dijelaskan di
atas, selalu muncul, selalu aman). Error lain apa pun artinya ada
sesuatu di schema production yang belum tercakup stub `auth` di
langkah 3 — jangan diabaikan, cari tahu dulu. Angka `count` di langkah
5 harus cocok/mendekati jumlah data di production (cek lewat dashboard
Supabase atau REST). Ulangi uji ini sesekali (tidak perlu tiap minggu)
untuk memastikan proses restore masih bekerja seiring waktu — terutama
kalau ada migration baru yang menambah kolom/FK baru ke `auth.users`,
karena daftar kolom di langkah 4c perlu disesuaikan.

**Catatan verifikasi**: urutan 4 tahap di atas sudah diuji end-to-end
sebelum ditulis ke sini — menjalankan SEMUA file di `migrations/` dari
awal ke Postgres 16 lokal (embedded, bukan Supabase), isi beberapa
baris data contoh, `pg_dump --schema=public` dari situ, lalu restore
persis dengan urutan 4a-4d di atas ke database kedua, sampai benar-
benar nol error (selain baris "schema public" yang disebut di atas) dan
semua angka count cocok persis dengan sumbernya.

File `sewalog-auth-*.dump` TIDAK diuji dengan cara di atas — restore
penuhnya cuma masuk akal ke project Supabase lain yang sudah punya
schema `auth` bawaan Supabase. Simpan saja dengan aman (chmod 600
sudah otomatis); kalau suatu saat benar-benar perlu direstore, itu
lewat `pg_restore` ke project Supabase pengganti, bukan Postgres polos.
