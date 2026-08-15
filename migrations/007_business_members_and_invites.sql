-- ============================================================
-- Migration 007 — Karyawan (business_members) + undangan
-- ============================================================
-- Keputusan (didiskusikan sebelum migration ini ditulis):
-- - Karyawan dapat akses PENUH ke bisnisnya, sama seperti owner — role
--   cuma dipakai untuk atribusi/tampilan (lihat migration 008 audit
--   trail), BUKAN untuk membatasi hak akses. Makanya semua policy di
--   bawah menyamakan owner & karyawan sepenuhnya.
-- - Onboarding karyawan lewat kode undangan (bukan pemilik mengetik
--   username/password langsung ala Bilbo) — karena signUp() sisi client
--   Supabase langsung meng-otentikasi akun baru itu sendiri, jadi tidak
--   mungkin pemilik "membuatkan" akun orang lain dari sesi browsernya
--   sendiri tanpa Secret Key (yang sengaja tidak kita pakai).

-- --------------------------------------------------------------
-- business_members — siapa saja anggota satu business, dan perannya
-- --------------------------------------------------------------
create table business_members (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id),
  user_id      uuid not null references auth.users(id),
  role         text not null check (role in ('owner', 'karyawan')),
  created_at   timestamptz not null default now(),
  unique (business_id, user_id)
);

-- Backfill: setiap business yang sudah ada, ownernya jadi member pertama.
insert into business_members (business_id, user_id, role)
select id, owner_id, 'owner' from businesses
on conflict (business_id, user_id) do nothing;

-- Helper function security definer — supaya policy di business_members
-- (dan tabel lain) yang mengecek keanggotaan tidak menabrak dirinya
-- sendiri (RLS memeriksa business_members lewat query ke business_members
-- akan gagal/"infinite recursion" kalau dilakukan langsung di klausa
-- `using`, karena subquery itu sendiri kena RLS lagi). Function ini
-- berjalan dengan hak pembuatnya (bypass RLS internal), jadi aman dipakai
-- berulang di banyak policy tanpa masalah itu.
create or replace function is_member_of(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from business_members
    where business_id = target_business_id
      and user_id = auth.uid()
  );
$$;

alter table business_members enable row level security;

create policy "members_select_own_business_members"
  on business_members for select
  using (is_member_of(business_id));

create policy "members_delete_own_business_members"
  on business_members for delete
  using (is_member_of(business_id));

-- Insert lewat redeem undangan (lihat business_invites di bawah) — user
-- memasukkan dirinya sendiri, disyaratkan ada undangan valid (belum
-- dipakai, belum kedaluwarsa) yang cocok business_id+role-nya. Validasi
-- kecocokan KODE persisnya dilakukan di endpoint backend (baca dulu
-- lewat kode sebelum insert ini dipanggil) — klausa di bawah ini lapis
-- pertahanan kedua, bukan satu-satunya penjaga.
create policy "insert_self_via_valid_invite"
  on business_members for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from business_invites
      where business_invites.business_id = business_members.business_id
        and business_invites.role = business_members.role
        and business_invites.used_at is null
        and business_invites.expires_at > now()
    )
  );

-- --------------------------------------------------------------
-- business_invites — kode undangan sekali pakai
-- --------------------------------------------------------------
create table business_invites (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id),
  code         text not null unique,
  role         text not null check (role in ('owner', 'karyawan')),
  created_by   uuid not null references auth.users(id),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

alter table business_invites enable row level security;

-- Select sengaja publik (bukan cuma is_member_of): alur redeem butuh
-- user yang BELUM jadi member bisa mencari undangan lewat kodenya
-- sendiri. Kode itu sendiri string acak panjang (dibuat di backend) yang
-- jadi "rahasia"-nya — sama seperti magic link, keamanannya bertumpu ke
-- entropi kode, bukan ke RLS select. Frontend tidak pernah menampilkan
-- daftar undangan tanpa terlebih dulu tahu business_id (dari is_member_of
-- di query kedua di bawah), jadi tidak ada UI yang "membocorkan" ini.
create policy "select_invites"
  on business_invites for select
  using (true);

create policy "members_create_invites"
  on business_invites for insert
  with check (is_member_of(business_id) and created_by = auth.uid());

-- Redeem (tandai dipakai) — user manapun boleh, asal baris yang disentuh
-- masih belum dipakai (mencegah replay setelah used_at terisi).
create policy "redeem_unused_invite"
  on business_invites for update
  using (used_at is null)
  with check (used_by = auth.uid());

create policy "members_delete_own_invites"
  on business_invites for delete
  using (is_member_of(business_id));

-- --------------------------------------------------------------
-- Samakan businesses, items, customers, bookings, booking_items,
-- deposits, penalties: owner DAN karyawan (is_member_of) dapat akses
-- penuh yang sama — bukan cuma owner_id langsung lagi.
-- --------------------------------------------------------------
drop policy if exists "owner_select_own_business" on businesses;
create policy "members_select_own_business"
  on businesses for select
  using (is_member_of(id));

drop policy if exists "owner_update_own_business" on businesses;
create policy "members_update_own_business"
  on businesses for update
  using (is_member_of(id));

-- insert businesses TIDAK diubah — bikin business baru = alur onboarding
-- jadi owner, tetap lewat owner_id = auth.uid() saja.

drop policy if exists "owner_select_own_items" on items;
drop policy if exists "owner_modify_own_items" on items;
create policy "members_select_own_items"
  on items for select
  using (is_member_of(business_id));
create policy "members_modify_own_items"
  on items for all
  using (is_member_of(business_id))
  with check (is_member_of(business_id));

drop policy if exists "owner_select_own_customers" on customers;
drop policy if exists "owner_modify_own_customers" on customers;
create policy "members_select_own_customers"
  on customers for select
  using (is_member_of(business_id));
create policy "members_modify_own_customers"
  on customers for all
  using (is_member_of(business_id))
  with check (is_member_of(business_id));

drop policy if exists "owner_select_own_bookings" on bookings;
drop policy if exists "owner_modify_own_bookings" on bookings;
create policy "members_select_own_bookings"
  on bookings for select
  using (is_member_of(business_id));
create policy "members_modify_own_bookings"
  on bookings for all
  using (is_member_of(business_id))
  with check (is_member_of(business_id));

drop policy if exists "owner_select_own_booking_items" on booking_items;
drop policy if exists "owner_modify_own_booking_items" on booking_items;
create policy "members_select_own_booking_items"
  on booking_items for select
  using (
    booking_id in (select id from bookings where is_member_of(business_id))
  );
create policy "members_modify_own_booking_items"
  on booking_items for all
  using (
    booking_id in (select id from bookings where is_member_of(business_id))
  )
  with check (
    booking_id in (select id from bookings where is_member_of(business_id))
  );

drop policy if exists "owner_select_own_deposits" on deposits;
drop policy if exists "owner_modify_own_deposits" on deposits;
create policy "members_select_own_deposits"
  on deposits for select
  using (
    booking_id in (select id from bookings where is_member_of(business_id))
  );
create policy "members_modify_own_deposits"
  on deposits for all
  using (
    booking_id in (select id from bookings where is_member_of(business_id))
  )
  with check (
    booking_id in (select id from bookings where is_member_of(business_id))
  );

drop policy if exists "owner_select_own_penalties" on penalties;
drop policy if exists "owner_modify_own_penalties" on penalties;
create policy "members_select_own_penalties"
  on penalties for select
  using (
    booking_id in (select id from bookings where is_member_of(business_id))
  );
create policy "members_modify_own_penalties"
  on penalties for all
  using (
    booking_id in (select id from bookings where is_member_of(business_id))
  )
  with check (
    booking_id in (select id from bookings where is_member_of(business_id))
  );
