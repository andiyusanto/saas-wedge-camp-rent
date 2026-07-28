-- ============================================================
-- Migration 002 — Tambah deactivated_at ke businesses
-- ============================================================
-- businesses sengaja tidak punya RLS policy delete (lihat skema-final.sql)
-- supaya histori booking/item/customer tidak ikut hilang kalau vendor
-- berhenti pakai. Kolom ini jadi alternatif non-destruktif: null berarti
-- aktif, diisi timestamp kalau dinonaktifkan (kapan, bukan cuma ya/tidak).
--
-- Belum ada UI self-service untuk ini di MVP — untuk sekarang diisi manual
-- lewat Supabase Table Editor kalau ada vendor pilot yang berhenti.
--
-- Tidak perlu policy RLS baru: "owner_update_own_business" yang sudah ada
-- di skema-final.sql sudah mengizinkan owner meng-update kolom ini.

alter table businesses
  add column if not exists deactivated_at timestamptz;
