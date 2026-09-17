-- ============================================================
-- Migration 030 — Email usaha di Info Usaha (Kelola Usaha)
-- ============================================================
-- Field kontak baru di samping No. telepon, murni informasi tambahan
-- (belum dipakai di struk WA/Nota Sewa/Etalase Online — beda dari
-- address di migration 025 yang memang didesain untuk itu).
--
-- TIDAK PERLU policy RLS baru — businesses SELECT (members_select_own_
-- business, migration 007) dan UPDATE (owner_update_own_business,
-- migration 018) sudah generic per-baris, otomatis ikut kolom baru ini.
alter table businesses
  add column if not exists email text;
