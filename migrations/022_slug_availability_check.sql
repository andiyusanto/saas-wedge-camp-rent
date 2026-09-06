-- ============================================================
-- Migration 022 — Cek ketersediaan slug Etalase Online live (sambil ketik)
-- ============================================================
-- Sebelum ini, tabrakan slug (mis. dua business bernama mirip yang
-- auto-generate slug sama) cuma ketahuan saat Simpan (unique constraint,
-- migration 019) — sudah benar secara data, tapi ownernya baru tahu
-- setelah submit. Function ini dipanggil dari EtalaseOnlineScreen.tsx
-- sambil owner mengetik (debounced) untuk kasih tahu lebih awal.
--
-- SECURITY DEFINER supaya bisa cek slug di SEMUA business (RLS
-- public_pages cuma izinkan owner lihat baris miliknya sendiri via
-- is_owner_of — tanpa ini, slug yang dipakai business LAIN akan salah
-- kelihatan "tersedia" karena RLS menyembunyikan baris itu). Cuma
-- balikin boolean, TIDAK PERNAH membocorkan business_id/nama pemilik
-- slug yang bentrok — exposure minimal, konsisten dengan pola
-- get_invite_preview()/get_public_page(). Dibatasi ke role `authenticated`
-- saja (bukan `anon` juga) karena ini murni dipakai dari tab Etalase
-- Online yang owner-only, tidak ada kebutuhan akses publik/anon sama
-- sekali di sini.
create or replace function is_slug_available(p_slug text, p_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public_pages
    where slug = p_slug
      and business_id <> p_business_id
  );
$$;

grant execute on function is_slug_available(text, uuid) to authenticated;
