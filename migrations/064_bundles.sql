-- Paket Alat ("resep"), Tahap 1 (brief 15 Nov 2026, research/brief-paket-alat-2026-11.md)
--
-- Opsi A: paket BUKAN barang tersendiri dengan stok sendiri -- dipecah
-- jadi booking_items per komponen saat transaksi dibuat, sehingga
-- logika stok/kalender/readiness/denda per alat yang SUDAH ADA tidak
-- berubah sama sekali. Tabel ini cuma menyimpan RESEP (daftar
-- komponen + cara harga), bukan ketersediaan.

create table bundles (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id),
  name            text not null,
  image_url       text,
  description     text,
  category        text,
  pricing_mode    text not null check (pricing_mode in ('ikuti_alat', 'sendiri')),
  -- 'sendiri': nominal tetap bertingkat, semantik sama items (migration
  -- 034) -- price_per_day = tarif hari 1, dst. NULL kalau 'ikuti_alat'.
  price_per_day   numeric,
  day2_rate       numeric,
  day3_rate       numeric,
  day4_rate       numeric,
  day5_rate       numeric,
  extra_day_rate  numeric,
  -- 'ikuti_alat': potongan opsional, diterapkan PER TINGKAT HARI (bukan
  -- ke total akhir) -- lihat computeItemRentalPrice. NULL kalau 'sendiri'.
  discount_type   text check (discount_type in ('percent', 'nominal')),
  discount_value  numeric,
  deactivated_at  timestamptz,
  created_at      timestamptz not null default now(),
  check ((pricing_mode = 'sendiri' and price_per_day is not null) or (pricing_mode = 'ikuti_alat' and price_per_day is null)),
  check (discount_type is null or pricing_mode = 'ikuti_alat'),
  check (discount_value is null or discount_value >= 0),
  check (discount_type <> 'percent' or discount_value <= 100)
);

create index bundles_business_id_idx on bundles (business_id);

create table bundle_items (
  id           uuid primary key default gen_random_uuid(),
  bundle_id    uuid not null references bundles(id) on delete cascade,
  business_id  uuid not null references businesses(id),
  item_id      uuid not null references items(id),
  quantity     int not null check (quantity >= 1)
);

create index bundle_items_bundle_id_idx on bundle_items (bundle_id);
create index bundle_items_item_id_idx on bundle_items (item_id);

-- Keamanan wajib (koordinator 15 Nov 2026): item komponen dan bundle
-- induknya harus satu business yang sama -- dicek di Express JUGA, tapi
-- trigger ini jaring pengaman DB-level (RLS WITH CHECK saja tidak bisa
-- membandingkan ke tabel items lain secara efisien per baris di sini).
create or replace function check_bundle_item_business() returns trigger as $$
declare
  v_bundle_business uuid;
  v_item_business uuid;
begin
  select business_id into v_bundle_business from bundles where id = new.bundle_id;
  select business_id into v_item_business from items where id = new.item_id;
  if v_bundle_business is null or v_item_business is null or v_bundle_business <> v_item_business then
    raise exception 'bundle_items: item dan bundle harus milik business yang sama';
  end if;
  if new.business_id <> v_bundle_business then
    raise exception 'bundle_items: business_id tidak cocok dengan bundle';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger bundle_items_check_business
  before insert or update on bundle_items
  for each row execute function check_bundle_item_business();

alter table bundles enable row level security;
alter table bundle_items enable row level security;

create policy members_select_bundles on bundles for select using (is_member_of(business_id));
create policy owner_write_bundles on bundles for insert with check (is_owner_of(business_id));
create policy owner_update_bundles on bundles for update using (is_owner_of(business_id)) with check (is_owner_of(business_id));
create policy owner_delete_bundles on bundles for delete using (is_owner_of(business_id));

create policy members_select_bundle_items on bundle_items for select using (is_member_of(business_id));
create policy owner_write_bundle_items on bundle_items for insert with check (is_owner_of(business_id));
create policy owner_update_bundle_items on bundle_items for update using (is_owner_of(business_id)) with check (is_owner_of(business_id));
create policy owner_delete_bundle_items on bundle_items for delete using (is_owner_of(business_id));

-- Penanda paket di booking_items -- NULLABLE, baris lama/alat biasa
-- semuanya null (regresi aman). bundle_id dipertahankan (bukan
-- on delete set null) supaya riwayat masih bisa ditautkan -- bundle
-- TIDAK PERNAH di-hard-delete (cuma deactivated_at), pola sama items.
alter table booking_items add column bundle_id uuid references bundles(id);
alter table booking_items add column bundle_instance_id uuid;
alter table booking_items add column bundle_name text;
alter table booking_items add column bundle_quantity int;

alter table booking_request_items add column bundle_id uuid references bundles(id);
alter table booking_request_items add column bundle_instance_id uuid;
alter table booking_request_items add column bundle_name text;
alter table booking_request_items add column bundle_quantity int;

-- apply_booking_item_changes (migration 061, Ubah Alat) di-create-or-
-- replace ulang supaya ikut menyimpan 4 kolom penanda paket -- Express
-- (lib/bookingItems.ts mergeBookingItemsForUpdate) sudah menentukan
-- bundle_* mana yang dipertahankan/dilepas SEBELUM memanggil RPC ini
-- (aturan "lepas semua kalau grup diubah sebagian"), RPC cuma menulis
-- apa adanya -- SATU pengecualian: bundle_id yang bukan null WAJIB
-- milik business booking ini (keamanan wajib, sama alasan item_id di
-- bawah -- RPC bypass RLS, tanpa ini anggota bisa menautkan bundle_id
-- business lain). Badan function SAMA PERSIS migration 061 selain itu.
create or replace function apply_booking_item_changes(
  p_booking_id uuid,
  p_new_items jsonb,
  p_new_total_price numeric,
  p_reason text,
  p_changed_by_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_old_items jsonb;
  v_new_items jsonb;
begin
  select id, business_id, status, total_price
  into v_booking
  from bookings
  where id = p_booking_id
  for update;

  if v_booking is null then
    raise exception 'apply_booking_item_changes: transaksi tidak ditemukan';
  end if;

  if not is_member_of(v_booking.business_id) then
    raise exception 'apply_booking_item_changes: tidak berhak';
  end if;

  if not business_is_writable(v_booking.business_id) then
    raise exception 'apply_booking_item_changes: akun ini hanya-baca, tidak bisa mengubah transaksi';
  end if;

  if v_booking.status != 'dipesan' then
    raise exception 'apply_booking_item_changes: Ubah Alat cuma berlaku untuk transaksi berstatus Siap Diambil';
  end if;

  if p_new_items is null or jsonb_typeof(p_new_items) != 'array' or jsonb_array_length(p_new_items) < 1 then
    raise exception 'apply_booking_item_changes: minimal satu alat harus tersisa';
  end if;

  if p_new_total_price is null or p_new_total_price < 0 then
    raise exception 'apply_booking_item_changes: total harga tidak valid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_new_items) as x(item_id uuid, quantity int, bundle_id uuid)
    left join items i on i.id = x.item_id and i.business_id = v_booking.business_id
    left join booking_items bi_existing on bi_existing.booking_id = p_booking_id and bi_existing.item_id = x.item_id
    left join bundles bnd on bnd.id = x.bundle_id and bnd.business_id = v_booking.business_id
    where x.item_id is null
       or x.quantity is null
       or x.quantity < 1
       or i.id is null
       or (bi_existing.item_id is null and i.deactivated_at is not null)
       or (x.bundle_id is not null and bnd.id is null)
  ) then
    raise exception 'apply_booking_item_changes: ada alat/paket yang tidak valid, bukan milik usaha ini, alat baru yang nonaktif, atau jumlah tidak valid';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', bi.item_id,
           'name', i.name,
           'quantity', bi.quantity,
           'subtotal', bi.subtotal
         )), '[]'::jsonb)
  into v_old_items
  from booking_items bi
  join items i on i.id = bi.item_id
  where bi.booking_id = p_booking_id;

  delete from booking_items where booking_id = p_booking_id;

  insert into booking_items (
    booking_id, item_id, quantity, price_at_booking, subtotal,
    day2_rate_at_booking, day3_rate_at_booking, day4_rate_at_booking,
    day5_rate_at_booking, extra_day_rate_at_booking,
    bundle_id, bundle_instance_id, bundle_name, bundle_quantity
  )
  select
    p_booking_id,
    (x->>'item_id')::uuid,
    (x->>'quantity')::int,
    (x->>'price_at_booking')::numeric,
    (x->>'subtotal')::numeric,
    (x->>'day2_rate_at_booking')::numeric,
    (x->>'day3_rate_at_booking')::numeric,
    (x->>'day4_rate_at_booking')::numeric,
    (x->>'day5_rate_at_booking')::numeric,
    (x->>'extra_day_rate_at_booking')::numeric,
    (x->>'bundle_id')::uuid,
    (x->>'bundle_instance_id')::uuid,
    x->>'bundle_name',
    (x->>'bundle_quantity')::int
  from jsonb_array_elements(p_new_items) as x;

  select jsonb_agg(jsonb_build_object(
           'item_id', (x->>'item_id')::uuid,
           'name', i.name,
           'quantity', (x->>'quantity')::int,
           'subtotal', (x->>'subtotal')::numeric
         ))
  into v_new_items
  from jsonb_array_elements(p_new_items) as x
  join items i on i.id = (x->>'item_id')::uuid;

  update bookings set total_price = p_new_total_price where id = p_booking_id;

  insert into booking_item_changes (
    booking_id, business_id, old_items, new_items, old_total_price, new_total_price,
    reason, changed_by, changed_by_name
  ) values (
    p_booking_id, v_booking.business_id, v_old_items, v_new_items, v_booking.total_price, p_new_total_price,
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(), p_changed_by_name
  );
end;
$$;

revoke all on function apply_booking_item_changes(uuid, jsonb, numeric, text, text) from public, anon;
grant execute on function apply_booking_item_changes(uuid, jsonb, numeric, text, text) to authenticated;
