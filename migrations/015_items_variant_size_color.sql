-- ============================================================
-- Migration 015 — Varian, Ukuran, Warna pada katalog alat
-- ============================================================
-- Pola sama seperti Bilbo-Outdoors (produk sejenis, sudah lebih dulu punya
-- ini): tiga kolom teks opsional, TIDAK ada tabel enum/lookup terpisah.
-- Pilihan di form diambil live dari nilai-nilai yang sudah pernah diketik
-- di katalog milik business yang sama (lihat ItemsScreen.tsx), jadi tidak
-- perlu migrasi data/skema tambahan tiap kali staf mengetik varian baru.

alter table items
  add column if not exists variant text,
  add column if not exists size text,
  add column if not exists color text;
