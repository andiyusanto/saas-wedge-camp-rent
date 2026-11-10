-- ============================================================
-- Migration 057 -- Perbaiki grant RPC notifikasi push (migration 056)
-- ============================================================
-- Bug ditemukan lewat review -c1 setelah verifikasi live migration 056:
-- `get_push_subscriptions_for_business` dan `record_push_result`
-- di-revoke dari anon/public TANPA grant execute balik ke anon --
-- beda dari create_booking_request (037/054/dst) yang SELALU diikuti
-- `grant execute ... to anon` setelah revoke-nya. Akibatnya backend
-- (createAnonClient(), dipanggil dari jalur publik anonim) mendapat
-- "permission denied for function" bahkan dengan secret yang BENAR --
-- push TIDAK PERNAH terkirim di produksi, dan sendPushToBusiness()
-- menelan error itu diam-diam (ditutup di migration ini juga lewat
-- logging tambahan di webPush.ts, bukan di sini).
--
-- Pola yang benar: fungsi tetap bisa dipanggil anon (secara koneksi),
-- tapi isi fungsi sendiri yang jadi gerbang sebenarnya lewat
-- perbandingan p_secret dengan private_config -- persis
-- create_booking_request. Migration 056 TIDAK diubah (sudah dijalankan
-- Andi) -- perbaikan ini murni menambah grant yang kelupaan.
-- ============================================================

revoke all on function get_push_subscriptions_for_business(text, uuid) from public;
revoke all on function get_push_subscriptions_for_business(text, uuid) from authenticated;
grant execute on function get_push_subscriptions_for_business(text, uuid) to anon;

revoke all on function record_push_result(text, uuid, boolean) from public;
revoke all on function record_push_result(text, uuid, boolean) from authenticated;
grant execute on function record_push_result(text, uuid, boolean) to anon;
