-- ============================================================
-- Migration 004 — Tambah deactivated_at ke items
-- ============================================================
-- Sama seperti businesses.deactivated_at (lihat migration 002): items
-- sengaja tidak dihapus permanen (hard delete akan gagal kalau alat
-- sudah pernah dipakai di booking_items, karena ada foreign key ke
-- items.id) dan akan menghilangkan histori transaksi lama. Kolom ini
-- jadi cara non-destruktif untuk "matikan dari katalog aktif" —
-- null berarti aktif, diisi timestamp kalau dinonaktifkan.
--
-- Item yang dinonaktifkan tetap disimpan supaya nama alat masih bisa
-- ditampilkan di histori booking lama, tapi disembunyikan dari daftar
-- alat aktif dan dari pilihan alat saat Catat Transaksi.
--
-- Tidak perlu policy RLS baru: "owner_modify_own_items" yang sudah ada
-- di skema-final.sql (for all) sudah mengizinkan owner meng-update kolom ini.

alter table items
  add column if not exists deactivated_at timestamptz;
