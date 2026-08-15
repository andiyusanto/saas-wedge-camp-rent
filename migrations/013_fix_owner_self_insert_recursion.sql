-- ============================================================
-- Migration 013 — Perbaiki subquery yang kena blokir RLS-nya sendiri
-- ============================================================
-- Policy "insert_self_as_owner_of_own_business" (migration 012) query
-- langsung ke tabel businesses buat cek owner_id — tapi businesses.select
-- sekarang juga butuh is_member_of(), yang di titik itu masih false
-- (business_members-nya belum ada). Subquery-nya jadi ikut terblokir RLS,
-- sama persis alasan is_member_of() dibuat security definer di migration
-- 007. Solusinya sama: bungkus jadi function security definer juga.

create or replace function owns_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from businesses
    where id = target_business_id
      and owner_id = auth.uid()
  );
$$;

drop policy if exists "insert_self_as_owner_of_own_business" on business_members;

create policy "insert_self_as_owner_of_own_business"
  on business_members for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and owns_business(business_id)
  );
