-- ============================================================
-- Migration 044 — Fitur langganan berbayar: skema + penegakan DB
-- ============================================================
-- PENTING — kenapa migration ini SELURUHNYA ditulis idempotent: sebuah
-- versi LAMA/BELUM DIPERBAIKI file ini (sebelum beberapa ronde review
-- -c1 di bawah) SEMPAT dijalankan Andi tanpa sadar sebelum nomornya
-- di-rename dari 043 ke 044 — ketahuan 31 Okt 2026 saat 044 (versi
-- sudah diperbaiki) gagal jalan dengan "relation app_admins already
-- exists". Artinya state live SAAT INI adalah CAMPURAN: tabel/beberapa
-- function versi LAMA sudah ada (termasuk celah demo-spoof di
-- business_is_writable yang baru diperbaiki di sini, DAN kemungkinan
-- policy subscription_payments versi lama yang salah scope), sementara
-- `set_subscription_plan` BELUM ada sama sekali. Migration ini HARUS
-- aman dijalankan ke state campuran itu (menimpa yang versi lama,
-- menambah yang belum ada) MAUPUN ke database bersih dari awal — setiap
-- `create table`/`create policy`/`create trigger` di bawah karena itu
-- memakai `if not exists`/`drop ... if exists` dulu, bukan diasumsikan
-- belum ada.
--
-- Rencana lengkap: research/subscription-brief-2026-10.md. Review -c1
-- (31 Okt 2026) poin 1: penegakan hanya-baca TIDAK CUKUP di Express saja
-- — frontend menulis LANGSUNG ke Supabase di beberapa tempat (useItems.ts
-- insert/update item, bookings/booking_items insert dari NewBookingModal
-- via backend tapi beberapa hook lain lewat klien langsung), jadi
-- penegak SEBENARNYA harus di DB (RLS INSERT/UPDATE policy), bukan cuma
-- endpoint Express. Helper TS `getSubscriptionStatus()` (tahap
-- implementasi berikutnya) tetap ada untuk UI/pesan ramah, tapi DB yang
-- benar-benar menegakkan.

-- --------------------------------------------------------------
-- 1. app_admins — siapa yang boleh pakai Alat Admin (poin 2 review)
-- --------------------------------------------------------------
-- Pola SAMA PERSIS dengan private_config (migration 037): RLS on, NOL
-- policy — tidak ada baris yang bisa dibaca lewat PostgREST oleh siapa
-- pun (termasuk authenticated), cuma bisa dibaca dari DALAM function
-- security definer yang bypass RLS. Key by user_id (bukan email di JWT)
-- — email bisa berubah, dan menambah admin baru nanti tidak perlu
-- migration lagi, cukup insert baris baru.
create table if not exists app_admins (
  user_id     uuid primary key references auth.users(id),
  added_at    timestamptz not null default now()
);

alter table app_admins enable row level security;
-- TIDAK ADA policy sama sekali — sengaja, bukan lupa.
revoke all on app_admins from public, anon, authenticated;

-- Andi mengisi baris pertama manual lewat SQL editor SETELAH migration
-- ini jalan — akun admin: sewalogdotcomcorp@gmail.com (dikonfirmasi
-- langsung, 31 Okt 2026). Dicari by email sekali di sini (bukan di-
-- hardcode uuid-nya di migration ini, yang disimpan di tabel cuma
-- user_id, bukan email):
--   insert into app_admins (user_id) select id from auth.users where email = 'sewalogdotcomcorp@gmail.com';
-- PENTING: akun itu harus SUDAH PERNAH daftar/login ke app minimal
-- sekali SEBELUM query ini dijalankan (baris auth.users baru ada setelah
-- itu) — kalau query di atas insert 0 baris, itu tandanya belum, Andi
-- login dulu pakai akun itu lalu jalankan ulang query-nya.

create or replace function is_app_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

-- --------------------------------------------------------------
-- 2. subscriptions + subscription_payments
-- --------------------------------------------------------------
create table if not exists subscriptions (
  business_id   uuid primary key references businesses(id),
  plan          text, -- null sampai paket diputuskan 4-7 Des 2026
  active_until  date not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table subscriptions enable row level security;

-- SELECT untuk member (owner+karyawan) — karyawan perlu tahu status ini
-- juga untuk banner "hubungi pemilik" (rencana poin 6/8). TIDAK ADA
-- policy INSERT/UPDATE untuk klien manapun — satu-satunya jalur tulis
-- adalah trigger (bagian 4) dan record_subscription_payment() (bagian 5),
-- keduanya security definer, bukan tulis langsung dari frontend/backend.
drop policy if exists "members_select_own_subscription" on subscriptions;
create policy "members_select_own_subscription"
  on subscriptions for select
  using (is_member_of(business_id));

create table if not exists subscription_payments (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id),
  amount              numeric not null,
  period_start        date not null,
  period_end          date not null,
  method              text,
  recorded_by_email   text not null,
  note                text,
  proof_url           text,
  created_at          timestamptz not null default now()
);

alter table subscription_payments enable row level security;

-- Review -c1 poin 3: nominal pembayaran bukan urusan karyawan — cuma
-- owner yang boleh lihat subscription_payments (beda dari subscriptions
-- sendiri yang tetap is_member_of, karena karyawan perlu tahu status
-- aktif/tenggang/hanya-baca untuk banner "hubungi pemilik"). Drop dulu
-- nama yang sama — versi LAMA migration ini (sempat live tanpa sadar,
-- lihat catatan di kepala file) mungkin membuat policy ini dengan scope
-- is_member_of yang salah; drop+create ulang di sini menimpanya ke
-- versi yang benar terlepas dari apa isi lamanya.
drop policy if exists "members_select_own_subscription_payments" on subscription_payments;
drop policy if exists "owner_select_own_subscription_payments" on subscription_payments;
create policy "owner_select_own_subscription_payments"
  on subscription_payments for select
  using (is_owner_of(business_id));

-- Review -c1 poin 3: TIDAK ADA policy insert/update/delete di tabel ini
-- sama sekali — satu-satunya jalur tulis adalah record_subscription_
-- payment() (bagian 5), supaya insert pembayaran + perpanjangan
-- active_until SELALU atomic dalam satu transaksi, bukan dua write
-- terpisah dari klien yang bisa gagal di tengah jalan.

-- --------------------------------------------------------------
-- 3. business_is_writable() — satu-satunya sumber kebenaran status
-- --------------------------------------------------------------
-- Dipakai di WITH CHECK policy INSERT/UPDATE tabel kerja (bagian 6) DAN
-- bisa dipanggil dari backend/RPC publik (get_public_ordering_page,
-- create_booking_request) untuk alasan yang sama (poin 5 review).
--
-- Tanggal dihitung via WIB (Asia/Jakarta) langsung di SQL, BUKAN
-- UTC/local server — konsisten dengan todayInWIB() di backend/src/lib/
-- dates.ts (CLAUDE.md bagian 4), supaya satu business tidak berubah
-- status pas tengah malam WIB tergantung timezone container Postgres.
--
-- Akun demo (demo.pemilik@sewalog.test) DIKECUALIKAN secara eksplisit —
-- demo publik tidak boleh pernah ke-lock, independen dari active_until
-- apa pun yang tersimpan untuknya.
--
-- Review -c1 [KRITIS]: pengecekan ini TIDAK BOLEH baca business_members.
-- email — kolom itu SNAPSHOT yang diisi KLIEN sendiri saat onboarding
-- (OnboardingScreen.tsx mengirim `email: ownerEmail` apa adanya, dan
-- policy insert_self_via_valid_invite/insert business pertama tidak
-- pernah memverifikasi kecocokannya ke email login sungguhan) — vendor
-- mana pun bisa mengirim payload insert dengan email itu dan KLAIM
-- dirinya "demo", lalu TIDAK PERNAH jadi hanya-baca selamanya. Harus
-- dicocokkan ke `auth.users.email` (sumber asli dari provider auth,
-- tidak bisa dipalsukan klien) via join ke user_id, BUKAN ke kolom
-- snapshot. (Pola `reset_demo_bookings`, migration 036, SUDAH benar
-- dari awal — ia mencocokkan ke `auth.jwt() ->> 'email'`, klaim JWT
-- bertanda tangan dari server auth, bukan kolom tabel manapun, jadi
-- TIDAK rentan masalah yang sama — dikonfirmasi eksplisit di sini,
-- bukan diasumsikan.)
--
-- Business TANPA baris subscriptions sama sekali (seharusnya cuma bisa
-- terjadi untuk data lama dari sebelum migration ini, backfill di
-- bagian 7 seharusnya menutup semua celah itu) dianggap AKTIF + catat
-- WARNING di log Postgres — JANGAN PERNAH diam-diam jadi hanya-baca
-- cuma karena baris konfigurasinya hilang (itu bug infrastruktur, bukan
-- alasan mengunci vendor).
create or replace function business_is_writable(p_business_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  is_demo boolean;
  sub record;
  today_wib date;
begin
  select exists (
    select 1
    from business_members bm
    join auth.users u on u.id = bm.user_id
    where bm.business_id = p_business_id
      and bm.role = 'owner'
      and lower(u.email) = 'demo.pemilik@sewalog.test'
  ) into is_demo;

  if is_demo then
    return true;
  end if;

  select * into sub from subscriptions where business_id = p_business_id;
  if sub is null then
    raise warning 'business_is_writable: business % tidak punya baris subscriptions, dianggap aktif', p_business_id;
    return true;
  end if;

  today_wib := (now() at time zone 'Asia/Jakarta')::date;
  -- Masa tenggang 7 hari setelah active_until lewat (rencana: "aktif" ->
  -- "tenggang" -> "hanya-baca" mulai hari ke-8). Tenggang TETAP writable
  -- (cuma hanya-baca yang mengunci), jadi batasnya active_until + 7.
  return today_wib <= (sub.active_until + 7);
end;
$$;

revoke all on function business_is_writable(uuid) from public, anon;
grant execute on function business_is_writable(uuid) to authenticated, anon;

-- --------------------------------------------------------------
-- 4. Trial 14 hari untuk business baru (poin 4 review)
-- --------------------------------------------------------------
-- Angka 14 ditulis sebagai SATU fungsi (bukan ditulis berulang di
-- banyak tempat) supaya gampang diubah nanti kalau keputusan Andi
-- 4-7 Des beda — rename/update function ini saja, bukan cari semua
-- pemakaian "14".
create or replace function default_trial_active_until()
returns date
language sql
stable
as $$
  -- greatest('2026-12-31', hari ini + 14) — business yang daftar SAAT
  -- promo gratis masih berjalan tetap dapat sampai akhir promo (bukan
  -- cuma 14 hari dari hari daftarnya kalau itu lebih pendek dari sisa
  -- promo), business yang daftar SETELAH promo berakhir dapat trial 14
  -- hari penuh dari hari itu.
  select greatest('2026-12-31'::date, ((now() at time zone 'Asia/Jakarta')::date) + 14);
$$;

create or replace function create_subscription_for_new_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into subscriptions (business_id, active_until)
  values (new.id, default_trial_active_until());
  return new;
end;
$$;

drop trigger if exists businesses_create_subscription on businesses;
create trigger businesses_create_subscription
  after insert on businesses
  for each row
  execute function create_subscription_for_new_business();

-- --------------------------------------------------------------
-- 5. record_subscription_payment — SATU-SATUNYA jalur tulis pembayaran
-- --------------------------------------------------------------
-- is_app_admin() check (poin 2/3 review) — atomic: insert baris
-- pembayaran + perpanjang active_until dalam SATU transaksi function.
--
-- Review -c1 poin 2: active_until bersifat INKLUSIF (hari itu sendiri
-- MASIH aktif) — periode baru harus mulai TEPAT SEHARI SETELAH
-- active_until lama, bukan DI HARI YANG SAMA, supaya hari itu tidak
-- terhitung dua kali setiap kali diperpanjang. `period_start` = yang
-- lebih besar antara (active_until lama + 1) vs hari ini WIB — kalau
-- masih aktif/tenggang jauh ke depan, lanjut PERSIS dari situ; kalau
-- sudah lama lewat (hanya-baca berkepanjangan), mulai dari hari ini,
-- bukan dari tanggal lama yang sudah lewat jauh. `period_end` =
-- `period_start + p_period_days - 1` (inklusif juga, N hari = N hari
-- kalender, bukan N+1) — `active_until` baru = `period_end` ini.
create or replace function record_subscription_payment(
  p_business_id uuid,
  p_amount numeric,
  p_period_days int,
  p_method text,
  p_note text,
  p_proof_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_email text;
  current_active_until date;
  new_active_until date;
  period_start_date date;
begin
  if not is_app_admin() then
    raise exception 'record_subscription_payment: tidak berhak';
  end if;

  if p_period_days < 1 or p_period_days > 400 then
    raise exception 'record_subscription_payment: p_period_days di luar rentang wajar (1-400)';
  end if;
  if p_amount < 0 then
    raise exception 'record_subscription_payment: p_amount tidak boleh negatif';
  end if;

  select lower(auth.jwt() ->> 'email') into admin_email;

  select active_until into current_active_until from subscriptions where business_id = p_business_id;
  if current_active_until is null then
    raise exception 'record_subscription_payment: business % belum punya baris subscriptions', p_business_id;
  end if;

  period_start_date := greatest(current_active_until + 1, (now() at time zone 'Asia/Jakarta')::date);
  new_active_until := period_start_date + p_period_days - 1;

  insert into subscription_payments (
    business_id, amount, period_start, period_end, method, recorded_by_email, note, proof_url
  ) values (
    p_business_id, p_amount, period_start_date, new_active_until, p_method, coalesce(admin_email, 'unknown'), p_note, p_proof_url
  );

  update subscriptions
  set active_until = new_active_until, updated_at = now()
  where business_id = p_business_id;
end;
$$;

revoke all on function record_subscription_payment(uuid, numeric, int, text, text, text) from public, anon;
grant execute on function record_subscription_payment(uuid, numeric, int, text, text, text) to authenticated;

-- Review -c1 poin 4: belum ada jalur admin mengubah PAKET business
-- (terpisah dari mencatat pembayaran — mis. upgrade paket tanpa
-- pembayaran baru hari itu, atau koreksi salah pilih paket). RPC
-- terpisah, bukan parameter tambahan di record_subscription_payment,
-- supaya ganti paket tidak harus selalu dibarengi catatan pembayaran
-- (dua aksi yang secara makna beda, meski sering terjadi bersamaan).
create or replace function set_subscription_plan(p_business_id uuid, p_plan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_app_admin() then
    raise exception 'set_subscription_plan: tidak berhak';
  end if;

  if not exists (select 1 from subscriptions where business_id = p_business_id) then
    raise exception 'set_subscription_plan: business % belum punya baris subscriptions', p_business_id;
  end if;

  update subscriptions
  set plan = p_plan, updated_at = now()
  where business_id = p_business_id;
end;
$$;

revoke all on function set_subscription_plan(uuid, text) from public, anon;
grant execute on function set_subscription_plan(uuid, text) to authenticated;

-- --------------------------------------------------------------
-- 6. Penegakan di RLS tabel kerja — items/bookings/booking_items/customers
-- --------------------------------------------------------------
-- Review -c1 poin 1: grep SEMUA jalur tulis (frontend .insert/.update
-- langsung ke Supabase + semua route Express) sudah dilakukan sebelum
-- migration ini ditulis — daftar lengkap dikirim terpisah ke -c1 bareng
-- migration ini untuk ditinjau. Ringkasan keputusan DIKUNCI vs TETAP
-- TERBUKA:
--
-- DIKUNCI (business_is_writable WAJIB true):
--   - items: INSERT (alat baru, termasuk dari impor Excel) & UPDATE
--     (edit harga/stok/reaktivasi, termasuk dari impor) — "Catat
--     transaksi baru, tambah/ubah/impor alat: Dikunci".
--   - bookings: INSERT (transaksi baru) — "Catat transaksi baru: Dikunci".
--   - booking_items: INSERT (baris alat transaksi baru, SELALU bareng
--     bookings INSERT di atas).
--   - customers: INSERT (pelanggan baru, SELALU bareng bookings INSERT
--     kalau pelanggan belum pernah ada).
--   - create_booking_request (bagian 7 di bawah) & get_public_ordering_page
--     (bagian 7) — "Pesanan online baru: Mati".
--
-- TETAP TERBUKA (TIDAK dikunci, tidak boleh ikut business_is_writable):
--   - bookings: UPDATE (pickup/return/cancel — "Selesaikan transaksi
--     berjalan: Boleh").
--   - deposits, penalties, booking_status_history: SEMUA operasi (tidak
--     disentuh sama sekali di migration ini) — "boleh" eksplisit di
--     rencana, melepas jaminan & catat denda bagian dari menyelesaikan
--     transaksi berjalan.
--   - reject_booking_request RPC, get_booking_request_status (halaman
--     status pelanggan) — "Tolak pesanan yang sudah masuk; link status
--     pelanggan: Boleh".
--   - customers: UPDATE/DELETE, items: DELETE, bookings: DELETE (tidak
--     ada jalur kode yang memakainya saat ini — dibiarkan is_member_of
--     saja, tidak digerbangi business_is_writable, supaya tidak
--     mengunci sesuatu yang belum tentu perlu dikunci).
--   - businesses (Info Usaha), public_pages (pengaturan Etalase/Pesanan
--     Online), business_members/business_invites (undang karyawan) —
--     TIDAK disebutkan di tabel rencana sama sekali, SENGAJA tidak
--     disentuh migration ini. **Perlu konfirmasi -c1/Andi**: apakah
--     vendor hanya-baca tetap boleh mengubah pengaturan Etalase (mis.
--     matikan Pesanan Online, ganti info bayar) dan mengundang karyawan
--     baru? Rencana brief tidak eksplisit menyebut ini — saya TIDAK
--     mengunci keduanya di migration ini sampai dikonfirmasi, supaya
--     tidak mengunci sesuatu yang tidak diminta.

-- Drift ditemukan lewat pg_policies live (dicek Andi, 31 Okt 2026): tabel
-- items/customers/bookings/booking_items TERNYATA sudah punya policy
-- insert/update/delete TERPISAH (members_insert_own_X/members_update_own_X/
-- members_delete_own_X, 16 baris total) — BUKAN policy "for all" seperti
-- migration 007/skema-final.sql menyatakannya, dan TIDAK ADA migration file
-- di repo ini yang membuat split itu (perubahan tak terdokumentasi, entah
-- dibuat manual lewat SQL editor kapan). Nama policy-nya PERSIS sama
-- dengan yang migration ini coba buat, jadi `create policy` di bawah akan
-- gagal "already exists" tanpa drop eksplisit dulu. Isi lama policy itu
-- tidak diketahui (tidak ada catatannya), tapi karena semuanya di-drop
-- lalu dibuat ulang versi migration ini, hasil akhirnya sama persis
-- terlepas dari isi lamanya — aman. Policy SELECT (members_select_own_X)
-- TIDAK disentuh sama sekali di sini, cuma insert/update/delete.
drop policy if exists "members_modify_own_items" on items;
drop policy if exists "members_insert_own_items" on items;
drop policy if exists "members_update_own_items" on items;
drop policy if exists "members_delete_own_items" on items;
create policy "members_insert_own_items"
  on items for insert
  with check (is_member_of(business_id) and business_is_writable(business_id));
create policy "members_update_own_items"
  on items for update
  using (is_member_of(business_id))
  with check (is_member_of(business_id) and business_is_writable(business_id));
create policy "members_delete_own_items"
  on items for delete
  using (is_member_of(business_id));

drop policy if exists "members_modify_own_customers" on customers;
drop policy if exists "members_insert_own_customers" on customers;
drop policy if exists "members_update_own_customers" on customers;
drop policy if exists "members_delete_own_customers" on customers;
create policy "members_insert_own_customers"
  on customers for insert
  with check (is_member_of(business_id) and business_is_writable(business_id));
create policy "members_update_own_customers"
  on customers for update
  using (is_member_of(business_id))
  with check (is_member_of(business_id));
create policy "members_delete_own_customers"
  on customers for delete
  using (is_member_of(business_id));

drop policy if exists "members_modify_own_bookings" on bookings;
drop policy if exists "members_insert_own_bookings" on bookings;
drop policy if exists "members_update_own_bookings" on bookings;
drop policy if exists "members_delete_own_bookings" on bookings;
create policy "members_insert_own_bookings"
  on bookings for insert
  with check (is_member_of(business_id) and business_is_writable(business_id));
create policy "members_update_own_bookings"
  on bookings for update
  using (is_member_of(business_id))
  with check (is_member_of(business_id));
create policy "members_delete_own_bookings"
  on bookings for delete
  using (is_member_of(business_id));

drop policy if exists "members_modify_own_booking_items" on booking_items;
drop policy if exists "members_insert_own_booking_items" on booking_items;
drop policy if exists "members_update_own_booking_items" on booking_items;
drop policy if exists "members_delete_own_booking_items" on booking_items;
create policy "members_insert_own_booking_items"
  on booking_items for insert
  with check (
    booking_id in (
      select id from bookings where is_member_of(business_id) and business_is_writable(business_id)
    )
  );
create policy "members_update_own_booking_items"
  on booking_items for update
  using (booking_id in (select id from bookings where is_member_of(business_id)))
  with check (booking_id in (select id from bookings where is_member_of(business_id)));
create policy "members_delete_own_booking_items"
  on booking_items for delete
  using (booking_id in (select id from bookings where is_member_of(business_id)));

-- Review -c1 ronde 2: undang karyawan baru dihitung "kerja baru" (dikunci),
-- tapi MENGHAPUS/menonaktifkan karyawan TETAP terbuka (business_members
-- tidak disentuh sama sekali — pemilik harus selalu bisa mencabut akses,
-- alasan keamanan, independen dari status langganan). public_pages dan
-- businesses (Info Usaha) JUGA sengaja TETAP terbuka penuh — vendor
-- hanya-baca tetap boleh ubah telepon/alamat atau matikan Pesanan Online;
-- menyalakannya pun tidak berisiko karena `writable` sudah menyembunyikan
-- form pesanan di sisi publik (bagian 7).
-- Review -c1 ronde 3 [PENTING]: policy insert `business_invites` yang
-- SEBENARNYA live BUKAN "members_create_invites" dari migration 007 lagi
-- — migration 014 (Kelola Usaha owner-only) sudah MENGGANTINYA jadi
-- "owner_create_invites" (is_owner_of, bukan is_member_of — undang
-- karyawan sengaja owner-only, karyawan tidak boleh undang karyawan
-- lain). Draft sebelumnya di sini salah drop nama yang sudah tidak ada
-- (007) lalu BUAT ULANG nama lama (members_create_invites) dengan
-- is_member_of — ini DUA kesalahan sekaligus: (1) meregresi fix keamanan
-- 014 (karyawan jadi bisa undang karyawan lagi), (2) "owner_create_invites"
-- yang asli TETAP ada berdampingan (RLS OR antar-policy), jadi penguncian
-- hanya-baca di sini tidak akan berlaku SAMA SEKALI (sama persis pola bug
-- drift yang baru saja ditemukan di items/customers/bookings/
-- booking_items). Pelajaran: SELALU grep semua file migration untuk
-- policy yang mau diubah, cari yang TERAKHIR menyentuhnya — jangan
-- asumsikan migration yang membuatnya pertama kali masih berlaku.
drop policy if exists "members_create_invites" on business_invites;
drop policy if exists "owner_create_invites" on business_invites;
create policy "owner_create_invites"
  on business_invites for insert
  with check (is_owner_of(business_id) and created_by = auth.uid() and business_is_writable(business_id));

-- --------------------------------------------------------------
-- 7. Etalase publik: sembunyikan cek-stok+tombol pesan kalau hanya-baca
-- --------------------------------------------------------------
-- Review -c1 poin 5: get_public_ordering_page (039) & get_public_page
-- (019) perlu tahu business_is_writable supaya JS klien bisa
-- menyembunyikan tombol "Cek Ketersediaan"/"Pesan Sekarang" kalau
-- hanya-baca ("Etalase publik: Tampil, TANPA cek stok & tombol pesan").
-- create_booking_request (037) JUGA ditolak kalau tidak writable —
-- defense in depth, pola sama seperti accept_online_orders check yang
-- sudah ada di situ.
create or replace function get_public_ordering_page(p_slug text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result json;
begin
  select json_build_object(
    'business_id', pp.business_id,
    'pay_transfer_enabled', pp.pay_transfer_enabled,
    'pay_qris_enabled', pp.pay_qris_enabled,
    'pay_cash_enabled', pp.pay_cash_enabled,
    'writable', business_is_writable(pp.business_id)
  )
  into result
  from public_pages pp
  where pp.slug = p_slug
    and pp.published = true
    and pp.accept_online_orders = true;

  return result;
end;
$$;

revoke all on function get_public_ordering_page(text) from public, authenticated;
grant execute on function get_public_ordering_page(text) to anon;

create or replace function get_public_page(p_slug text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result json;
begin
  select json_build_object(
    'business_name', b.name,
    'logo_url', b.logo_url,
    'description', pp.description,
    'address', pp.address,
    'regency_name', r.name,
    'operating_hours', pp.operating_hours,
    'public_phone', pp.public_phone,
    'writable', business_is_writable(pp.business_id),
    'items', (
      select coalesce(json_agg(
        json_build_object(
          'id', i.id,
          'name', i.name,
          'category', i.category,
          'price_per_day', i.price_per_day,
          'day2_rate', i.day2_rate,
          'day3_rate', i.day3_rate,
          'day4_rate', i.day4_rate,
          'day5_rate', i.day5_rate,
          'extra_day_rate', i.extra_day_rate,
          'image_url', i.image_url,
          'variant', i.variant,
          'size', i.size,
          'color', i.color
        )
        order by i.name
      ), '[]'::json)
      from items i
      where i.business_id = pp.business_id
        and i.deactivated_at is null
    )
  )
  into result
  from public_pages pp
  join businesses b on b.id = pp.business_id
  left join regencies r on r.id = pp.regency_id
  where pp.slug = p_slug
    and pp.published = true;

  return result;
end;
$$;

grant execute on function get_public_page(text) to anon, authenticated;

create or replace function create_booking_request(
  p_secret text,
  p_business_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_start_date date,
  p_end_date date,
  p_estimated_price numeric,
  p_payment_method text,
  p_dp_amount numeric,
  p_expires_at timestamptz,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_secret text;
  page record;
  new_id uuid;
  total_qty int;
  bad_item_count int;
  today_wib date;
begin
  select value into expected_secret from private_config where key = 'booking_request_secret';
  if expected_secret is null or p_secret is distinct from expected_secret then
    raise exception 'create_booking_request: secret tidak valid';
  end if;

  select * into page from public_pages where business_id = p_business_id;
  if page is null or page.published is not true or page.accept_online_orders is not true then
    raise exception 'create_booking_request: etalase/pesanan online tidak aktif untuk business ini';
  end if;

  -- Review -c1 poin 5: defense in depth — business hanya-baca tidak
  -- boleh menerima pesanan online baru sama sekali ("Pesanan online
  -- baru: Mati"), independen dari apakah frontend sudah menyembunyikan
  -- tombolnya atau belum.
  if not business_is_writable(p_business_id) then
    raise exception 'create_booking_request: toko ini sedang tidak menerima pesanan baru';
  end if;

  if p_payment_method is null or (
    (p_payment_method = 'transfer' and page.pay_transfer_enabled is not true) or
    (p_payment_method = 'qris' and page.pay_qris_enabled is not true) or
    (p_payment_method = 'cash' and page.pay_cash_enabled is not true)
  ) then
    raise exception 'create_booking_request: cara bayar tidak diaktifkan vendor ini';
  end if;

  today_wib := (now() + interval '7 hours')::date;
  if p_start_date < today_wib then
    raise exception 'create_booking_request: tanggal ambil sudah lewat';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '7 days' then
    raise exception 'create_booking_request: expires_at di luar rentang wajar';
  end if;

  if char_length(p_customer_name) < 1 or char_length(p_customer_name) > 100
     or char_length(p_customer_phone) < 1 or char_length(p_customer_phone) > 30
     or (p_note is not null and char_length(p_note) > 500) then
    raise exception 'create_booking_request: panjang field tidak valid';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'create_booking_request: minimal satu alat';
  end if;

  select coalesce(sum((elem->>'quantity')::int), 0) into total_qty
  from jsonb_array_elements(p_items) as elem;
  if total_qty < 1 or total_qty > 20 then
    raise exception 'create_booking_request: total jumlah alat di luar batas (1-20)';
  end if;

  select count(*) into bad_item_count
  from jsonb_array_elements(p_items) as elem
  where not exists (
    select 1 from items i
    where i.id = (elem->>'item_id')::uuid
      and i.business_id = p_business_id
      and i.deactivated_at is null
  ) or (elem->>'quantity')::int < 1 or (elem->>'quantity')::int > 20;
  if bad_item_count > 0 then
    raise exception 'create_booking_request: ada alat tidak valid/tidak aktif/qty di luar batas';
  end if;

  insert into booking_requests (
    business_id, customer_name, customer_phone, note, start_date, end_date,
    estimated_price, payment_method, dp_amount, expires_at
  ) values (
    p_business_id, p_customer_name, p_customer_phone, p_note, p_start_date, p_end_date,
    p_estimated_price, p_payment_method, p_dp_amount, p_expires_at
  )
  returning id into new_id;

  insert into booking_request_items (booking_request_id, item_id, quantity)
  select new_id, (elem->>'item_id')::uuid, (elem->>'quantity')::int
  from jsonb_array_elements(p_items) as elem;

  return new_id;
end;
$$;

revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb) from public;
revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb) from authenticated;
grant execute on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb) to anon;

-- --------------------------------------------------------------
-- 8. Backfill business existing — semua dapat active_until = 2026-12-31
-- --------------------------------------------------------------
insert into subscriptions (business_id, active_until)
select id, '2026-12-31'::date
from businesses
on conflict (business_id) do nothing;

select pg_notify('pgrst', 'reload schema');

-- --------------------------------------------------------------
-- 9. Verifikasi keras — gagalkan migration kalau DROP POLICY di atas
--    diam-diam tidak menangkap apa pun (review -c1 ronde 2)
-- --------------------------------------------------------------
-- `drop policy if exists "members_modify_own_items"` dkk di bagian 6
-- TIDAK error kalau nama policy yang live di DB ternyata beda dari yang
-- diasumsikan di sini (ada backlog "migration 007 drift" yang belum
-- dikonfirmasi) — kalau itu terjadi, policy "for all" LAMA tetap aktif
-- berdampingan dengan policy BARU, dan karena RLS Postgres bersifat OR
-- antar-policy untuk perintah yang sama, cukup SATU policy permisif lama
-- membuat seluruh penguncian hanya-baca di migration ini TIDAK PUNYA
-- EFEK SAMA SEKALI — tanpa error apa pun yang kelihatan. Blok ini
-- menggagalkan migration secara eksplisit kalau itu terjadi, daripada
-- lolos diam-diam dengan ilusi aman.
do $$
begin
  if exists (select 1 from pg_policies where tablename in ('items','customers','bookings','booking_items') and cmd = 'ALL') then
    raise exception 'migration 044: policy for-all lama masih ada di salah satu tabel — DROP POLICY di atas tidak menangkap nama policy yang sebenarnya live, cek pg_policies manual';
  end if;

  -- Review -c1 ronde 3: pastikan cuma SATU policy insert yang tersisa di
  -- business_invites (owner_create_invites, yang baru saja dibuat ulang
  -- dengan business_is_writable) — kalau ada policy insert LAIN yang
  -- masih hidup berdampingan (nama lama yang tidak ketahuan, pola persis
  -- sama seperti bug di atas), itu di-OR-kan dengan RLS dan penguncian
  -- hanya-baca untuk undangan karyawan tidak akan berlaku.
  if exists (
    select 1 from pg_policies
    where tablename = 'business_invites' and cmd = 'INSERT' and policyname <> 'owner_create_invites'
  ) then
    raise exception 'migration 044: ada policy INSERT lain di business_invites selain owner_create_invites — cek pg_policies manual sebelum lanjut';
  end if;

  -- Ditambahkan setelah ketahuan versi LAMA/belum-diperbaiki file ini
  -- sempat live tanpa sadar (lihat catatan di kepala file) — CREATE OR
  -- REPLACE di atas seharusnya sudah menimpa definisi lama, tapi
  -- buktikan eksplisit di sini (bukan cuma percaya function-nya ADA)
  -- bahwa versi yang benar-benar mendarat memang versi fix auth.users
  -- (poin 1 review -c1), bukan versi lama yang masih rentan demo-spoof.
  if position('auth.users' in pg_get_functiondef('business_is_writable(uuid)'::regprocedure)) = 0 then
    raise exception 'migration 044: business_is_writable() yang live TIDAK memuat auth.users — versi lama (rentan demo-spoof) masih aktif, CREATE OR REPLACE tidak menimpa dengan benar';
  end if;
end $$;
