-- ============================================================
-- Migration 053 -- Zona waktu per rental (WIB / WITA / WIT)
-- ============================================================
-- Sebelumnya semua perhitungan "hari ini" & jam di server/database
-- dikunci WIB (CLAUDE.md bagian 4). Sejak data wilayah nasional (033)
-- dan vendor di luar WIB mendaftar (Balikpapan = WITA), rental WITA/WIT
-- kena selisih 1-2 jam: batas denda telat, status aktif/dipesan sekitar
-- tengah malam, kedaluwarsa & validasi Pesanan Online, readiness di
-- Etalase. Keputusan Andi 9 Nov 2026: tambah WITA + WIT.
--
-- businesses.timezone pakai nama IANA (tanpa DST di Indonesia, offset
-- tetap: Jakarta +7, Makassar +8, Jayapura +9). DEFAULT 'Asia/Jakarta'
-- => semua rental yang sudah ada TIDAK berubah perilakunya sama sekali
-- sampai owner sendiri menggantinya di Kelola Usaha.
--
-- Sengaja TIDAK diubah: langganan (044/045, masa aktif & tenggang tetap
-- WIB -- itu urusan tagihan Sewalog, bukan operasional rental).
--
-- Fungsi di bawah diambil dari definisi TERAKHIR masing-masing
-- (get_public_page 052, get_public_ordering_page 049, create_booking_
-- request 049, get_booking_request_status 051, get_public_availability
-- 028) -- cuma bagian zona waktu yang diubah. Idempotent.
-- ============================================================

alter table businesses
  add column if not exists timezone text not null default 'Asia/Jakarta';

alter table businesses drop constraint if exists businesses_timezone_check;
alter table businesses add constraint businesses_timezone_check
  check (timezone in ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'));

-- ------------------------------------------------------------
-- 1. get_public_page (052) -- + timezone (label jam di Etalase, min
--    tanggal ambil dihitung server dari zona rental)
-- ------------------------------------------------------------
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
    'district_name', d.name,
    'timezone', b.timezone,
    'operating_hours', pp.operating_hours,
    'public_phone', pp.public_phone,
    'writable', business_is_writable(pp.business_id),
    'terms_content', rtv.content,
    -- Tidak sensitif (cuma uuid internal) — dibutuhkan klien untuk
    -- dikirim balik persis sebagai p_terms_version_id saat submit, biar
    -- server bisa menolak kalau sudah tidak current lagi (lihat bagian 4).
    'terms_version_id', pp.current_terms_version_id,
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
  left join districts d on d.id = pp.district_id
  left join rental_terms_versions rtv on rtv.id = pp.current_terms_version_id
  where pp.slug = p_slug
    and pp.published = true;

  return result;
end;
$$;

grant execute on function get_public_page(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 2. get_public_ordering_page (049) -- + timezone (validasi tanggal &
--    kedaluwarsa pesanan di bookingRequests.ts)
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
    'timezone', b.timezone
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
-- 3. create_booking_request (049) -- "tanggal ambil sudah lewat" dihitung
--    di zona rental, bukan selalu WIB
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

  -- Syarat & Ketentuan (migration 047) — kalau toko ini punya syarat
  -- aktif (current_terms_version_id not null), versi yang dikirim klien
  -- WAJIB SAMA PERSIS dengan versi current SAAT INSERT ini (bukan cuma
  -- boolean "sudah centang") — kalau beda (vendor sempat ubah syaratnya
  -- sesudah klien buka form, SEBELUM klien submit), tolak dengan pesan
  -- khusus supaya backend bisa menyuruh klien muat ulang teks terbaru &
  -- centang ulang, bukan diam-diam mencatat persetujuan ke versi yang
  -- tidak pernah mereka baca. Toko tanpa syarat (null) tidak terpengaruh
  -- sama sekali — tidak ada kewajiban baru buat vendor yang belum pernah
  -- isi syarat.
  if page.current_terms_version_id is not null
     and p_terms_version_id is distinct from page.current_terms_version_id then
    raise exception 'create_booking_request: syarat telah diperbarui';
  end if;

  -- Cara hitung durasi sewa (migration 049) — kalau per malam, ambil dan
  -- kembali tidak boleh di hari yang sama (sama seperti Bilbo). Defense
  -- in depth — backend (bookingRequests.ts) menolak lebih dulu dengan
  -- pesan ramah, ini jaring pengaman server-side.
  select * into biz from businesses where id = p_business_id;
  if biz.rental_day_mode = 'per_malam' and p_start_date = p_end_date then
    raise exception 'create_booking_request: ambil dan kembali tidak boleh di hari yang sama';
  end if;

  if p_payment_method is null or (
    (p_payment_method = 'transfer' and page.pay_transfer_enabled is not true) or
    (p_payment_method = 'qris' and page.pay_qris_enabled is not true) or
    (p_payment_method = 'cash' and page.pay_cash_enabled is not true)
  ) then
    raise exception 'create_booking_request: cara bayar tidak diaktifkan vendor ini';
  end if;

  -- Zona rental (053), bukan WIB tetap. Nama variabel dibiarkan.
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

-- ------------------------------------------------------------
-- 4. get_booking_request_status (051) -- + timezone (jam batas konfirmasi
--    ditampilkan "pukul 14.00 WITA")
-- ------------------------------------------------------------
create or replace function get_booking_request_status(p_token uuid)
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
    'status', case when br.status = 'menunggu' and br.expires_at <= now() then 'kedaluwarsa' else br.status end,
    'order_code', upper(left(br.id::text, 6)),
    'customer_name', br.customer_name,
    'start_date', br.start_date,
    'end_date', br.end_date,
    'estimated_price', br.estimated_price,
    'payment_method', br.payment_method,
    'dp_amount', br.dp_amount,
    'rejection_reason', br.rejection_reason,
    'expires_at', br.expires_at,
    'business_name', b.name,
    'timezone', b.timezone,
    'logo_url', b.logo_url,
    'public_phone', pp.public_phone,
    'slug', pp.slug,
    'order_admin_phone_1', coalesce(pp.order_admin_phone_1, pp.public_phone),
    'order_admin_phone_2', pp.order_admin_phone_2,
    'order_admin_phone_3', pp.order_admin_phone_3,
    'confirmation_message', pp.confirmation_message,
    'accepted_terms_content', rtv.content,
    'payment_snapshot', case when br.status = 'dikonfirmasi' then br.payment_snapshot else null end,
    'items', (
      select coalesce(json_agg(
        json_build_object('name', i.name, 'quantity', bri.quantity)
      ), '[]'::json)
      from booking_request_items bri
      join items i on i.id = bri.item_id
      where bri.booking_request_id = br.id
    )
  )
  into result
  from booking_requests br
  join businesses b on b.id = br.business_id
  left join public_pages pp on pp.business_id = br.business_id
  left join rental_terms_versions rtv on rtv.id = br.terms_version_id
  where br.confirmation_token = p_token;

  return result; -- null kalau token tidak ada — caller balikin 404
end;
$$;

revoke all on function get_booking_request_status(uuid) from public;
revoke all on function get_booking_request_status(uuid) from authenticated;
grant execute on function get_booking_request_status(uuid) to anon;

-- ------------------------------------------------------------
-- 5. get_public_availability (028) -- hari kembali sungguhan
--    (actual_return_at) dibaca di zona rental. Harus selalu sepakat
--    dengan usedUnitsOn() di backend/src/lib/availability.ts.
-- ------------------------------------------------------------
create or replace function get_public_availability(p_slug text, p_start_date date, p_end_date date)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result json;
  v_business_id uuid;
  v_tz text;
begin
  if p_end_date < p_start_date then
    return '[]'::json;
  end if;

  select pp.business_id into v_business_id
  from public_pages pp
  where pp.slug = p_slug
    and pp.published = true;

  select coalesce(timezone, 'Asia/Jakarta') into v_tz from businesses where id = v_business_id;

  if v_business_id is null then
    return null;
  end if;

  with days as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as day
  ),
  usage_per_day as (
    select bi.item_id, d.day, sum(bi.quantity) as qty
    from booking_items bi
    join bookings b on b.id = bi.booking_id
    join items i on i.id = bi.item_id
    cross join days d
    where b.business_id = v_business_id
      and (
        (
          b.status = 'aktif'
          and (b.start_date - ceil(i.readiness_hours / 24.0)::int) <= d.day
        )
        or (
          b.status = 'dipesan'
          and (b.start_date - ceil(i.readiness_hours / 24.0)::int) <= d.day
          and (b.end_date + ceil(i.readiness_hours / 24.0)::int) >= d.day
        )
        or (
          b.status in ('telat', 'selesai')
          and b.actual_return_at is not null
          and i.readiness_hours > 0
          and (b.actual_return_at at time zone v_tz)::date <= d.day
          and (b.actual_return_at at time zone v_tz)::date + (ceil(i.readiness_hours / 24.0)::int - 1) >= d.day
        )
      )
    group by bi.item_id, d.day
  ),
  worst_day_usage as (
    select item_id, max(qty) as qty
    from usage_per_day
    group by item_id
  )
  select coalesce(json_agg(
    json_build_object(
      'id', i.id,
      'total_units', i.total_units,
      'remaining', i.total_units - coalesce(w.qty, 0)
    )
    order by i.name
  ), '[]'::json)
  into result
  from items i
  left join worst_day_usage w on w.item_id = i.id
  where i.business_id = v_business_id
    and i.deactivated_at is null;

  return result;
end;
$$;
