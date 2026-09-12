-- ============================================================
-- Migration 025 — Alamat usaha di Info Usaha (Kelola Usaha)
-- ============================================================
-- `ReceiptData.businessAddress` (frontend/src/utils/formatters.ts) sudah
-- didesain sejak fitur struk WA/Cetak Nota dibuat, tapi tidak pernah
-- terisi — businesses belum punya kolom address sama sekali. Ditambah di
-- sini supaya field yang sudah didesain itu akhirnya aktif (struk WA +
-- Nota cetak), sekalian menjawab permintaan field "Alamat Usaha" di
-- Info Usaha.
--
-- TIDAK PERLU policy RLS baru — businesses SELECT (members_select_own_
-- business, migration 007) dan UPDATE (owner_update_own_business,
-- migration 018) sudah generic per-baris, otomatis ikut kolom baru ini.
alter table businesses
  add column if not exists address text;
