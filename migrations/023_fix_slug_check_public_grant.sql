-- ============================================================
-- Migration 023 — Perbaiki is_slug_available() masih bisa dipanggil anon
-- ============================================================
-- Migration 022 menulis komentar "dibatasi ke role authenticated saja
-- (bukan anon juga)" dan cuma `grant execute ... to authenticated` — tapi
-- Postgres SECARA DEFAULT sudah meng-grant EXECUTE ke PUBLIC begitu
-- function dibuat, kecuali di-revoke eksplisit. Karena migration 022
-- tidak pernah revoke dari PUBLIC, grant ke `authenticated` itu jadi
-- tidak berarti apa-apa — anon (yang ikut PUBLIC) tetap bisa panggil
-- function ini, diverifikasi langsung lewat curl tanpa Authorization
-- header dan tetap dapat hasil boolean yang benar.
--
-- Dampaknya kecil (cuma balikin boolean ketersediaan slug, tidak
-- membocorkan business_id/data lain), tapi tetap salah dari yang
-- didokumentasikan — diperbaiki di sini supaya konsisten.
revoke execute on function is_slug_available(text, uuid) from public;
grant execute on function is_slug_available(text, uuid) to authenticated;
