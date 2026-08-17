-- ============================================================
-- Migration 014 — Kelola Karyawan (manajemen tim) khusus owner
-- ============================================================
-- Sebelumnya karyawan & owner disamakan penuh (migration 007, "role cuma
-- label bukan pembatas akses"). SEKARANG ada satu pengecualian eksplisit:
-- mengundang anggota baru dan mengeluarkan anggota dari tim cuma boleh
-- dilakukan owner. Operasional harian (kalender, transaksi, jaminan &
-- denda, katalog) TETAP sama untuk karyawan, tidak berubah oleh migration
-- ini — cuma menu Kelola Karyawan yang jadi owner-only.
--
-- SELECT business_members & business_invites SENGAJA TIDAK diubah:
-- - business_members select dipakai juga di luar layar Kelola Karyawan
--   (baris "diperbarui oleh X" di Katalog & Stok Alat, lihat migration 008
--   + ItemsScreen.tsx), jadi tetap terbuka ke semua anggota termasuk
--   karyawan.
-- - business_invites select sengaja publik (using true) sejak awal,
--   dibutuhkan alur redeem undangan oleh user yang belum jadi anggota sama
--   sekali — tidak bisa dibuat owner-only tanpa merusak alur itu. Endpoint
--   backend (routes/team.ts) yang menyaring & menegakkan owner-only untuk
--   pemakaian di layar Kelola Karyawan.

create or replace function is_owner_of(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from business_members
    where business_id = target_business_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

drop policy if exists "members_delete_own_business_members" on business_members;
create policy "owner_delete_business_members"
  on business_members for delete
  using (is_owner_of(business_id));

drop policy if exists "members_create_invites" on business_invites;
create policy "owner_create_invites"
  on business_invites for insert
  with check (is_owner_of(business_id) and created_by = auth.uid());

drop policy if exists "members_delete_own_invites" on business_invites;
create policy "owner_delete_invites"
  on business_invites for delete
  using (is_owner_of(business_id));
