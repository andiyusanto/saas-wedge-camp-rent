-- ============================================================
-- Migration 010 — Snapshot email di business_members
-- ============================================================
-- business_members cuma punya user_id (uuid) — nggak ada cara app-level
-- (RLS-scoped) buat tampilkan "siapa karyawan ini" ke pemilik, karena
-- baca auth.users langsung tidak diizinkan lewat client biasa. Kolom ini
-- snapshot email saat member itu bergabung (pola sama seperti kolom
-- snapshot lain di project ini, mis. booking_items.price_at_booking).
--
-- Backfill baris lama boleh join ke auth.users langsung karena migration
-- ini dijalankan lewat SQL Editor (hak akses penuh), beda dengan request
-- runtime app yang selalu lewat RLS.

alter table business_members
  add column if not exists email text;

update business_members bm
set email = u.email
from auth.users u
where bm.user_id = u.id
  and bm.email is null;

alter table business_members
  alter column email set not null;
