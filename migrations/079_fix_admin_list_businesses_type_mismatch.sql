-- ============================================================
-- Migration 079 — Perbaiki tipe int/bigint di admin_list_businesses
-- (bug produksi setelah migration 076)
-- ============================================================
-- DRAFT -- kirim untuk review koordinator SEBELUM dijalankan Andi.
--
-- Bug: Alat Admin gagal dimuat dengan error "structure of query does
-- not match function result type". Akar masalah: RETURNS TABLE
-- mendeklarasikan active_items_count int dan txn_count_month int,
-- tapi subquery count(*) selalu menghasilkan bigint di Postgres --
-- plpgsql RETURN QUERY menolak konversi implisit bigint->int. Kolom
-- lain (plan, status, active_until, founder_price_until,
-- perkenalan_price_until, perkenalan_locked_forever, last_active_date,
-- referred_by_name, txn_value_month, total_count) diperiksa ulang
-- terhadap tipe kolom aslinya (lihat migrations 060/074 untuk
-- subscriptions, skema items/bookings/businesses) -- semuanya cocok,
-- cuma dua kolom count(*) ini yang bermasalah.
--
-- Kenapa verifikasi migration 076 tidak menangkap ini: Postgres
-- memeriksa kecocokan tipe tuple PER BARIS saat RETURN QUERY benar-
-- benar mengonstruksi baris hasil -- kalau query dalam fungsi
-- menghasilkan NOL baris, tidak ada tuple yang dikonstruksi, jadi
-- tidak ada error. Verifikasi sesi ini hanya menguji jalur PENOLAKAN
-- (anon/non-admin dipanggil -- fungsi raise exception "tidak berhak"
-- SEBELUM sampai ke RETURN QUERY, jadi mismatch tipe tidak pernah
-- tereksekusi) -- sesi ini tidak memanggil fungsi ini sebagai admin
-- sungguhan dengan baris non-demo yang benar-benar dikembalikan
-- (sesuai kebijakan sesi ini: tidak pernah mencoba/menebak kredensial
-- akun admin). Andi yang pertama kali memanggilnya sebagai admin
-- sungguhan di produksi dengan baris hasil > 0 -- di situlah baru
-- ketahuan.
--
-- Fix: CREATE OR REPLACE dengan signature dan RETURNS TABLE SAMA
-- PERSIS seperti migration 076 (tidak ada parameter/kolom yang
-- berubah, jadi TIDAK perlu DROP seperti kasus overload 073/077) --
-- cukup tambah cast ::int di dua subquery count(*) itu. Grant/revoke
-- tidak berubah.
--
-- scripts/admin-metrics-parity.sql TIDAK terdampak -- script itu
-- SQL biasa di SQL Editor (bukan panggilan ke fungsi ini), tidak
-- pernah terikat RETURNS TABLE, jadi count(*) bigint di sana sudah
-- selalu valid dan tidak perlu diubah.

create or replace function admin_list_businesses(
  p_query text default null,
  p_signup_month date default null,
  p_metrics_month date default (date_trunc('month', now() at time zone 'Asia/Jakarta'))::date,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  business_id       uuid,
  name               text,
  owner_email        text,
  active_until       date,
  plan               text,
  status             text,
  signed_up_at       timestamptz,
  founder_override   boolean,
  founder_price_until date,
  perkenalan_price_until date,
  perkenalan_locked_forever boolean,
  active_items_count  int,
  txn_count_month     int,
  txn_value_month     numeric,
  last_active_date    date,
  referred_by_name    text,
  total_count         bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  metrics_month_norm  date := date_trunc('month', coalesce(p_metrics_month, (now() at time zone 'Asia/Jakarta')::date));
  signup_month_norm   date := case when p_signup_month is null then null else date_trunc('month', p_signup_month)::date end;
  metrics_month_start date := metrics_month_norm;
  metrics_month_end   date := (metrics_month_norm + interval '1 month')::date;
  safe_limit  int := least(greatest(coalesce(p_limit, 50), 1), 200);
  safe_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if not is_app_admin() then
    raise exception 'admin_list_businesses: tidak berhak';
  end if;

  return query
  select
    inner_q.id, inner_q.name, inner_q.owner_email, inner_q.active_until, inner_q.plan, inner_q.status, inner_q.signed_up_at,
    inner_q.founder_override, inner_q.founder_price_until, inner_q.perkenalan_price_until, inner_q.perkenalan_locked_forever,
    inner_q.active_items_count, inner_q.txn_count_month, inner_q.txn_value_month, inner_q.last_active_date,
    inner_q.referred_by_name,
    count(*) over () as total_count
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
      s.founder_price_until,
      s.perkenalan_price_until,
      s.perkenalan_locked_forever,
      -- FIX migration 079: count(*) selalu bigint -- cast ::int
      -- supaya cocok dengan RETURNS TABLE (tidak diubah jadi bigint
      -- di RETURNS TABLE supaya signature/grant tetap sama persis
      -- dan frontend yang sudah membaca sebagai number tidak terdampak).
      (select count(*) from items i where i.business_id = b.id and i.deactivated_at is null)::int as active_items_count,
      (
        select count(*) from bookings bk
        where bk.business_id = b.id
          and bk.status <> 'dibatalkan'
          and (bk.created_at at time zone 'Asia/Jakarta') >= metrics_month_start
          and (bk.created_at at time zone 'Asia/Jakarta') < metrics_month_end
      )::int as txn_count_month,
      (
        select coalesce(sum(bk.total_price), 0) from bookings bk
        where bk.business_id = b.id
          and bk.status <> 'dibatalkan'
          and (bk.created_at at time zone 'Asia/Jakarta') >= metrics_month_start
          and (bk.created_at at time zone 'Asia/Jakarta') < metrics_month_end
      ) as txn_value_month,
      (
        select max(bk.created_at) at time zone 'Asia/Jakarta'
        from bookings bk
        where bk.business_id = b.id and bk.status <> 'dibatalkan'
      )::date as last_active_date,
      (
        select rb.name from referrals ref
        join businesses rb on rb.id = ref.referrer_business_id
        where ref.referred_business_id = b.id
        limit 1
      ) as referred_by_name
    from businesses b
    join business_members bm on bm.business_id = b.id and bm.role = 'owner'
    join auth.users u on u.id = bm.user_id
    left join subscriptions s on s.business_id = b.id
    where not is_demo_business(b.id)
      and (p_query is null or p_query = ''
           or b.name ilike '%' || p_query || '%'
           or u.email ilike '%' || p_query || '%')
      and (signup_month_norm is null
           or date_trunc('month', b.created_at at time zone 'Asia/Jakarta')::date = signup_month_norm)
    order by b.id, bm.created_at asc
  ) inner_q
  order by inner_q.signed_up_at desc, inner_q.id
  limit safe_limit offset safe_offset;
end;
$$;

revoke all on function admin_list_businesses(text, date, date, int, int) from public, anon, authenticated;
grant execute on function admin_list_businesses(text, date, date, int, int) to authenticated;

select pg_notify('pgrst', 'reload schema');
