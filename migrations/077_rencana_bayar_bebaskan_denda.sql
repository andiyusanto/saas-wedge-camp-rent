-- ============================================================
-- Migration 077 — Rencana Bayar di Pesanan Online + Bebaskan Denda
-- research/brief-rencana-bayar-bebaskan-denda-2026-12.md, 24 Nov 2026
-- ============================================================
-- DRAFT -- kirim untuk review koordinator SEBELUM dijalankan Andi.
--
-- ================================================================
-- CATATAN PENTING, baca sebelum review: Bagian A di brief MINTA kolom
-- `booking_requests.payment_plan` BARU + perluasan create_booking_request
-- + perluasan get_booking_request_status. Setelah membaca kode yang
-- SUDAH ADA, ternyata `booking_requests.payment_method` (migration
-- 037, check 'transfer'/'qris'/'cash') SUDAH PERSIS fitur yang brief
-- minta -- diisi dari form Etalase, divalidasi terhadap cara bayar
-- aktif di public_pages, dan SUDAH dikembalikan ke pelanggan sendiri
-- lewat get_booking_request_status() ('payment_method' di jsonb hasil,
-- migration 037/041/042/046/047/051/053/062/065). Yang BELUM ada cuma
-- sisi OWNER: field ini tidak pernah disurfacing ke "Pesanan masuk"/
-- form Konfirmasi/struk.
--
-- Migration ini TIDAK menambah booking_requests.payment_plan, TIDAK
-- menyentuh create_booking_request atau get_booking_request_status
-- sama sekali -- field yang sudah ada dipakai apa adanya. Cuma
-- menambah SATU kolom snapshot `bookings.payment_plan` (diisi dari
-- booking_requests.payment_method saat Konfirmasi, lewat parameter
-- baru create_booking_atomic) supaya transaksi JADI yang sudah
-- dikonfirmasi punya datanya sendiri (pola sama rental_day_mode dkk,
-- tidak bergantung terus ke booking_requests yang row-nya bisa
-- kedaluwarsa/tidak relevan lagi setelah dikonfirmasi). Kalau ternyata
-- ada alasan pelanggan harus bisa dipilih BERBEDA dari payment_method
-- (mis. label "Rencana bayar" dimaksud sebagai hal yang terpisah dari
-- metode DP), tolong dikonfirmasi ulang -- draf ini mengasumsikan
-- keduanya sama secara semantik.
-- ================================================================

-- A. Snapshot rencana bayar di bookings (dari booking_requests.payment_method
--    saat Konfirmasi, ATAU diisi manual walk-in -- keduanya opsional).
alter table bookings add column if not exists payment_plan text
  check (payment_plan is null or payment_plan in ('transfer', 'qris', 'cash'));

-- create_booking_atomic (migration 073) -- WAJIB DROP dulu, BUKAN
-- `create or replace` (koreksi koordinator, pelajaran sama 073):
-- menambah parameter baru lewat `create or replace` TANPA drop
-- membuat Postgres mendaftarkan OVERLOAD KEDUA (17 dan 18 argumen)
-- alih-alih mengganti fungsi lama -- panggilan Express dengan 17
-- argumen BERNAMA (tanpa p_payment_plan) jadi AMBIGU ("function is not
-- unique") karena cocok ke DUA overload sekaligus (yang 18 punya
-- default untuk parameter terakhir). DROP eksplisit signature LAMA
-- (17 argumen) dan signature BARU (18 argumen, idempoten kalau
-- migration ini pernah gagal di tengah jalan) dulu, baru CREATE biasa
-- -- memastikan cuma SATU fungsi `create_booking_atomic` yang terdaftar.
drop function if exists create_booking_atomic(
  uuid, uuid, text, text, text, text, date, date, text,
  numeric, numeric, text, jsonb, jsonb, jsonb, text, boolean
);
drop function if exists create_booking_atomic(
  uuid, uuid, text, text, text, text, date, date, text,
  numeric, numeric, text, jsonb, jsonb, jsonb, text, boolean, text
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
  p_apply_customer_discount boolean default true,
  p_payment_plan text default null
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

  if p_status not in ('dipesan', 'aktif') then
    raise exception 'create_booking_atomic: status tidak valid';
  end if;
  v_picked_up_at := case when p_status = 'aktif' then now() else null end;

  -- Validasi p_payment_plan DI SINI (defense in depth, pola sama
  -- item_id/bundle_id) -- constraint DB sudah cukup untuk integritas,
  -- tapi pesan error yang jelas lebih berguna daripada bergantung ke
  -- error constraint generik.
  if p_payment_plan is not null and p_payment_plan not in ('transfer', 'qris', 'cash') then
    raise exception 'create_booking_atomic: rencana bayar tidak valid';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_business_id::text));

  select timezone, rental_day_mode, min_rental_days, max_rental_days,
         return_deadline_time, return_deadline_next_day,
         late_fee_mode, late_fee_per_hour, late_fee_per_hour_cap_enabled,
         duration_label_style
    into v_biz
    from businesses where id = p_business_id;

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

  v_loop_start := case
    when p_status = 'aktif' then least(p_start_date, (v_picked_up_at at time zone v_biz.timezone)::date)
    else p_start_date
  end;

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
        discount_type_name, discount_percent,
        payment_plan
      ) values (
        p_business_id, v_customer_id, p_customer_photo_key, v_booking_number,
        p_start_date, p_end_date, p_status, v_picked_up_at,
        p_total_price, p_dp_paid, p_dp_method,
        v_biz.rental_day_mode, v_biz.min_rental_days, v_biz.max_rental_days,
        v_biz.return_deadline_time, v_biz.return_deadline_next_day,
        v_biz.late_fee_mode, v_biz.late_fee_per_hour, v_biz.late_fee_per_hour_cap_enabled,
        v_biz.duration_label_style,
        v_discount_type_name, v_discount_percent,
        p_payment_plan
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

  if p_sale_items is not null and jsonb_array_length(p_sale_items) > 0 then
    perform apply_new_booking_sale_items(v_booking_id, p_sale_items);
  end if;

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
  numeric, numeric, text, jsonb, jsonb, jsonb, text, boolean, text
) from public, anon;
grant execute on function create_booking_atomic(
  uuid, uuid, text, text, text, text, date, date, text,
  numeric, numeric, text, jsonb, jsonb, jsonb, text, boolean, text
) to authenticated;

-- ================================================================
-- B. Bebaskan denda telat -- audit append-safe (snapshot kolom,
--    pola rental_day_mode/return_deadline_time: cukup nullable, tidak
--    perlu tabel terpisah karena cuma SATU kejadian per booking,
--    ditulis SEKALI saat Proses Pengembalian). TIDAK ada RPC baru --
--    POST /bookings/:id/return (routes/trackings.ts) adalah Express
--    biasa, bukan RPC atomik, jadi ditulis langsung lewat UPDATE
--    supabase-js seperti kolom penalties lain di endpoint yang sama.
-- ================================================================
alter table bookings add column if not exists late_fee_waived_amount numeric
  check (late_fee_waived_amount is null or late_fee_waived_amount >= 0);
alter table bookings add column if not exists late_fee_waived_reason text;
alter table bookings add column if not exists late_fee_waived_by_name text;
alter table bookings add column if not exists late_fee_waived_at timestamptz;

select pg_notify('pgrst', 'reload schema');
