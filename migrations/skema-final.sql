-- ============================================================
-- Skema Final — Rental Marketplace UKM (MVP validasi, Malang Raya)
-- Stack: Postgres via Supabase
-- ============================================================

-- ============================================================
-- BAGIAN 1 — TABEL WILAYAH (referensi, scope kecil: Malang Raya)
-- ============================================================

create table provinces (
  id    uuid primary key default gen_random_uuid(),
  name  text unique not null
);

create table regencies (
  id           uuid primary key default gen_random_uuid(),
  province_id  uuid not null references provinces(id),
  name         text not null,           -- "Kota Malang", "Kabupaten Malang", "Kota Batu"
  type         text not null check (type in ('kota', 'kabupaten')),
  unique (province_id, name)
);

-- Seed data awal — cuma Jawa Timur / Malang Raya
insert into provinces (id, name) values
  (gen_random_uuid(), 'Jawa Timur');

insert into regencies (id, province_id, name, type) values
  (gen_random_uuid(), (select id from provinces where name = 'Jawa Timur'), 'Kota Malang', 'kota'),
  (gen_random_uuid(), (select id from provinces where name = 'Jawa Timur'), 'Kabupaten Malang', 'kabupaten'),
  (gen_random_uuid(), (select id from provinces where name = 'Jawa Timur'), 'Kota Batu', 'kota');

-- ============================================================
-- BAGIAN 2 — IDENTITAS AKUN (SaaS harian, semua vendor punya ini)
-- ============================================================

create table businesses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id),
  name        text not null,
  owner_name  text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- BAGIAN 3 — PROFIL PUBLIK MARKETPLACE (cuma terisi kalau opt-in)
-- ============================================================

create table business_profiles (
  business_id      uuid primary key references businesses(id),
  slug             text unique,
  description      text,
  category         text,
  address          text,
  regency_id       uuid references regencies(id),
  latitude         numeric,
  longitude        numeric,
  public_phone     text,
  logo_url         text,
  operating_hours  text,
  updated_at       timestamptz not null default now()
);

create table marketplace_consents (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id),
  status        text not null check (status in ('diminta', 'disetujui', 'ditolak', 'dicabut')),
  requested_at  timestamptz not null default now(),
  responded_at  timestamptz,
  notes         text
);

-- ============================================================
-- BAGIAN 4 — OPERASIONAL HARIAN (katalog, penyewa, transaksi)
-- ============================================================

create table items (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id),
  name           text not null,
  category       text,
  total_units    int not null,
  price_per_day  numeric not null,
  created_at     timestamptz not null default now()
);

create table customers (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id),
  name          text not null,
  phone         text,
  id_number     text,          -- KTP, kalau ditahan sebagai jaminan
  created_at    timestamptz not null default now()
);

create table bookings (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id),
  customer_id         uuid not null references customers(id),
  start_date          date not null,
  end_date            date not null,
  actual_return_date  date,
  status              text not null check (status in ('aktif', 'selesai', 'telat')),
  total_price         numeric not null,
  created_at          timestamptz not null default now()
);

create table booking_items (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references bookings(id),
  item_id            uuid not null references items(id),
  quantity           int not null,
  price_at_booking   numeric not null
);

create table deposits (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id),
  type          text not null check (type in ('ktp', 'sim', 'uang')),
  amount        numeric,
  status        text not null check (status in ('ditahan', 'dikembalikan')),
  returned_at   timestamptz
);

create table penalties (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id),
  type          text not null check (type in ('keterlambatan', 'kerusakan', 'kehilangan')),
  amount        numeric not null,
  description   text,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- BAGIAN 5 — ROW LEVEL SECURITY
-- ============================================================

alter table businesses            enable row level security;
alter table business_profiles     enable row level security;
alter table marketplace_consents  enable row level security;
alter table items                 enable row level security;
alter table customers             enable row level security;
alter table bookings              enable row level security;
alter table booking_items         enable row level security;
alter table deposits              enable row level security;
alter table penalties             enable row level security;

-- provinces & regencies: data referensi publik, semua orang boleh baca, tidak ada yang boleh ubah lewat client
alter table provinces enable row level security;
alter table regencies enable row level security;

create policy "public_read_provinces" on provinces for select using (true);
create policy "public_read_regencies" on regencies for select using (true);

-- --------------------------------------------------------------
-- businesses
-- --------------------------------------------------------------
create policy "owner_select_own_business"
  on businesses for select
  using (owner_id = auth.uid());

create policy "owner_update_own_business"
  on businesses for update
  using (owner_id = auth.uid());

create policy "owner_insert_own_business"
  on businesses for insert
  with check (owner_id = auth.uid());

-- --------------------------------------------------------------
-- business_profiles
-- Catatan: policy publik "siapa saja boleh baca profil yang statusnya
-- disetujui" belum ditambahkan di sini — baru relevan begitu marketplace
-- publik beneran mulai dibangun, bukan di tahap MVP validasi ini.
-- --------------------------------------------------------------
create policy "owner_select_own_profile"
  on business_profiles for select
  using (
    business_id in (select id from businesses where owner_id = auth.uid())
  );

create policy "owner_modify_own_profile"
  on business_profiles for all
  using (
    business_id in (select id from businesses where owner_id = auth.uid())
  )
  with check (
    business_id in (select id from businesses where owner_id = auth.uid())
  );

-- --------------------------------------------------------------
-- marketplace_consents — append-only dari sisi vendor (insert boleh,
-- update/delete sengaja tidak dibuka lewat policy ini supaya riwayat
-- tidak bisa diubah retroaktif; perubahan status dilakukan lewat insert
-- baris baru, bukan update baris lama)
-- --------------------------------------------------------------
create policy "owner_select_own_consents"
  on marketplace_consents for select
  using (
    business_id in (select id from businesses where owner_id = auth.uid())
  );

create policy "owner_insert_own_consents"
  on marketplace_consents for insert
  with check (
    business_id in (select id from businesses where owner_id = auth.uid())
  );

-- --------------------------------------------------------------
-- items
-- --------------------------------------------------------------
create policy "owner_select_own_items"
  on items for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

create policy "owner_modify_own_items"
  on items for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------------------
-- customers
-- --------------------------------------------------------------
create policy "owner_select_own_customers"
  on customers for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

create policy "owner_modify_own_customers"
  on customers for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------------------
-- bookings
-- --------------------------------------------------------------
create policy "owner_select_own_bookings"
  on bookings for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

create policy "owner_modify_own_bookings"
  on bookings for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------------------
-- booking_items (lompat lewat bookings buat cek pemilik)
-- --------------------------------------------------------------
create policy "owner_select_own_booking_items"
  on booking_items for select
  using (
    booking_id in (
      select id from bookings
      where business_id in (select id from businesses where owner_id = auth.uid())
    )
  );

create policy "owner_modify_own_booking_items"
  on booking_items for all
  using (
    booking_id in (
      select id from bookings
      where business_id in (select id from businesses where owner_id = auth.uid())
    )
  )
  with check (
    booking_id in (
      select id from bookings
      where business_id in (select id from businesses where owner_id = auth.uid())
    )
  );

-- --------------------------------------------------------------
-- deposits (lompat lewat bookings)
-- --------------------------------------------------------------
create policy "owner_select_own_deposits"
  on deposits for select
  using (
    booking_id in (
      select id from bookings
      where business_id in (select id from businesses where owner_id = auth.uid())
    )
  );

create policy "owner_modify_own_deposits"
  on deposits for all
  using (
    booking_id in (
      select id from bookings
      where business_id in (select id from businesses where owner_id = auth.uid())
    )
  )
  with check (
    booking_id in (
      select id from bookings
      where business_id in (select id from businesses where owner_id = auth.uid())
    )
  );

-- --------------------------------------------------------------
-- penalties (lompat lewat bookings)
-- --------------------------------------------------------------
create policy "owner_select_own_penalties"
  on penalties for select
  using (
    booking_id in (
      select id from bookings
      where business_id in (select id from businesses where owner_id = auth.uid())
    )
  );

create policy "owner_modify_own_penalties"
  on penalties for all
  using (
    booking_id in (
      select id from bookings
      where business_id in (select id from businesses where owner_id = auth.uid())
    )
  )
  with check (
    booking_id in (
      select id from bookings
      where business_id in (select id from businesses where owner_id = auth.uid())
    )
  );

-- ============================================================
-- CATATAN KETERSEDIAAN (TIDAK ADA TABELNYA — SENGAJA)
-- ============================================================
-- Ketersediaan alat per tanggal dihitung on-the-fly, bukan disimpan:
--
-- unit_terpakai(item, tanggal) =
--   SUM(booking_items.quantity)
--   WHERE booking_items.item_id = item
--     AND booking.status IN ('aktif', 'telat')
--     AND tanggal BETWEEN booking.start_date AND booking.end_date
--
-- sisa(item, tanggal) = item.total_units - unit_terpakai(item, tanggal)
--
-- Alasan: menyimpan ketersediaan sebagai kolom terpisah berisiko
-- tidak sinkron dengan data booking yang sebenarnya.
