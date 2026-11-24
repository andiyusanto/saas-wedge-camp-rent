-- ============================================================
-- Migration 076 — Metrik per rental di Alat Admin
-- research/brief-admin-metrik-rental-2026-12.md, 24 Nov 2026
-- ============================================================
-- DRAFT -- kirim untuk review koordinator SEBELUM dijalankan Andi.
--
-- Dua bagian independen:
-- A. Trigger memaksa business_reviews.updated_by /
--    business_review_consents.created_by = auth.uid() (catatan
--    keamanan tertunda dari migration 074, lihat CLAUDE.md bagian 6).
-- B. admin_list_businesses diperluas (DROP+CREATE, bukan fungsi baru
--    terpisah -- sudah dua kali di-DROP+CREATE sebelumnya di 073/074,
--    satu sumber kebenaran lebih mudah dirawat daripada dua fungsi
--    admin yang hampir sama) dengan kolom metrik + filter bulan +
--    paginasi.

-- ================================================================
-- A. Paksa created_by/updated_by = auth.uid() (bukti izin tidak
--    boleh dipalsukan dari klien)
-- ================================================================
create or replace function force_review_actor_to_auth_uid()
returns trigger
language plpgsql
security invoker
as $$
begin
  if tg_table_name = 'business_reviews' then
    new.updated_by := auth.uid();
  elsif tg_table_name = 'business_review_consents' then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function force_review_actor_to_auth_uid() from public, anon;

drop trigger if exists force_review_actor on business_reviews;
create trigger force_review_actor
  before insert or update on business_reviews
  for each row execute function force_review_actor_to_auth_uid();

drop trigger if exists force_review_consent_actor on business_review_consents;
create trigger force_review_consent_actor
  before insert on business_review_consents
  for each row execute function force_review_actor_to_auth_uid();

-- ================================================================
-- B. Metrik per rental + filter bulan + paginasi
-- ================================================================

-- Index baru -- migration 058 cuma menambah (business_id, start_date)
-- dan (business_id, status); agregasi/filter per bulan di sini perlu
-- (business_id, created_at) yang belum ada.
create index if not exists idx_bookings_business_created_at on bookings (business_id, created_at);

-- Helper identifikasi business demo -- SATU definisi dipakai di sini,
-- SAMA persis kriteria scripts/weekly-metrics.sql dan reset_demo_bookings
-- (migration 036): owner dengan email snapshot demo.pemilik@sewalog.test.
-- scripts/weekly-metrics.sql SENDIRI TIDAK diubah (read-only, "apa
-- adanya" per brief) -- helper ini cuma dipakai fungsi admin baru.
create or replace function is_demo_business(p_business_id uuid)
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1 from business_members
    where business_id = p_business_id
      and role = 'owner'
      and email = 'demo.pemilik@sewalog.test'
  );
$$;

revoke all on function is_demo_business(uuid) from public, anon;

drop function if exists admin_list_businesses(text);
create or replace function admin_list_businesses(
  p_query text default null,
  -- Bulan DAFTAR (filter businesses.created_at) -- null = tanpa filter.
  p_signup_month date default null,
  -- Bulan TRANSAKSI untuk kolom "Transaksi"/"Nilai transaksi" -- default
  -- bulan berjalan (WIB), TERPISAH dari p_signup_month (brief: dua
  -- filter independen).
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
  -- Kolom baru (brief admin-metrik-rental) --
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
  -- p_metrics_month null (eksplisit, bukan cuma default parameter yang
  -- diabaikan) sebelumnya membuat rentang metrics_month_start/end jadi
  -- null, sehingga SELURUH hitungan bulan diam-diam 0 -- coalesce ke
  -- bulan berjalan WIB, DAN dinormalisasi ke tanggal 1 lewat date_trunc
  -- supaya input tengah bulan (mis. '2026-11-15') tetap berarti bulan
  -- itu secara utuh, bukan cuma dari tanggal 15. Sama untuk p_signup_month.
  metrics_month_norm  date := date_trunc('month', coalesce(p_metrics_month, (now() at time zone 'Asia/Jakarta')::date));
  signup_month_norm   date := case when p_signup_month is null then null else date_trunc('month', p_signup_month)::date end;
  metrics_month_start date := metrics_month_norm;
  metrics_month_end   date := (metrics_month_norm + interval '1 month')::date;
  -- Paginasi -- batasi p_limit ke rentang wajar (1-200) dan p_offset
  -- tidak boleh negatif, supaya panggilan iseng/salah tidak membebani
  -- Postgres atau membalik urutan.
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
      -- "Alat aktif" = items NON-deactivated (brief), BEDA dari Blok 3
      -- weekly-metrics.sql yang menghitung SEMUA items termasuk yang
      -- nonaktif -- disengaja (lebih mewakili stok yang sungguh bisa
      -- disewakan sekarang), bukan ketidaksengajaan, lihat CLAUDE.md.
      (select count(*) from items i where i.business_id = b.id and i.deactivated_at is null) as active_items_count,
      (
        select count(*) from bookings bk
        where bk.business_id = b.id
          and bk.status <> 'dibatalkan'
          and (bk.created_at at time zone 'Asia/Jakarta') >= metrics_month_start
          and (bk.created_at at time zone 'Asia/Jakarta') < metrics_month_end
      ) as txn_count_month,
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
