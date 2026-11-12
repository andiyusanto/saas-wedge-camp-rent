-- ============================================================
-- Migration 060 — Harga Pendiri: kolom + RPC penandaan/masa berlaku
-- ============================================================
-- Keputusan Andi 12 Nov 2026 (embargo sampai pengumuman 4 Des 2026,
-- lihat frontend/src/lib/subscriptionConfig.ts PRICING_ANNOUNCE_AT_ISO):
--
-- 1. OTOMATIS pendiri: business dengan businesses.created_at < 2027-01-01
--    00:00 WIB (FOUNDER_CUTOFF_ISO di subscriptionConfig.ts).
-- 2. MANUAL: admin bisa menandai/membatalkan status pendiri lewat Alat
--    Admin — untuk peserta wawancara yang baru daftar di bulan Januari
--    (created_at-nya otomatis TIDAK lolos aturan 1). Penandaan BARU
--    ditolak setelah 31 Jan 2027 23:59 WIB; membatalkan (unmark) tetap
--    boleh kapan saja.
-- 3. Masa berlaku: founder_price_until = tanggal MULAI periode
--    pembayaran PERTAMA + 12 bulan, diisi OTOMATIS oleh
--    record_subscription_payment() saat pembayaran pertama untuk
--    business pendiri yang kolomnya masih kosong. Jeda (subscription
--    lewat tenggang/hanya-baca lalu bayar lagi) TIDAK mengubah kolom
--    ini sama sekali — sekali diisi, cuma admin yang bisa mengubahnya
--    manual (kasus khusus).
-- 4. isFounderPricing() lama (createdAt + "periodStart tahun 2027")
--    DIHAPUS — diganti isFounderEligible()/isFounderPricing() baru di
--    subscriptionConfig.ts yang membaca founder_override+founder_price_until.
--
-- set_subscription_plan (dropdown 'pendiri'/'standar' label administratif
-- di AdminScreen.tsx) SUDAH ADA sejak migration 044 — TIDAK disentuh di
-- sini, kolom plan itu tetap murni label riwayat, BUKAN sumber harga
-- (sudah begitu sejak awal, lihat komentar di AdminScreen.tsx).

alter table subscriptions add column if not exists founder_override boolean;
alter table subscriptions add column if not exists founder_price_until date;

-- --------------------------------------------------------------
-- set_founder_override — tandai/batalkan status pendiri manual
-- --------------------------------------------------------------
-- p_clear=true mengembalikan ke OTOMATIS (null, dihitung dari created_at
-- lagi) — ini yang dipakai untuk "membatalkan", selalu boleh kapan pun.
-- p_override (true/false) cuma diperiksa tanggalnya kalau TRUE (menandai
-- baru) — menandai FALSE (force-normal, beda dari clear) sengaja tidak
-- dibatasi tanggal juga, karena itu bukan "klaim pendiri baru".
create or replace function set_founder_override(p_business_id uuid, p_override boolean, p_clear boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_app_admin() then
    raise exception 'set_founder_override: tidak berhak';
  end if;

  if not exists (select 1 from subscriptions where business_id = p_business_id) then
    raise exception 'set_founder_override: business % belum punya baris subscriptions', p_business_id;
  end if;

  if p_clear then
    update subscriptions set founder_override = null, updated_at = now() where business_id = p_business_id;
    return;
  end if;

  if p_override and (now() at time zone 'Asia/Jakarta') > timestamp '2027-01-31 23:59:59' then
    raise exception 'set_founder_override: penandaan pendiri baru sudah ditutup (batas 31 Jan 2027)';
  end if;

  update subscriptions set founder_override = p_override, updated_at = now() where business_id = p_business_id;
end;
$$;

revoke all on function set_founder_override(uuid, boolean, boolean) from public, anon;
grant execute on function set_founder_override(uuid, boolean, boolean) to authenticated;

-- --------------------------------------------------------------
-- set_founder_price_until — override manual kasus khusus (admin)
-- --------------------------------------------------------------
create or replace function set_founder_price_until(p_business_id uuid, p_until date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_app_admin() then
    raise exception 'set_founder_price_until: tidak berhak';
  end if;

  if not exists (select 1 from subscriptions where business_id = p_business_id) then
    raise exception 'set_founder_price_until: business % belum punya baris subscriptions', p_business_id;
  end if;

  update subscriptions set founder_price_until = p_until, updated_at = now() where business_id = p_business_id;
end;
$$;

revoke all on function set_founder_price_until(uuid, date) from public, anon;
grant execute on function set_founder_price_until(uuid, date) to authenticated;

-- --------------------------------------------------------------
-- record_subscription_payment — isi founder_price_until otomatis sekali
-- --------------------------------------------------------------
-- create or replace ulang persis isi migration 044, ditambah blok
-- founder_price_until di akhir (sebelum update active_until) — logika
-- lama (period math inklusif dkk) TIDAK diubah sama sekali.
create or replace function record_subscription_payment(
  p_business_id uuid,
  p_amount numeric,
  p_period_days int,
  p_method text,
  p_note text,
  p_proof_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_email text;
  current_active_until date;
  new_active_until date;
  period_start_date date;
  sub_row subscriptions;
  biz_created_at timestamptz;
  is_founder_now boolean;
begin
  if not is_app_admin() then
    raise exception 'record_subscription_payment: tidak berhak';
  end if;

  if p_period_days < 1 or p_period_days > 400 then
    raise exception 'record_subscription_payment: p_period_days di luar rentang wajar (1-400)';
  end if;
  if p_amount < 0 then
    raise exception 'record_subscription_payment: p_amount tidak boleh negatif';
  end if;

  select lower(auth.jwt() ->> 'email') into admin_email;

  select * into sub_row from subscriptions where business_id = p_business_id;
  if sub_row is null then
    raise exception 'record_subscription_payment: business % belum punya baris subscriptions', p_business_id;
  end if;
  current_active_until := sub_row.active_until;

  period_start_date := greatest(current_active_until + 1, (now() at time zone 'Asia/Jakarta')::date);
  new_active_until := period_start_date + p_period_days - 1;

  insert into subscription_payments (
    business_id, amount, period_start, period_end, method, recorded_by_email, note, proof_url
  ) values (
    p_business_id, p_amount, period_start_date, new_active_until, p_method, coalesce(admin_email, 'unknown'), p_note, p_proof_url
  );

  -- Isi founder_price_until OTOMATIS saat pembayaran pertama untuk
  -- business pendiri (otomatis ATAU override) yang kolomnya masih
  -- kosong — sekali diisi, tidak pernah ditimpa lagi di sini (jeda
  -- tidak mengubahnya, cuma set_founder_price_until manual yang bisa).
  if sub_row.founder_price_until is null then
    select created_at into biz_created_at from businesses where id = p_business_id;
    is_founder_now := coalesce(sub_row.founder_override, biz_created_at < timestamptz '2027-01-01 00:00:00+07');
    if is_founder_now then
      -- Inklusif: hari TERAKHIR bulan ke-12, bukan hari pertama bulan
      -- ke-13 (periodStart 2027-01-10 -> founder_price_until 2028-01-09,
      -- bukan 2028-01-10) -- isFounderPricing() di frontend memakai
      -- `periodStart <= founder_price_until`, jadi pembayaran yang
      -- periodStart-nya persis setahun kemudian harus SUDAH normal.
      update subscriptions
      set founder_price_until = (period_start_date + interval '12 months' - interval '1 day')::date
      where business_id = p_business_id;
    end if;
  end if;

  update subscriptions
  set active_until = new_active_until, updated_at = now()
  where business_id = p_business_id;
end;
$$;

revoke all on function record_subscription_payment(uuid, numeric, int, text, text, text) from public, anon;
grant execute on function record_subscription_payment(uuid, numeric, int, text, text, text) to authenticated;

-- --------------------------------------------------------------
-- admin_list_businesses — tambah founder_override, founder_price_until
-- --------------------------------------------------------------
-- create or replace ulang persis isi migration 045, nambah 2 kolom
-- return — logika pencarian/dedupe/status lama TIDAK diubah. DROP dulu
-- -- Postgres menolak `create or replace` yang mengubah daftar kolom
-- return table ("cannot change return type of existing function"), jadi
-- tanpa drop ini migration akan GAGAL DI TENGAH JALAN (semua statement
-- sebelumnya di atas sudah committed per-statement, cuma bagian ini yang
-- gagal) kalau dijalankan langsung tanpa drop dulu.
drop function if exists admin_list_businesses(text);
create or replace function admin_list_businesses(p_query text default null)
returns table (
  business_id       uuid,
  name               text,
  owner_email        text,
  active_until       date,
  plan               text,
  status             text,
  signed_up_at       timestamptz,
  founder_override   boolean,
  founder_price_until date
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_app_admin() then
    raise exception 'admin_list_businesses: tidak berhak';
  end if;

  return query
  select inner_q.id, inner_q.name, inner_q.owner_email, inner_q.active_until, inner_q.plan, inner_q.status, inner_q.signed_up_at,
         inner_q.founder_override, inner_q.founder_price_until
  from (
    select distinct on (b.id)
      b.id,
      b.name,
      u.email::text as owner_email,
      s.active_until,
      s.plan,
      case
        when s.active_until is null then 'aktif'
        when (now() at time zone 'Asia/Jakarta')::date <= s.active_until then 'aktif'
        when (now() at time zone 'Asia/Jakarta')::date <= (s.active_until + 7) then 'tenggang'
        else 'hanya-baca'
      end as status,
      b.created_at as signed_up_at,
      s.founder_override,
      s.founder_price_until
    from businesses b
    join business_members bm on bm.business_id = b.id and bm.role = 'owner'
    join auth.users u on u.id = bm.user_id
    left join subscriptions s on s.business_id = b.id
    where p_query is null or p_query = ''
      or b.name ilike '%' || p_query || '%'
      or u.email ilike '%' || p_query || '%'
    order by b.id, bm.created_at asc
  ) inner_q
  order by inner_q.signed_up_at desc
  limit 50;
end;
$$;

revoke all on function admin_list_businesses(text) from public, anon, authenticated;
grant execute on function admin_list_businesses(text) to authenticated;

select pg_notify('pgrst', 'reload schema');
