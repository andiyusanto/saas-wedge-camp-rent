-- ============================================================
-- Migration 005 — Status "dibatalkan" untuk bookings
-- ============================================================
-- Sebelum ini, satu-satunya cara keluar dari status "aktif" adalah lewat
-- alur pengembalian (POST /bookings/:id/return -> "selesai"/"telat").
-- Tidak ada cara membatalkan booking yang salah input sebelum tanggal
-- ambil, selain edit manual lewat Supabase.
--
-- "dibatalkan" sengaja TIDAK dimasukkan ke ACTIVE_STATUSES di
-- backend/src/lib/availability.ts, jadi booking yang dibatalkan otomatis
-- tidak lagi menghitung ke kapasitas terpakai — tidak perlu ubah logika
-- ketersediaan sama sekali. Endpoint GET /trackings juga sudah filter
-- status = 'aktif', jadi booking yang dibatalkan otomatis hilang dari
-- daftar tracking tanpa perlu perubahan tambahan di sana.

alter table bookings
  add column if not exists cancelled_at timestamptz;

alter table bookings
  drop constraint if exists bookings_status_check;

alter table bookings
  add constraint bookings_status_check
  check (status in ('aktif', 'selesai', 'telat', 'dibatalkan'));
