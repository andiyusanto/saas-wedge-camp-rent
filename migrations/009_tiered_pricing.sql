-- ============================================================
-- Migration 009 — Harga bertingkat per-hari (versi sederhana)
-- ============================================================
-- Bukan tabel harga per-hari penuh ala Bilbo (day1..day5 + extraDayRate).
-- Cukup: harga normal (price_per_day, sudah ada) berlaku sampai
-- discount_min_days hari, setelah itu discounted_price_per_day berlaku
-- untuk sisa harinya. discounted_price_per_day null = tidak ada diskon,
-- perilaku sama seperti sebelum migration ini.
--
-- Sengaja TIDAK dipakai untuk hitung denda keterlambatan — formula denda
-- (backend/src/lib/penalty.ts) tetap pakai price_per_day biasa per hari
-- telat, bukan tarif diskon. Telat tidak seharusnya dapat harga sewa
-- panjang.

alter table items
  add column if not exists discount_min_days integer not null default 5,
  add column if not exists discounted_price_per_day numeric;
