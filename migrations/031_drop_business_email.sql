-- ============================================================
-- Migration 031 — Batalkan businesses.email (migration 030)
-- ============================================================
-- Salah paham scope: field "Email" yang diminta di Info Usaha ternyata
-- maksudnya menampilkan email AKUN LOGIN pemilik (informasi, bukan
-- kontak bebas-isi baru) — sudah ada snapshot-nya di
-- business_members.email (migration 010, role='owner'), jadi kolom
-- businesses.email yang baru ditambah migration 030 tidak perlu dan
-- dibatalkan di sini supaya tidak ada dua sumber "email usaha" yang
-- membingungkan.
alter table businesses
  drop column if exists email;
