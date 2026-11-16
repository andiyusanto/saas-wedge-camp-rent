-- Paket Alat Tahap 2 -- Paket di Etalase + Pesanan Online
-- (brief disetujui Andi 16 Nov 2026, research/brief-paket-alat-tahap-2-etalase-2026-11.md)
--
-- Lanjutan Tahap 1 (migration 064, sudah jalan). Idempoten: seluruh
-- statement di sini aman dijalankan ulang (create or replace / drop-if-
-- exists sebelum create).

-- ----------------------------------------------------------------
-- 1. get_public_page -- tambah key 'bundles', field lain + grant TIDAK
--    berubah (verifikasi dengan curl anon sebelum/sesudah, catatan
--    koordinator 16 Nov 2026).
-- ----------------------------------------------------------------
-- Cuma bundle AKTIF yang SEMUA komponennya aktif ikut tampil (brief
-- bagian A) -- "not exists komponen nonaktif" di WHERE, bukan filter
-- after-the-fact di Express (supaya bundle yang tidak lolos filter ini
-- juga tidak pernah terkirim ke browser pelanggan sama sekali).
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
    'terms_version_id', pp.current_terms_version_id,
    'return_deadline_time', b.return_deadline_time,
    'return_deadline_next_day', b.return_deadline_next_day,
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
    ),
    'bundles', (
      select coalesce(json_agg(
        json_build_object(
          'id', bn.id,
          'name', bn.name,
          'image_url', bn.image_url,
          'description', bn.description,
          'category', bn.category,
          'pricing_mode', bn.pricing_mode,
          'price_per_day', bn.price_per_day,
          'day2_rate', bn.day2_rate,
          'day3_rate', bn.day3_rate,
          'day4_rate', bn.day4_rate,
          'day5_rate', bn.day5_rate,
          'extra_day_rate', bn.extra_day_rate,
          'discount_type', bn.discount_type,
          'discount_value', bn.discount_value,
          'components', (
            -- Urutan WAJIB deterministik dan SAMA dengan useBundles.ts
            -- (frontend, Tahap 1) dan Express (bookingRequests.ts, Tahap
            -- 2) -- allocateBundlePrice() melempar sisa pembulatan
            -- rupiah ke komponen PERTAMA, urutan berbeda antar runtime
            -- bisa menghasilkan alokasi berbeda walau totalnya sama
            -- (catatan koordinator 16 Nov 2026). item_id (bukan nama)
            -- dipilih supaya tidak perlu join ke items cuma untuk sort.
            select coalesce(json_agg(
              json_build_object(
                'item_id', bi.item_id,
                'quantity', bi.quantity,
                'name', ci.name,
                'image_url', ci.image_url,
                'price_per_day', ci.price_per_day,
                'day2_rate', ci.day2_rate,
                'day3_rate', ci.day3_rate,
                'day4_rate', ci.day4_rate,
                'day5_rate', ci.day5_rate,
                'extra_day_rate', ci.extra_day_rate
              )
              order by bi.item_id
            ), '[]'::json)
            from bundle_items bi
            join items ci on ci.id = bi.item_id
            where bi.bundle_id = bn.id
          )
        )
        order by bn.name
      ), '[]'::json)
      from bundles bn
      where bn.business_id = pp.business_id
        and bn.deactivated_at is null
        and not exists (
          select 1 from bundle_items bi2
          join items ci2 on ci2.id = bi2.item_id
          where bi2.bundle_id = bn.id
            and ci2.deactivated_at is not null
        )
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

-- ----------------------------------------------------------------
-- 2. create_booking_request -- signature TETAP SAMA. Tiap elemen
--    p_items boleh punya 4 field opsional baru (bundle_id/
--    bundle_instance_id/bundle_name/bundle_quantity, null kalau tidak
--    ada -- Etalase lama yang ter-cache browser pelanggan tetap
--    mengirim item_id/quantity polos, tetap diterima seperti sebelum
--    ini sama sekali). Express (bookingRequests.ts) yang memecah paket
--    jadi baris per komponen SEBELUM memanggil RPC ini (lihat alasan di
--    research/brief-paket-alat-tahap-2-etalase-2026-11.md bagian C) --
--    RPC di sini cuma menambah validasi MURAH sebagai defense in depth
--    (catatan koordinator 16 Nov 2026): kalau bundle_id tidak null,
--    bundle itu WAJIB milik business yang sama (pola persis
--    apply_booking_item_changes, migration 064), dan baris-baris yang
--    berbagi bundle_instance_id yang sama WAJIB konsisten (bundle_id/
--    bundle_name/bundle_quantity sama semua).
-- ----------------------------------------------------------------
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
  bad_bundle_count int;
  inconsistent_instance_count int;
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

  -- Defense in depth (catatan koordinator 16 Nov 2026) -- bundle_id yang
  -- tidak null WAJIB milik business yang sama. Express sudah memvalidasi
  -- ini sebelum memanggil RPC, tapi RPC SECURITY DEFINER ini tidak boleh
  -- percaya begitu saja apa pun yang dikirim lewat p_items.
  select count(*) into bad_bundle_count
  from jsonb_array_elements(p_items) as elem
  where elem ? 'bundle_id'
    and elem->>'bundle_id' is not null
    and not exists (
      select 1 from bundles bn
      where bn.id = (elem->>'bundle_id')::uuid
        and bn.business_id = p_business_id
    );
  if bad_bundle_count > 0 then
    raise exception 'create_booking_request: ada paket yang tidak valid/bukan milik usaha ini';
  end if;

  -- Baris-baris dengan bundle_instance_id yang sama WAJIB konsisten
  -- (bundle_id/bundle_name/bundle_quantity sama) -- satu instance paket
  -- tidak boleh "pecah" jadi dua bundle/nama/jumlah berbeda.
  select count(*) into inconsistent_instance_count
  from (
    select elem->>'bundle_instance_id' as instance_id,
           count(distinct elem->>'bundle_id') as distinct_bundle_ids,
           count(distinct elem->>'bundle_name') as distinct_names,
           count(distinct elem->>'bundle_quantity') as distinct_qtys
    from jsonb_array_elements(p_items) as elem
    where elem ? 'bundle_instance_id' and elem->>'bundle_instance_id' is not null
    group by elem->>'bundle_instance_id'
  ) grouped
  where distinct_bundle_ids > 1 or distinct_names > 1 or distinct_qtys > 1;
  if inconsistent_instance_count > 0 then
    raise exception 'create_booking_request: komposisi paket tidak konsisten';
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

  insert into booking_request_items (
    booking_request_id, item_id, quantity,
    bundle_id, bundle_instance_id, bundle_name, bundle_quantity
  )
  select
    new_id,
    (elem->>'item_id')::uuid,
    (elem->>'quantity')::int,
    nullif(elem->>'bundle_id', '')::uuid,
    nullif(elem->>'bundle_instance_id', '')::uuid,
    elem->>'bundle_name',
    nullif(elem->>'bundle_quantity', '')::int
  from jsonb_array_elements(p_items) as elem;

  return new_id;
end;
$$;

revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb, uuid) from public;
revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb, uuid) from authenticated;
grant execute on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb, uuid) to anon;

-- ----------------------------------------------------------------
-- 3. get_booking_request_status -- field lama UTUH (koordinator poin 7),
--    cuma memperluas isi 'items': tiap baris sekarang ikut membawa
--    bundle_name/bundle_instance_id/bundle_quantity (null untuk alat
--    lepas, sama seperti sebelum ini) -- Express (etalase.ts) yang
--    mengelompokkan tampilannya lewat bundle_instance_id, RPC cuma
--    menyediakan datanya apa adanya. Grant/revoke TIDAK berubah.
-- ----------------------------------------------------------------
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
    'return_deadline_time', b.return_deadline_time,
    'return_deadline_next_day', b.return_deadline_next_day,
    'items', (
      select coalesce(json_agg(
        json_build_object(
          'name', i.name,
          'quantity', bri.quantity,
          'bundle_name', bri.bundle_name,
          'bundle_instance_id', bri.bundle_instance_id,
          'bundle_quantity', bri.bundle_quantity
        )
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
