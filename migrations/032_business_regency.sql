-- ============================================================
-- Migration 032 — Kota usaha di Info Usaha (Kelola Usaha)
-- ============================================================
-- Etalase Online (public_pages.regency_id, migration 019) sudah punya
-- pilihan Kota, tapi cuma dipakai buat halaman publik — Info Usaha
-- sendiri belum punya field ini untuk data usaha secara umum. Reuse
-- tabel `regencies` yang sama (3 baris Malang Raya, lihat CLAUDE.md
-- bagian 3 & 7), bukan bikin tabel/enum kota baru.
--
-- TIDAK PERLU policy RLS baru — businesses SELECT/UPDATE (migration 007)
-- sudah generic per-baris, dan regencies sudah public_read_regencies
-- (skema-final.sql).
alter table businesses
  add column if not exists regency_id uuid references regencies(id);
