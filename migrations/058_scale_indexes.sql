-- ============================================================
-- Migration 058 — Indeks untuk skala data (brief-skala-data-2026-11.md)
-- ============================================================
-- Postgres tidak otomatis membuat indeks untuk foreign key. Dicek dulu lewat
-- pg_indexes (dijalankan Andi, 11 Nov 2026) -- keenam tabel di bawah HANYA
-- punya primary key, ditambah bookings_business_booking_number_key (business_id,
-- booking_number, migration 006). Tidak ada indeks lain yang bisa terduplikasi.
--
-- Dipicu oleh fetchActiveBookingItems() (backend/src/lib/availability.ts) yang
-- sejak perbaikan P1 brief ini memfilter eksplisit per business_id + jendela
-- tanggal (sebelumnya mengambil SEMUA booking_items tanpa filter sama sekali)
-- -- tanpa indeks ini, filter itu tetap full table scan di tabel yang bisa
-- berisi puluhan ribu baris lintas banyak vendor.
--
-- `if not exists` — idempotent, aman dijalankan ulang.

create index if not exists idx_bookings_business_start_date on bookings (business_id, start_date);
create index if not exists idx_bookings_business_status on bookings (business_id, status);
create index if not exists idx_booking_items_booking_id on booking_items (booking_id);
create index if not exists idx_booking_items_item_id on booking_items (item_id);
create index if not exists idx_deposits_booking_id on deposits (booking_id);
create index if not exists idx_penalties_booking_id on penalties (booking_id);
create index if not exists idx_booking_status_history_booking_id on booking_status_history (booking_id);
create index if not exists idx_booking_reschedules_booking_id on booking_reschedules (booking_id);
