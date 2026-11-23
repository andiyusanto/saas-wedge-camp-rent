-- Migration 072 (DRAFT, belum dijalankan) — Mulai Sewa (ambil sebelum
-- start_date) + label lama sewa "2H1M", brief 23 Nov 2026
-- (research/brief-mulai-sewa-dan-label-2h1m-2026-11.md), disetujui
-- koordinator 23 Nov 2026 dengan catatan (1)-(7).
--
-- CREATE OR REPLACE untuk TIGA fungsi (signature/grant/revoke KETIGANYA
-- TIDAK berubah dari versi terakhir):
--   - create_booking_atomic()     diff dari migration 070
--   - used_units_on_sql()         diff dari migration 071
--   - get_public_availability()   diff dari migration 071
-- Plus DUA kolom baru (businesses.duration_label_style,
-- bookings.duration_label_style) -- bagian E, murni label "2H1M", tidak
-- menyentuh harga/denda/stok sama sekali.

-- =====================================================================
-- E. Label lama sewa "2H1M" -- kolom baru, murni teks.
-- =====================================================================
alter table businesses
  add column if not exists duration_label_style text not null default 'hari'
  check (duration_label_style in ('hari', 'hari_malam'));

alter table bookings
  add column if not exists duration_label_style text
  check (duration_label_style is null or duration_label_style in ('hari', 'hari_malam'));

-- =====================================================================
-- B. Stok terblokir sejak hari diambil -- used_units_on_sql() (071).
--    Diff terhadap cabang 'aktif': batas bawah sebelumnya
--    `b.start_date - margin`, sekarang
--    `least(b.start_date, coalesce(tanggal picked_up_at di zona rental, b.start_date)) - margin`.
--    'dipesan' tidak punya picked_up_at, TIDAK berubah. 'telat'/'selesai'
--    tidak memakai start_date sebagai batas bawah sama sekali (murni
--    jendela maju dari actual_return_at) -- TIDAK berubah, catatan
--    koordinator poin (2) dikonfirmasi tidak berlaku untuk cabang ini
--    (tidak ada ekspresi batas bawah berbasis start_date di sana untuk
--    diubah). Signature/grant/revoke TIDAK berubah dari 071.
-- =====================================================================
create or replace function used_units_on_sql(
  p_business_id uuid,
  p_item_id uuid,
  p_date date,
  p_readiness_hours int,
  p_timezone text
)
returns int
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(bi.quantity), 0)::int
  from booking_items bi
  join bookings b on b.id = bi.booking_id
  where b.business_id = p_business_id
    and bi.item_id = p_item_id
    and (
      (b.status = 'aktif'
        and (
          least(b.start_date, coalesce((b.picked_up_at at time zone coalesce(p_timezone, 'Asia/Jakarta'))::date, b.start_date))
          - ceil(p_readiness_hours / 24.0)::int
        ) <= p_date
        and (
          (now() at time zone coalesce(p_timezone, 'Asia/Jakarta'))::date > b.end_date
          or p_date <= (b.end_date + ceil(p_readiness_hours / 24.0)::int)
        ))
      or (b.status = 'dipesan'
          and (b.start_date - ceil(p_readiness_hours / 24.0)::int) <= p_date
          and (b.end_date + ceil(p_readiness_hours / 24.0)::int) >= p_date)
      or (b.status in ('telat', 'selesai')
          and b.actual_return_at is not null
          and p_readiness_hours > 0
          and (b.actual_return_at at time zone coalesce(p_timezone, 'Asia/Jakarta'))::date <= p_date
          and (b.actual_return_at at time zone coalesce(p_timezone, 'Asia/Jakarta'))::date + (ceil(p_readiness_hours / 24.0)::int - 1) >= p_date)
    );
$$;

revoke all on function used_units_on_sql(uuid, uuid, date, int, text) from public, anon, authenticated;

-- get_public_availability(): cabang 'aktif' di CTE usage_per_day, diff
-- SAMA PERSIS (least(start_date, tanggal picked_up_at) sebagai batas
-- bawah). Field hasil/signature/cabang lain TIDAK disentuh dari 071.
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
          and (
            least(b.start_date, coalesce((b.picked_up_at at time zone v_tz)::date, b.start_date))
            - ceil(i.readiness_hours / 24.0)::int
          ) <= d.day
          and (
            (now() at time zone v_tz)::date > b.end_date
            or d.day <= (b.end_date + ceil(i.readiness_hours / 24.0)::int)
          )
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

revoke all on function get_public_availability(text, date, date) from public;
grant execute on function get_public_availability(text, date, date) to anon, authenticated;

-- =====================================================================
-- B/C. create_booking_atomic() -- diff dari migration 070. Celah
--    ditemukan sesi aplikasi saat menyusun rencana ini (bukan disebut di
--    brief): loop cek stok internal SELALU mulai dari p_start_date
--    (v_day := p_start_date), tidak pernah lebih awal -- untuk "Alat
--    diambil sekarang" (picked_up_now, Express mengirim p_status='aktif'
--    walau p_start_date masih di masa depan), malam-malam tambahan
--    sebelum start_date tidak pernah divalidasi ULANG di sini (Express
--    sudah mengecek di luar kunci, tapi RPC ini adalah sumber kebenaran
--    terakhir, sama seperti alasan migration 070 dibuat). v_picked_up_at
--    dan v_biz SUDAH tersedia lebih awal di fungsi ini (tidak perlu
--    reorder apa pun selain baris loop start). Satu-satunya diff:
--    `v_day := p_start_date;` -> `v_day := case when p_status='aktif'
--    then least(p_start_date, tanggal v_picked_up_at) else p_start_date
--    end;`. Signature/grant/revoke TIDAK berubah dari 070.
-- =====================================================================
create or replace function create_booking_atomic(
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
  p_actor_name text
)
returns table (booking_id uuid, booking_number text, status text)
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

  -- Mulai Sewa + ambil lebih awal (brief 23 Nov 2026) -- kalau booking
  -- ini langsung 'aktif' tapi p_start_date masih di masa depan ("Alat
  -- diambil sekarang"), malam-malam sebelum p_start_date (hari ini s/d
  -- p_start_date-1) WAJIB ikut divalidasi di loop di bawah, bukan cuma
  -- p_start_date..p_end_date -- sama jendela yang sudah dicek Express
  -- (checkStockForNewDates) SEBELUM memanggil RPC ini, diulang di sini
  -- sebagai sumber kebenaran terakhir (pola migration 070). v_picked_up_at
  -- dibaca sebagai TANGGAL di zona rental (konsisten dengan
  -- used_units_on_sql/get_public_availability di atas) -- least() jatuh
  -- balik ke p_start_date untuk walk-in biasa (regresi: identik perilaku
  -- sebelum fitur ini).
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
  -- insert baru.
  if p_customer_id is not null then
    select id into v_customer_id from customers where id = p_customer_id and business_id = p_business_id;
    if v_customer_id is null then
      raise exception 'create_booking_atomic: data pelanggan tidak ditemukan';
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
        duration_label_style
      ) values (
        p_business_id, v_customer_id, p_customer_photo_key, v_booking_number,
        p_start_date, p_end_date, p_status, v_picked_up_at,
        p_total_price, p_dp_paid, p_dp_method,
        v_biz.rental_day_mode, v_biz.min_rental_days, v_biz.max_rental_days,
        v_biz.return_deadline_time, v_biz.return_deadline_next_day,
        v_biz.late_fee_mode, v_biz.late_fee_per_hour, v_biz.late_fee_per_hour_cap_enabled,
        v_biz.duration_label_style
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

  insert into booking_status_history (booking_id, status, changed_by, changed_by_name)
    values (v_booking_id, p_status, auth.uid(), p_actor_name);

  return query select v_booking_id, v_booking_number, p_status;
end;
$$;

revoke all on function create_booking_atomic(
  uuid, uuid, text, text, text, text, date, date, text,
  numeric, numeric, text, jsonb, jsonb, jsonb, text
) from public, anon;
grant execute on function create_booking_atomic(
  uuid, uuid, text, text, text, text, date, date, text,
  numeric, numeric, text, jsonb, jsonb, jsonb, text
) to authenticated;
