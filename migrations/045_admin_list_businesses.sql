-- ============================================================
-- Migration 045 — RPC admin: cari business lintas-vendor
-- ============================================================
-- Review -c1 (31 Okt 2026) poin 2: Alat Admin (rencana langganan) butuh
-- lihat data LINTAS business, tapi RLS businesses/business_members/
-- subscriptions semuanya is_member_of-scoped — query biasa dari admin
-- yang login cuma akan lihat business MILIKNYA SENDIRI (kalau dia juga
-- member business manapun, yang mestinya tidak), bukan semua business.
-- Satu RPC SECURITY DEFINER baru, is_app_admin() wajib, membaca
-- auth.users langsung (sama pola seperti business_is_writable, migration
-- 044, yang sudah terverifikasi aman membaca tabel itu dari dalam
-- function security definer).
--
-- p_query: cocokkan ke nama usaha ATAU email owner (ilike, case-
-- insensitive, substring) — kosong/null = balikin semua (dibatasi 50
-- baris terbaru, bukan semua sekaligus, supaya tidak jadi query berat
-- kalau business sudah ribuan).
create or replace function admin_list_businesses(p_query text default null)
returns table (
  business_id   uuid,
  name          text,
  owner_email   text,
  active_until  date,
  plan          text,
  status        text,
  signed_up_at  timestamptz
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

  -- Review -c1 ronde 2: satu business bisa punya LEBIH dari satu
  -- `business_members.role='owner'` (co-owner) — join langsung ke
  -- business_members+auth.users tanpa dedupe akan menghasilkan SATU
  -- BARIS PER OWNER, bukan satu baris per business. `distinct on (b.id)`
  -- di subquery dalam (diurut ke owner PALING AWAL gabung, bm.created_at)
  -- memastikan tepat satu baris per business sebelum di-order+limit lagi
  -- di query luar — urutan DISTINCT ON butuh `order by` yang DIAWALI
  -- kolom distinct-nya sendiri (b.id), jadi pengurutan akhir yang
  -- sebenarnya diinginkan (created_at desc) harus di query LUAR, bukan
  -- di subquery ini.
  return query
  select inner_q.id, inner_q.name, inner_q.owner_email, inner_q.active_until, inner_q.plan, inner_q.status, inner_q.signed_up_at
  from (
    select distinct on (b.id)
      b.id,
      b.name,
      u.email::text as owner_email,
      s.active_until,
      s.plan,
      -- Status turunan SAMA PERSIS aturan business_is_writable() (migration
      -- 044) — tenggang 7 hari, bukan dihitung ulang dengan rumus beda.
      -- TIDAK mengecualikan demo di sini (admin MEMANG perlu lihat baris
      -- demo apa adanya di daftar, beda dari business_is_writable yang
      -- exempt demo dari penguncian — dua tujuan berbeda).
      case
        when s.active_until is null then 'aktif' -- baris subscriptions hilang, fail-safe sama seperti business_is_writable
        when (now() at time zone 'Asia/Jakarta')::date <= s.active_until then 'aktif'
        when (now() at time zone 'Asia/Jakarta')::date <= (s.active_until + 7) then 'tenggang'
        else 'hanya-baca'
      end as status,
      b.created_at as signed_up_at
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
