-- ============================================================
-- Migration 059 -- RPC get_public_page_slug() untuk link status pesanan
-- ============================================================
-- Brief 12 Nov 2026 (pindah URL halaman status pesanan ke
-- toko.sewalog.com/{slug}/pesanan/{token}): TrackingScreen.tsx (frontend)
-- butuh slug Etalase business ini untuk membangun link bentuk baru.
-- public_pages SELECT RLS (migration 019) SENGAJA cuma is_owner_of() --
-- bukan is_member_of() -- karena tabel itu juga menyimpan kolom info
-- bayar (rekening/QRIS) yang memang owner-only. Permintaan Andi 12 Nov
-- 2026: KARYAWAN juga harus langsung dapat link baru (bukan fallback ke
-- format lama via redirect) -- solusinya BUKAN melonggarkan RLS select
-- public_pages (akan membocorkan kolom bayar ke karyawan), tapi satu RPC
-- SECURITY DEFINER sempit yang CUMA mengembalikan kolom `slug`, dibatasi
-- is_member_of() (owner MAUPUN karyawan), pola sama is_invite_preview()
-- dkk -- satu titik terpusat yang membatasi kolom yang boleh keluar,
-- bukan bergantung ke RLS row-level.

create or replace function get_public_page_slug(p_business_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select slug from public_pages
  where business_id = p_business_id
    and is_member_of(p_business_id);
$$;

-- Hanya untuk user login (authenticated) -- bukan anon/publik, beda dari
-- get_public_page() yang memang dipanggil createAnonClient() dari jalur
-- publik Etalase. Fungsi ini dipanggil GET /trackings lewat JWT user
-- sendiri (createRequestClient), is_member_of() di dalamnya yang jadi
-- gerbang sebenarnya terhadap business_id yang diminta.
revoke all on function get_public_page_slug(uuid) from public;
revoke all on function get_public_page_slug(uuid) from anon;
grant execute on function get_public_page_slug(uuid) to authenticated;
