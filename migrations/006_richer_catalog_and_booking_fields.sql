-- ============================================================
-- Migration 006 — Field tambahan hasil adopsi desain template baru
-- ============================================================
-- items.category sudah ada dari skema-final.sql (plain text, sengaja
-- TIDAK dibuatkan CHECK enum di DB — daftar kategori cukup dijaga di
-- level UI supaya nambah kategori baru tidak perlu migration).

alter table items
  add column if not exists code text,
  add column if not exists image_url text,
  add column if not exists description text,
  add column if not exists condition_note text;

alter table customers
  add column if not exists address text;

alter table bookings
  add column if not exists booking_number text,
  add column if not exists dp_paid numeric not null default 0;

alter table bookings
  drop constraint if exists bookings_status_check;

alter table bookings
  add constraint bookings_status_check
  check (status in ('dipesan', 'aktif', 'selesai', 'telat', 'dibatalkan'));

-- 'dipesan' = sudah dicatat & alat sudah dialokasikan (mengurangi
-- ketersediaan), tapi belum diambil fisik oleh penyewa. Booking dibuat
-- langsung 'aktif' kalau tanggal ambil = hari ini (alur walk-in biasa),
-- atau 'dipesan' kalau tanggal ambil di masa depan (reservasi duluan).
-- Transisi dipesan -> aktif lewat POST /api/bookings/:id/pickup.

create unique index if not exists bookings_business_booking_number_key
  on bookings (business_id, booking_number);

alter table deposits
  add column if not exists note text;

alter table deposits
  drop constraint if exists deposits_type_check;

alter table deposits
  add constraint deposits_type_check
  check (type in ('ktp', 'sim', 'stnk', 'paspor', 'uang', 'lainnya'));
