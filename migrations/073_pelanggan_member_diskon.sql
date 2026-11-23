-- Migration 073 (DRAFT, belum dijalankan) — Menu Pelanggan + Member/Mitra
-- + Diskon, brief 23 Nov 2026 (research/brief-pelanggan-member-diskon-2026-11.md),
-- disetujui koordinator 23 Nov 2026.

-- =====================================================================
-- A. Jenis Pelanggan (Member/Mitra/dst) -- owner-write (pengaturan,
--    bukan "kerja" seperti items/bundles -- pola late_fee_mode dkk),
--    member-read. Tidak ada delete -- soft-delete via deactivated_at
--    supaya customers.customer_type_id tidak pernah yatim. Maks ~5
--    jenis per usaha ditegakkan di UI saja (bukan constraint DB).
-- =====================================================================
create table if not exists customer_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  name text not null,
  discount_percent int not null check (discount_percent between 0 and 100),
  -- Toggle "Diskon juga untuk barang jual" (brief bagian B, default OFF
  -- -- diskon default CUMA untuk sewa alat+paket, TIDAK barang jual).
  discount_applies_to_sale_items boolean not null default false,
  deactivated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_types_business_id_idx on customer_types (business_id);

alter table customer_types enable row level security;

drop policy if exists "members_select_customer_types" on customer_types;
create policy "members_select_customer_types"
  on customer_types for select
  using (is_member_of(business_id));

drop policy if exists "owner_insert_customer_types" on customer_types;
create policy "owner_insert_customer_types"
  on customer_types for insert
  with check (is_owner_of(business_id));

drop policy if exists "owner_update_customer_types" on customer_types;
create policy "owner_update_customer_types"
  on customer_types for update
  using (is_owner_of(business_id))
  with check (is_owner_of(business_id));

-- =====================================================================
-- B. customers -- label/jenis diskon, Waspada, catatan. Waspada dan
--    jenis diskon INDEPENDEN (boleh bersamaan, keputusan koordinator).
--    SATU kolom `note` umum (bukan dua field terpisah) -- dipakai baik
--    di halaman Pelanggan maupun banner Waspada saat Catat Transaksi.
-- =====================================================================
alter table customers
  add column if not exists customer_type_id uuid references customer_types(id),
  add column if not exists is_watchlisted boolean not null default false,
  add column if not exists note text;

create index if not exists customers_customer_type_id_idx on customers (customer_type_id);

-- Kepemilikan lintas business (review koordinator poin 2) -- RLS WITH
-- CHECK tidak membandingkan antar tabel, dan member boleh update
-- customers, jadi tanpa trigger ini customer_type_id bisa diisi id jenis
-- milik business LAIN. Pola check_bundle_item_business() (migration 064).
create or replace function check_customer_type_business() returns trigger as $$
declare
  v_type_business uuid;
begin
  if new.customer_type_id is null then
    return new;
  end if;
  select business_id into v_type_business from customer_types where id = new.customer_type_id;
  if v_type_business is null or v_type_business <> new.business_id then
    raise exception 'customers: customer_type_id harus milik business yang sama';
  end if;
  return new;
end;
$$ language plpgsql security invoker set search_path = public;

drop trigger if exists customers_check_customer_type_business on customers;
create trigger customers_check_customer_type_business
  before insert or update on customers
  for each row execute function check_customer_type_business();

-- Gerbang business_is_writable() untuk SELURUH update customers (bukan
-- cuma label/note) -- diverifikasi AMAN: grep ".from('customers')" di
-- seluruh backend/frontend dan "update customers"/"UPDATE customers" di
-- semua migration/RPC menunjukkan NOL jalur update customers yang ada
-- sekarang (cuma SELECT di useCustomerSearch.ts dan INSERT di
-- create_booking_atomic) -- jadi tidak ada alur "menyelesaikan transaksi
-- berjalan" (pickup/return/cancel/pembayaran/Ubah Jadwal/Perpanjang) yang
-- akan diblokir oleh gerbang ini. Kebijakan UPDATE yang ada (migration
-- 044) SEBELUMNYA TIDAK digerbang business_is_writable sama sekali --
-- diganti di sini.
drop policy if exists "members_update_own_customers" on customers;
create policy "members_update_own_customers"
  on customers for update
  using (is_member_of(business_id))
  with check (is_member_of(business_id) and business_is_writable(business_id));

-- =====================================================================
-- C. Snapshot diskon per transaksi (pola rental_day_mode 049) --
--    booking_items.subtotal TETAP BRUTO (tidak disentuh sama sekali).
--    total_price TETAP sepenuhnya trust-the-client (pola lama, vendor
--    override manual) -- discount_amount cuma snapshot INFORMASI untuk
--    baris struk/nota/Laporan, tidak dipaksa match ke total_price.
--    Tampilan struk/nota (keputusan koordinator): Total Sewa bruto ->
--    baris Diskon -> Total = total_price apa adanya (kalau vendor
--    override manual, baris diskon snapshot tetap tampil apa adanya).
-- =====================================================================
alter table bookings
  add column if not exists discount_type_name text,
  add column if not exists discount_percent int,
  add column if not exists discount_amount numeric not null default 0;

-- =====================================================================
-- D. create_booking_atomic() -- DROP + CREATE (bukan CREATE OR REPLACE
--    murni) karena menambah parameter mengubah signature. DROP dulu
--    supaya tidak ada dua overload (CREATE OR REPLACE dengan signature
--    beda akan membuat fungsi KEDUA, dan panggilan 16-argumen Express
--    lama jadi "function is not unique"). Parameter baru punya DEFAULT
--    di akhir daftar -- Express lama (16 argumen, dari jeda deploy)
--    TETAP cocok ke fungsi baru ini tanpa gagal.
--
--    Diff dari 072:
--    - parameter baru: p_apply_customer_discount boolean default true
--      (staf bisa melepas diskon untuk transaksi itu meski pelanggan
--      berlabel -- Express mengirim false kalau staf melepas centang).
--    - Persen & nama jenis dibaca DI DALAM kunci dari customer_types
--      milik customer (business sama, deactivated_at is null) --
--      TIDAK dipercaya dari payload Express (defense-in-depth, sama
--      alasan item_id/bundle_id/customer_id). Customer_type nonaktif
--      atau customer baru (p_customer_id null, baru di-insert) ->
--      tanpa diskon.
--    - discount_amount dihitung RPC SENDIRI dari SUM(booking_items.
--      subtotal) [+ SUM(booking_sale_items.subtotal) kalau toggle
--      discount_applies_to_sale_items aktif] x persen / 100, DIBULATKAN
--      -- dihitung dari baris yang SUDAH tersimpan (bukan jsonb payload
--      mentah), supaya tidak menduplikasi logika harga/paket apa pun --
--      murni aritmetika SUM x persen, bukan rumus harga baru.
--    Semua bagian LAIN (lock, cek stok, validasi item/bundle, insert
--    booking_items/deposit/sale_items/status_history) TIDAK berubah
--    dari 072.
-- =====================================================================
drop function if exists create_booking_atomic(
  uuid, uuid, text, text, text, text, date, date, text,
  numeric, numeric, text, jsonb, jsonb, jsonb, text
);
-- Idempotensi (review koordinator): drop juga signature 17-argumen milik
-- migration INI SENDIRI -- tanpa ini, menjalankan migration ini dua kali
-- gagal "already exists" (create or replace tidak bisa dipakai di sini
-- karena RETURNS TABLE berubah dari versi 072).
drop function if exists create_booking_atomic(
  uuid, uuid, text, text, text, text, date, date, text,
  numeric, numeric, text, jsonb, jsonb, jsonb, text, boolean
);

create function create_booking_atomic(
  p_business_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_customer_photo_key text,
  p_start_date date,
  p_end_date date,
  p_status text,
  p_total_price numeric,
  p_dp_paid numeric,
  p_dp_method text,
  p_items jsonb,
  p_deposit jsonb,
  p_sale_items jsonb,
  p_actor_name text,
  p_apply_customer_discount boolean default true
)
returns table (
  booking_id uuid, booking_number text, status text,
  discount_type_name text, discount_percent int, discount_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_biz record;
  v_customer_id uuid;
  v_booking_id uuid;
  v_booking_number text;
  v_picked_up_at timestamptz;
  v_attempt int;
  v_item record;
  v_day date;
  v_loop_start date;
  v_used int;
  v_item_row record;
  v_bundle_id uuid;
  v_bundle_count int;
  v_discount_type_name text;
  v_discount_percent int;
  v_discount_applies_to_sale_items boolean;
  v_discount_amount numeric;
  v_bruto_items numeric;
  v_bruto_sale numeric;
begin
  if not is_member_of(p_business_id) then
    raise exception 'create_booking_atomic: tidak berhak';
  end if;
  if not business_is_writable(p_business_id) then
    raise exception 'create_booking_atomic: akun hanya-baca';
  end if;

  -- Revisi koordinator poin 4 (070): status & picked_up_at TIDAK
  -- dipercaya dari payload Express sama sekali -- cuma dua nilai yang
  -- diterima, picked_up_at SELALU now() (jam sungguhan RPC dijalankan)
  -- kalau 'aktif', null kalau 'dipesan'. Berlaku juga untuk "Alat
  -- diambil sekarang" (brief 23 Nov 2026) -- Express cuma menaikkan
  -- p_status ke 'aktif', jam ambil TETAP dicatat di sini, bukan dari
  -- payload.
  if p_status not in ('dipesan', 'aktif') then
    raise exception 'create_booking_atomic: status tidak valid';
  end if;
  v_picked_up_at := case when p_status = 'aktif' then now() else null end;

  -- Kunci per business, dilepas otomatis saat transaksi ini commit/
  -- rollback (xact lock, BUKAN session lock).
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));

  -- Snapshot pengaturan rental dibaca DI DALAM kunci yang sama.
  select timezone, rental_day_mode, min_rental_days, max_rental_days,
         return_deadline_time, return_deadline_next_day,
         late_fee_mode, late_fee_per_hour, late_fee_per_hour_cap_enabled,
         duration_label_style
    into v_biz
    from businesses where id = p_business_id;

  -- Kepemilikan bundle_id (kalau ada baris paket).
  for v_bundle_id in
    select distinct (x.bundle_id)
    from jsonb_to_recordset(p_items) as x(bundle_id uuid)
    where x.bundle_id is not null
  loop
    select count(*) into v_bundle_count from bundles where id = v_bundle_id and business_id = p_business_id;
    if v_bundle_count = 0 then
      raise exception 'create_booking_atomic: paket tidak ditemukan/bukan milik usaha ini';
    end if;
  end loop;

  -- Mulai Sewa + ambil lebih awal (migration 072) -- kalau booking ini
  -- langsung 'aktif' tapi p_start_date masih di masa depan ("Alat
  -- diambil sekarang"), malam-malam sebelum p_start_date (hari ini s/d
  -- p_start_date-1) WAJIB ikut divalidasi di loop di bawah.
  v_loop_start := case
    when p_status = 'aktif' then least(p_start_date, (v_picked_up_at at time zone v_biz.timezone)::date)
    else p_start_date
  end;

  -- Cek ulang stok DI DALAM kunci -- sumber kebenaran, bukan cuma
  -- pre-check Express.
  for v_item in
    select x.item_id, sum(x.quantity)::int as qty
    from jsonb_to_recordset(p_items) as x(item_id uuid, quantity int)
    group by x.item_id
  loop
    select id, name, total_units, readiness_hours into v_item_row
      from items where id = v_item.item_id and business_id = p_business_id and deactivated_at is null;
    if v_item_row is null then
      raise exception 'create_booking_atomic: alat tidak ditemukan, nonaktif, atau bukan milik usaha ini';
    end if;

    v_day := v_loop_start;
    while v_day <= p_end_date loop
      v_used := used_units_on_sql(p_business_id, v_item.item_id, v_day, v_item_row.readiness_hours, v_biz.timezone);
      if v_used + v_item.qty > v_item_row.total_units then
        raise exception 'Alat "%" tidak cukup pada % (sisa %, diminta %)',
          v_item_row.name, v_day, v_item_row.total_units - v_used, v_item.qty
          using errcode = 'P0409';
      end if;
      v_day := v_day + 1;
    end loop;
  end loop;

  -- Pelanggan: id existing divalidasi milik business yang sama, atau
  -- insert baru. Jenis diskon (kalau ada) dibaca DI SINI, bukan dari
  -- payload -- pelanggan baru (belum punya histori) selalu tanpa
  -- diskon, customer_type nonaktif juga dianggap tanpa diskon.
  if p_customer_id is not null then
    select id into v_customer_id from customers where id = p_customer_id and business_id = p_business_id;
    if v_customer_id is null then
      raise exception 'create_booking_atomic: data pelanggan tidak ditemukan';
    end if;

    if p_apply_customer_discount then
      select ct.name, ct.discount_percent, ct.discount_applies_to_sale_items
        into v_discount_type_name, v_discount_percent, v_discount_applies_to_sale_items
        from customers c
        join customer_types ct on ct.id = c.customer_type_id and ct.deactivated_at is null and ct.business_id = p_business_id
        where c.id = v_customer_id;
    end if;
  else
    insert into customers (business_id, name, phone, address)
      values (p_business_id, p_customer_name, p_customer_phone, p_customer_address)
      returning id into v_customer_id;
  end if;

  -- Nomor booking: retry pola sama Express lama.
  for v_attempt in 1..5 loop
    v_booking_number := generate_booking_number_sql(p_business_id, v_biz.timezone);
    begin
      insert into bookings (
        business_id, customer_id, customer_photo_key, booking_number,
        start_date, end_date, status, picked_up_at,
        total_price, dp_paid, dp_method,
        rental_day_mode, min_rental_days, max_rental_days,
        return_deadline_time, return_deadline_next_day,
        late_fee_mode, late_fee_per_hour, late_fee_per_hour_cap_enabled,
        duration_label_style,
        discount_type_name, discount_percent
      ) values (
        p_business_id, v_customer_id, p_customer_photo_key, v_booking_number,
        p_start_date, p_end_date, p_status, v_picked_up_at,
        p_total_price, p_dp_paid, p_dp_method,
        v_biz.rental_day_mode, v_biz.min_rental_days, v_biz.max_rental_days,
        v_biz.return_deadline_time, v_biz.return_deadline_next_day,
        v_biz.late_fee_mode, v_biz.late_fee_per_hour, v_biz.late_fee_per_hour_cap_enabled,
        v_biz.duration_label_style,
        v_discount_type_name, v_discount_percent
      ) returning id into v_booking_id;
      exit;
    exception when unique_violation then
      if v_attempt = 5 then
        raise exception 'create_booking_atomic: gagal membuat nomor booking unik setelah 5 percobaan';
      end if;
    end;
  end loop;

  insert into booking_items (
    booking_id, item_id, quantity, price_at_booking, subtotal,
    day2_rate_at_booking, day3_rate_at_booking, day4_rate_at_booking,
    day5_rate_at_booking, extra_day_rate_at_booking,
    bundle_id, bundle_instance_id, bundle_name, bundle_quantity
  )
  select v_booking_id, x.item_id, x.quantity, x.price_at_booking, x.subtotal,
    x.day2_rate_at_booking, x.day3_rate_at_booking, x.day4_rate_at_booking,
    x.day5_rate_at_booking, x.extra_day_rate_at_booking,
    x.bundle_id, x.bundle_instance_id, x.bundle_name, x.bundle_quantity
  from jsonb_to_recordset(p_items) as x(
    item_id uuid, quantity int, price_at_booking numeric, subtotal numeric,
    day2_rate_at_booking numeric, day3_rate_at_booking numeric, day4_rate_at_booking numeric,
    day5_rate_at_booking numeric, extra_day_rate_at_booking numeric,
    bundle_id uuid, bundle_instance_id uuid, bundle_name text, bundle_quantity int
  );

  if p_deposit is not null then
    insert into deposits (booking_id, type, amount, note, status)
    values (
      v_booking_id,
      p_deposit->>'type',
      case when p_deposit->>'type' = 'uang' then (p_deposit->>'amount')::numeric else null end,
      p_deposit->>'note',
      'ditahan'
    );
  end if;

  -- Barang jual: logika SAMA PERSIS apply_new_booking_sale_items()
  -- (migration 066, TIDAK diubah sama sekali).
  if p_sale_items is not null and jsonb_array_length(p_sale_items) > 0 then
    perform apply_new_booking_sale_items(v_booking_id, p_sale_items);
  end if;

  -- discount_amount: dihitung SETELAH booking_items/booking_sale_items
  -- tersimpan, dari SUM baris yang SUDAH PERSIS tercatat (bukan dari
  -- jsonb payload mentah) -- murni SUM x persen, tidak menduplikasi
  -- rumus harga/alokasi paket apa pun (itu sudah dihitung Express/
  -- frontend sebelum sampai sini, sama seperti price_at_booking/subtotal
  -- lainnya).
  if v_discount_percent is not null and v_discount_percent > 0 then
    select coalesce(sum(subtotal), 0) into v_bruto_items
      from booking_items where booking_id = v_booking_id;
    v_bruto_sale := 0;
    if v_discount_applies_to_sale_items then
      select coalesce(sum(subtotal), 0) into v_bruto_sale
        from booking_sale_items where booking_id = v_booking_id;
    end if;
    v_discount_amount := round((v_bruto_items + v_bruto_sale) * v_discount_percent / 100.0);
    update bookings set discount_amount = v_discount_amount where id = v_booking_id;
  end if;

  insert into booking_status_history (booking_id, status, changed_by, changed_by_name)
    values (v_booking_id, p_status, auth.uid(), p_actor_name);

  return query select v_booking_id, v_booking_number, p_status,
    v_discount_type_name, v_discount_percent, coalesce(v_discount_amount, 0);
end;
$$;

revoke all on function create_booking_atomic(
  uuid, uuid, text, text, text, text, date, date, text,
  numeric, numeric, text, jsonb, jsonb, jsonb, text, boolean
) from public, anon;
grant execute on function create_booking_atomic(
  uuid, uuid, text, text, text, text, date, date, text,
  numeric, numeric, text, jsonb, jsonb, jsonb, text, boolean
) to authenticated;
