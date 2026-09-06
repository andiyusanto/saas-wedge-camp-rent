-- ============================================================
-- Migration 024 — is_slug_available() masih bisa dipanggil anon (lagi)
-- ============================================================
-- Migration 023 me-revoke dari PUBLIC, tapi diverifikasi lewat curl tanpa
-- Authorization header dan TETAP dapat hasil boolean — anon masih bisa
-- panggil. Penyebabnya: Supabase men-setup project baru dengan
-- `alter default privileges in schema public grant execute on functions
-- to anon, authenticated, service_role` (sama seperti kenapa tabel di
-- schema public tidak pernah butuh GRANT eksplisit di migration manapun
-- di repo ini — cuma RLS yang jadi penjaga sebenarnya untuk tabel). Ini
-- artinya `anon` dapat privilege EXECUTE-nya LANGSUNG (bukan lewat PUBLIC
-- pseudo-role), jadi revoke dari PUBLIC saja tidak menyentuhnya sama
-- sekali — harus revoke dari `anon` secara eksplisit.
revoke execute on function is_slug_available(text, uuid) from anon;

-- Verifikasi ulang setelah migration ini: panggil RPC ini TANPA
-- Authorization header (curl -H "apikey: ..." saja) harus balikin error
-- permission denied, bukan hasil boolean.
