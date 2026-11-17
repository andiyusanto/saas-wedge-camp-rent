-- Simpan Transaksi Atomik, Tahap 1 (brief 17 Nov 2026,
-- research/brief-simpan-transaksi-atomik-2026-11.md). DRAFT revisi 2 --
-- belum dijalankan, menunggu "siap dijalankan" dari koordinator.
--
-- Latar: bug unwind POST /bookings (FK 068, trigger DP 067 menulis
-- booking_payments SEBELUM booking_items/deposit/barang-jual sempat
-- tersimpan, compensating delete manual bisa gagal/terlewat) + celah
-- race dua POST /bookings paralel lolos cek stok SEBELUM salah satunya
-- insert (cek stok dan insert terpisah, tidak dalam kunci yang sama).
--
-- Tahap 1 ini CUMA mencakup Catat Transaksi baru (POST /bookings).
-- Ubah Jadwal/Perpanjang/Ubah Alat TETAP seperti sekarang (Tahap 2,
-- ditunda -- brief eksplisit).
--
-- get_public_availability() (migration 053) SENGAJA TIDAK disentuh sama
-- sekali di migration ini (revisi koordinator) -- itu jalur ANON PUBLIK
-- (Etalase) yang sedang berjalan baik; mengubahnya ke loop per item×hari
-- menambah risiko regresi + kinerja (mis. 60 alat × 14 hari = 840
-- panggilan fungsi per cek pelanggan) tanpa manfaat langsung untuk brief
-- ini. Kesamaan logika dibuktikan lewat test pembanding TIGA ARAH
-- (usedUnitsOn TS vs used_units_on_sql vs get_public_availability, data
-- fixture SAMA) -- bukan lewat berbagi kode. Refactor berbagi kode bisa
-- jadi brief terpisah nanti, dengan uji kinerja sendiri.

-- =====================================================================
-- 1. used_units_on_sql() -- logika stok dipakai HANYA oleh
--    create_booking_atomic() (bagian 2). Logika PERSIS usedUnitsOn()
--    (backend/src/lib/availability.ts) -- dicek baris demi baris:
--    - 'aktif': unbounded maju (tidak pernah berhenti), readiness_hours
--      cuma mundur dari start_date;
--    - 'dipesan': margin SIMETRIS di start_date DAN end_date;
--    - 'telat'/'selesai' DENGAN actual_return_at: dijangkarkan ke
--      actual_return_at (BUKAN end_date terjadwal), readiness_hours=0
--      -> TIDAK diblokir sama sekali;
--    - 'telat'/'selesai' TANPA actual_return_at, atau 'dibatalkan':
--      tidak pernah dihitung.
--    Dipanggil PER item_id PER tanggal (bukan set-based) -- jumlah
--    item×hari dalam SATU transaksi baru selalu kecil (puluhan), beda
--    dari get_public_availability yang bisa dipanggil atas SELURUH
--    katalog sekaligus (makanya TIDAK dipakai di situ, lihat catatan di
--    atas). INTERNAL -- revoke dari semua role, TIDAK di-grant ke
--    siapa pun (revisi koordinator poin 2): SECURITY DEFINER tanpa
--    revoke berarti siapa pun authenticated bisa membaca hitungan stok
--    business LAIN lewat pemanggilan langsung. create_booking_atomic
--    tetap bisa memanggilnya karena SATU fungsi SECURITY DEFINER
--    memanggil fungsi SECURITY DEFINER lain dengan OWNER YANG SAMA
--    tidak pernah dicek ulang lewat GRANT/REVOKE -- itu aturan untuk
--    pemanggilan EKSTERNAL (lewat PostgREST/supabase-js), bukan
--    pemanggilan internal antar fungsi se-pemilik.
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
      (b.status = 'aktif' and (b.start_date - ceil(p_readiness_hours / 24.0)::int) <= p_date)
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

-- generate_booking_number_sql() -- pola SWL-YYYYMMDD-NN (count+1 per
-- business per hari, zona rental), dipakai HANYA oleh
-- create_booking_atomic(). INTERNAL, sama seperti di atas -- tidak
-- di-grant ke siapa pun.
create or replace function generate_booking_number_sql(p_business_id uuid, p_timezone text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_count int;
begin
  v_today := (now() at time zone coalesce(p_timezone, 'Asia/Jakarta'))::date;
  select count(*) into v_count
    from bookings
    where business_id = p_business_id
      and (created_at at time zone coalesce(p_timezone, 'Asia/Jakarta'))::date = v_today;
  return 'SWL-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad((v_count + 1)::text, 2, '0');
end;
$$;

revoke all on function generate_booking_number_sql(uuid, text) from public, anon, authenticated;

-- =====================================================================
-- 2. create_booking_atomic() -- SATU RPC untuk SELURUH penulisan
--    POST /bookings (Catat Transaksi baru). Harga/tarif/alokasi paket
--    TETAP dihitung di TypeScript (Express) -- RPC ini CUMA menerima
--    payload yang SUDAH DIHITUNG (p_items berisi price_at_booking/
--    subtotal/dll siap pakai, bukan dihitung ulang di SQL). Validasi
--    INPUT (DP<=total, deposit uang>0, per_malam tanggal sama, min
--    hari) TETAP di Express SEBELUM RPC dipanggil. Validasi
--    KEPEMILIKAN (revisi koordinator poin 3 -- RPC SECURITY DEFINER
--    bypass RLS, jadi WAJIB cek ulang di sini, bukan percaya Express
--    sudah benar) dilakukan DI DALAM: tiap item_id milik business DAN
--    aktif, bundle_id (kalau ada) milik business, customer_id lama
--    milik business. Harga/snapshot (price_at_booking, subtotal, dst)
--    TETAP dipercaya dari payload Express -- risiko yang SAMA seperti
--    sekarang (booking_items.subtotal sudah lama trust-the-client,
--    dicatat di CLAUDE.md migration 034), TIDAK diperketat di sini,
--    di luar cakupan brief ini.
-- =====================================================================
-- Revisi koordinator (ronde 2): p_actor_user_id DIHAPUS dari parameter
-- -- member bisa memalsukan siapa yang mencatat kalau nilai itu
-- dipercaya dari payload. auth.uid() dipakai LANGSUNG di dalam fungsi
-- untuk booking_status_history.changed_by (p_actor_name TETAP parameter
-- -- cuma snapshot TAMPILAN/label, bukan identitas yang ditegakkan).
-- Snapshot pengaturan rental (rental_day_mode, min/max_rental_days,
-- return_deadline_*, late_fee_*) JUGA DIHAPUS dari parameter -- dibaca
-- LANGSUNG dari businesses DI DALAM kunci yang sama (bagian bawah),
-- bukan 8 parameter terpisah dari Express yang bisa (secara teori)
-- dikirim beda dari nilai businesses sungguhan. Express tetap boleh
-- membaca businesses untuk validasi awal (per_malam/menit hari) --
-- RPC ini yang jadi sumber kebenaran untuk NILAI YANG DISIMPAN.
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

  -- Revisi koordinator poin 4: status & picked_up_at TIDAK dipercaya
  -- dari payload Express sama sekali -- cuma dua nilai yang diterima,
  -- picked_up_at SELALU now() (jam sungguhan RPC dijalankan) kalau
  -- 'aktif', null kalau 'dipesan'. Mencegah klien mengirim status/jam
  -- ambil sembarangan lewat panggilan RPC langsung.
  if p_status not in ('dipesan', 'aktif') then
    raise exception 'create_booking_atomic: status tidak valid';
  end if;
  v_picked_up_at := case when p_status = 'aktif' then now() else null end;

  -- Kunci per business, dilepas otomatis saat transaksi ini commit/
  -- rollback (xact lock, BUKAN session lock -- tidak butuh unlock
  -- manual, tidak bisa "nyangkut" kalau function ini raise exception
  -- di tengah jalan). hashtext() boleh collision (32-bit) tapi dampaknya
  -- cuma over-serialisasi (dua business berbeda kebetulan antre di
  -- lock yang sama) -- tidak pernah salah secara korektif.
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));

  -- Snapshot pengaturan rental dibaca DI DALAM kunci yang sama (revisi
  -- koordinator ronde 2) -- bukan dipercaya dari parameter Express.
  select timezone, rental_day_mode, min_rental_days, max_rental_days,
         return_deadline_time, return_deadline_next_day,
         late_fee_mode, late_fee_per_hour, late_fee_per_hour_cap_enabled
    into v_biz
    from businesses where id = p_business_id;

  -- Kepemilikan bundle_id (kalau ada baris paket) -- SATU select
  -- distinct, bukan per baris, defense-in-depth karena RPC ini bypass
  -- RLS items/bundles.
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

  -- Cek ulang stok DI DALAM kunci -- sumber kebenaran, bukan cuma
  -- pre-check Express. Sekalian memvalidasi item_id milik business DAN
  -- masih aktif (deactivated_at is null) -- bundle TIDAK pernah
  -- diekspansi di sini, baris komponen paket sudah berupa item_id
  -- individual sejak Express membangun p_items (sama seperti
  -- usedUnitsOn/get_public_availability, keduanya juga tidak pernah
  -- mengekspansi bundle).
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

    v_day := p_start_date;
    while v_day <= p_end_date loop
      v_used := used_units_on_sql(p_business_id, v_item.item_id, v_day, v_item_row.readiness_hours, v_biz.timezone);
      if v_used + v_item.qty > v_item_row.total_units then
        -- Revisi koordinator poin 5: SQLSTATE custom 'P0409' untuk
        -- error stok (bukan substring bahasa Indonesia yang rapuh) --
        -- Express memetakan errcode='P0409' -> HTTP 409, selain itu
        -- default 400. Pesan tetap ramah (nama alat + tanggal + sisa).
        raise exception 'Alat "%" tidak cukup pada % (sisa %, diminta %)',
          v_item_row.name, v_day, v_item_row.total_units - v_used, v_item.qty
          using errcode = 'P0409';
      end if;
      v_day := v_day + 1;
    end loop;
  end loop;

  -- Pelanggan: id existing divalidasi milik business yang sama (defense
  -- in depth -- RPC SECURITY DEFINER bypass RLS select customers), atau
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

  -- Nomor booking: retry pola sama Express lama (SWL-YYYYMMDD-NN,
  -- bukan sequence Postgres) -- loop dengan sub-block exception supaya
  -- race unique_violation pada booking_number tidak menggagalkan
  -- seluruh transaksi, cuma mengulang generate+insert (maks 5x, sama
  -- seperti MAX_BOOKING_NUMBER_ATTEMPTS Express).
  for v_attempt in 1..5 loop
    v_booking_number := generate_booking_number_sql(p_business_id, v_biz.timezone);
    begin
      insert into bookings (
        business_id, customer_id, customer_photo_key, booking_number,
        start_date, end_date, status, picked_up_at,
        total_price, dp_paid, dp_method,
        rental_day_mode, min_rental_days, max_rental_days,
        return_deadline_time, return_deadline_next_day,
        late_fee_mode, late_fee_per_hour, late_fee_per_hour_cap_enabled
      ) values (
        p_business_id, v_customer_id, p_customer_photo_key, v_booking_number,
        p_start_date, p_end_date, p_status, v_picked_up_at,
        p_total_price, p_dp_paid, p_dp_method,
        v_biz.rental_day_mode, v_biz.min_rental_days, v_biz.max_rental_days,
        v_biz.return_deadline_time, v_biz.return_deadline_next_day,
        v_biz.late_fee_mode, v_biz.late_fee_per_hour, v_biz.late_fee_per_hour_cap_enabled
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
  -- (migration 066, TIDAK diubah sama sekali, SUDAH menegakkan
  -- kepemilikan sale_item_id sendiri) -- dipanggil langsung di dalam
  -- transaksi yang sama (satu pemanggilan fungsi = satu transaksi),
  -- bukan disalin ulang ke sini.
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
