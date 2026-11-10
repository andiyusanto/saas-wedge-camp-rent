-- ============================================================
-- Migration 054 -- Paket minimal/maksimal hari sewa (Tahap 1)
-- ============================================================
-- Brief & keputusan Andi: research/brief-paket-hari-dan-reschedule-2026-11.md
-- (Tahap 1). Dari wawancara vendor: Rental Outdoor Cikarang (per trip,
-- maks 4 hari, harga 1 hari = harga 4 hari) dan Mandalika Outdoor (sama,
-- +20%/hari lewat batas).
--
-- businesses.min_rental_days / max_rental_days: nullable, null = perilaku
-- sama persis seperti sekarang (tanpa batas). Berlaku untuk mode per_malam
-- maupun per_hari_kalender -- jumlah hari dihitung lewat rentalDuration()/
-- rentalDuration() SQL yang sama dengan mode yang berlaku saat itu.
--
-- Minimal = batas KERAS (kalender & harga keduanya terblokir, ditegakkan
-- di Catat Transaksi, Pesanan Online, dan create_booking_request).
-- Maksimal = batas PAKET, bukan batas keras: walk-in (POST /bookings)
-- boleh melewatinya (hanya auto-fill tanggal kembali di frontend), tapi
-- Pesanan Online dari Etalase DIBLOKIR melewati max (server-side).
--
-- bookings.min_rental_days / max_rental_days: SNAPSHOT saat transaksi
-- dibuat, pola sama seperti bookings.rental_day_mode (migration 049) --
-- supaya transaksi lama tidak dihitung ulang kalau pengaturan rental
-- diganti belakangan.
-- ============================================================

alter table businesses
  add column if not exists min_rental_days int,
  add column if not exists max_rental_days int;

alter table businesses drop constraint if exists businesses_rental_days_positive;
alter table businesses add constraint businesses_rental_days_positive
  check (
    (min_rental_days is null or min_rental_days >= 1) and
    (max_rental_days is null or max_rental_days >= 1) and
    (min_rental_days is null or max_rental_days is null or min_rental_days <= max_rental_days)
  );

alter table bookings
  add column if not exists min_rental_days int,
  add column if not exists max_rental_days int;

-- ------------------------------------------------------------
-- 1. get_public_ordering_page (053) -- + min/max paket, dibaca
--    bookingRequests.ts untuk validasi server-side Pesanan Online.
-- ------------------------------------------------------------
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
    'confirmation_deadline_hours', pp.confirmation_deadline_hours,
    'writable', business_is_writable(pp.business_id),
    'terms_content', rtv.content,
    'terms_version_id', pp.current_terms_version_id,
    'rental_day_mode', b.rental_day_mode,
    'timezone', b.timezone,
    'min_rental_days', b.min_rental_days,
    'max_rental_days', b.max_rental_days
  )
  into result
  from public_pages pp
  join businesses b on b.id = pp.business_id
  left join rental_terms_versions rtv on rtv.id = pp.current_terms_version_id
  where pp.slug = p_slug
    and pp.published = true
    and pp.accept_online_orders = true;

  return result;
end;
$$;

revoke all on function get_public_ordering_page(text) from public, authenticated;
grant execute on function get_public_ordering_page(text) to anon;

-- ------------------------------------------------------------
-- 2. create_booking_request (053) -- jaring pengaman server-side untuk
--    min/max paket, defense in depth (bookingRequests.ts sudah menolak
--    lebih dulu dengan pesan ramah).
-- ------------------------------------------------------------
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
  p_items jsonb,
  p_terms_version_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_secret text;
  page record;
  biz record;
  new_id uuid;
  total_qty int;
  bad_item_count int;
  today_wib date;
  rental_days int;
begin
  select value into expected_secret from private_config where key = 'booking_request_secret';
  if expected_secret is null or p_secret is distinct from expected_secret then
    raise exception 'create_booking_request: secret tidak valid';
  end if;

  select * into page from public_pages where business_id = p_business_id;
  if page is null or page.published is not true or page.accept_online_orders is not true then
    raise exception 'create_booking_request: etalase/pesanan online tidak aktif untuk business ini';
  end if;

  if not business_is_writable(p_business_id) then
    raise exception 'create_booking_request: toko ini sedang tidak menerima pesanan baru';
  end if;

  if page.current_terms_version_id is not null
     and p_terms_version_id is distinct from page.current_terms_version_id then
    raise exception 'create_booking_request: syarat telah diperbarui';
  end if;

  select * into biz from businesses where id = p_business_id;
  if biz.rental_day_mode = 'per_malam' and p_start_date = p_end_date then
    raise exception 'create_booking_request: ambil dan kembali tidak boleh di hari yang sama';
  end if;

  -- Paket minimal/maksimal hari (migration 054) -- hitung jumlah hari
  -- dengan mode yang SEDANG berlaku untuk toko ini (pesanan ini baru,
  -- belum ada baris bookings untuk disnapshot).
  rental_days := case when biz.rental_day_mode = 'per_malam'
    then (p_end_date - p_start_date)
    else (p_end_date - p_start_date) + 1
  end;

  if biz.min_rental_days is not null and rental_days < biz.min_rental_days then
    raise exception 'create_booking_request: minimal sewa % hari', biz.min_rental_days;
  end if;

  if biz.max_rental_days is not null and rental_days > biz.max_rental_days then
    raise exception 'create_booking_request: maksimal sewa % hari', biz.max_rental_days;
  end if;

  if p_payment_method is null or (
    (p_payment_method = 'transfer' and page.pay_transfer_enabled is not true) or
    (p_payment_method = 'qris' and page.pay_qris_enabled is not true) or
    (p_payment_method = 'cash' and page.pay_cash_enabled is not true)
  ) then
    raise exception 'create_booking_request: cara bayar tidak diaktifkan vendor ini';
  end if;

  today_wib := (now() at time zone coalesce(biz.timezone, 'Asia/Jakarta'))::date;
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
    estimated_price, payment_method, dp_amount, expires_at,
    terms_version_id, terms_accepted_at
  ) values (
    p_business_id, p_customer_name, p_customer_phone, p_note, p_start_date, p_end_date,
    p_estimated_price, p_payment_method, p_dp_amount, p_expires_at,
    page.current_terms_version_id,
    case when page.current_terms_version_id is not null then now() else null end
  )
  returning id into new_id;

  insert into booking_request_items (booking_request_id, item_id, quantity)
  select new_id, (elem->>'item_id')::uuid, (elem->>'quantity')::int
  from jsonb_array_elements(p_items) as elem;

  return new_id;
end;
$$;

revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb, uuid) from public;
revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb, uuid) from authenticated;
grant execute on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb, uuid) to anon;
