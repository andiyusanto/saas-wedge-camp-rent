-- ============================================================
-- Migration 003 — Jam pengembalian & toleransi telat per vendor
-- ============================================================
-- Perlu buat hitung denda keterlambatan berbasis jam (bukan cuma tanggal):
-- lihat diskusi fitur "tracking jaminan & denda". due_at satu booking
-- dihitung dari end_date + jam dari bookings.created_at (jam ambil barang),
-- lalu dibandingkan ke actual_return_at yang sekarang presisi ke jam/menit.

alter table bookings
  rename column actual_return_date to actual_return_at;

alter table bookings
  alter column actual_return_at type timestamptz
  using actual_return_at::timestamptz;

alter table businesses
  add column if not exists late_tolerance_hours integer not null default 6;
