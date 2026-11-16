-- Perbaikan URGENT (17 Nov 2026) -- FK ke bookings(id) tanpa ON DELETE
-- CASCADE memblokir dua jalur yang SUDAH ADA di produksi:
-- 1. reset_demo_bookings() (migration 036) -- "Reset data demo" gagal
--    409 (postgres 23503) begitu ada booking demo dengan baris
--    booking_payments (migration 067, trigger log_initial_dp_payment()
--    menulis baris ini OTOMATIS setiap kali dp_paid>0 saat booking
--    dibuat -- jadi hampir pasti kena begitu demo dipakai).
-- 2. Compensating delete (unwind) di POST /bookings (backend/src/
--    routes/bookings.ts) -- kalau booking_items/deposit/barang jual
--    gagal disimpan SETELAH booking+trigger DP berhasil, unwind-nya
--    `delete from bookings where id=...` akan GAGAL untuk transaksi
--    dp_paid>0 dengan alasan FK yang SAMA -- booking yatim tertinggal
--    (booking ada tapi items-nya tidak lengkap) dan stok ikut salah
--    hitung (usedUnitsOn menghitung booking yatim itu sebagai permintaan
--    stok asli). Ini bug produksi nyata, bukan cuma demo.
--
-- Audit FK lain ke bookings(id) (migrations 008/055/061/066/067) --
-- cuma booking_sale_items (066) yang SUDAH `on delete cascade` sejak
-- awal. booking_status_history (008)/penalties/deposits/booking_items
-- SUDAH dihapus eksplisit oleh reset_demo_bookings() dan unwind
-- POST /bookings SEBELUM delete bookings, jadi tidak pernah kena FK
-- ini -- TIDAK perlu diubah. booking_reschedules (055) dan
-- booking_item_changes (061) TERNYATA py bug LAMA yang sama (TIDAK
-- disebabkan oleh pekerjaan Pelunasan 17 Nov 2026) -- tidak pernah
-- dihapus eksplisit oleh reset_demo_bookings() ATAU unwind, dan tidak
-- cascade -- kalau demo booking manapun sempat punya riwayat Ubah
-- Jadwal/Ubah Alat, reset akan gagal dengan cara yang sama. Diperbaiki
-- sekalian di migration yang sama karena akar masalahnya identik.
--
-- booking_payments tetap APPEND-ONLY (tidak ada policy update/delete
-- untuk member, CLAUDE.md bagian 6/7) -- cascade ini TIDAK membuka
-- jalur hapus baru untuk member mana pun, cuma berlaku saat booking
-- INDUKNYA dihapus lewat reset_demo_bookings()/unwind (dua-duanya
-- SECURITY DEFINER/service-role, bukan jalur member biasa). Riwayat
-- pembayaran booking yang DIBATALKAN (bukan dihapus) tetap aman --
-- Batalkan/Void (migration 067) TIDAK PERNAH menghapus baris bookings,
-- cuma UPDATE status.
--
-- Idempoten: drop constraint if exists sebelum add ulang, pola
-- migration 061/064/066 -- file ini aman dijalankan berulang.

alter table booking_payments drop constraint if exists booking_payments_booking_id_fkey;
alter table booking_payments
  add constraint booking_payments_booking_id_fkey foreign key (booking_id) references bookings(id) on delete cascade;

alter table booking_reschedules drop constraint if exists booking_reschedules_booking_id_fkey;
alter table booking_reschedules
  add constraint booking_reschedules_booking_id_fkey foreign key (booking_id) references bookings(id) on delete cascade;

alter table booking_item_changes drop constraint if exists booking_item_changes_booking_id_fkey;
alter table booking_item_changes
  add constraint booking_item_changes_booking_id_fkey foreign key (booking_id) references bookings(id) on delete cascade;
