-- One-time cleanup: purge accumulated demo-account booking/customer clutter.
--
-- Bukan migration (tidak ada perubahan skema) — murni operasi data satu kali
-- untuk SATU business_id (demo), dijalankan manual di Supabase SQL Editor
-- karena butuh bypass RLS: booking_status_history sengaja TIDAK punya delete
-- policy sama sekali (append-only by design, lihat migration 008 & CLAUDE.md
-- bagian 7) — bahkan owner lewat API normal tidak bisa menghapusnya. Ini
-- SATU-SATUNYA jalur yang boleh menghapusnya, dan HANYA untuk akun demo
-- bersama ini — jangan pernah dipakai untuk data vendor asli.
--
-- Kenapa perlu: resetDemoData()/seed-demo.mjs tidak bisa hard-delete booking
-- lama (alasan yang sama di atas), jadi tiap reset MENUTUP booking run
-- sebelumnya (jadi 'dibatalkan') alih-alih menghapusnya — cocok untuk
-- integritas audit trail vendor asli, tapi berarti akun demo yang di-reset
-- berkali-kali selama development numpuk terus. Per Sep 2026: 102 booking
-- (86 di antaranya 'dibatalkan') dan 94 customer menumpuk di satu business_id
-- ini dari reset berulang sepanjang sesi development.
--
-- Aman dijalankan berkali-kali (idempotent secara efek — kalau sudah bersih,
-- tidak akan menghapus apa-apa). SETELAH menjalankan ini, panggil ulang
-- reset demo (tombol di layar login, atau `npm run seed:demo`) supaya 5
-- skenario transaksi contoh yang sekarang aktif langsung terisi lagi.

do $$
declare
  v_business_id uuid := 'a8d1e327-5e1a-4d5e-b657-489c93a46e36'; -- Demo — Coba Sewalog
begin
  delete from booking_status_history
    where booking_id in (select id from bookings where business_id = v_business_id);
  delete from penalties
    where booking_id in (select id from bookings where business_id = v_business_id);
  delete from deposits
    where booking_id in (select id from bookings where business_id = v_business_id);
  delete from booking_items
    where booking_id in (select id from bookings where business_id = v_business_id);
  delete from bookings
    where business_id = v_business_id;
  delete from customers
    where business_id = v_business_id;
end $$;
