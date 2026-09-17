-- ============================================================
-- Migration 029 — Denda kerusakan/kehilangan bisa ditautkan ke alat spesifik
-- ============================================================
-- Diadaptasi dari Bilbo-Outdoors: setiap penalty entry-nya ditautkan ke
-- productId spesifik dalam order (bukan cuma booking-level seperti
-- Sewalog sebelumnya). Nullable dan cuma bermakna untuk type
-- 'kerusakan'/'kehilangan' — 'keterlambatan' murni soal keterlambatan
-- pengembalian secara keseluruhan, tidak masuk akal ditautkan ke satu
-- alat spesifik dalam booking multi-item.
--
-- TIDAK di-backfill — baris lama tetap null (setara "tidak spesifik ke
-- alat tertentu", masih valid terutama untuk booking satu-alat di mana
-- penautan eksplisit tidak menambah informasi apa-apa).
alter table penalties
  add column if not exists item_id uuid references items(id);
