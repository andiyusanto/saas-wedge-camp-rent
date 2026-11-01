-- ============================================================
-- Migration 048 — Tambah syarat sewa ke get_public_ordering_page
-- ============================================================
-- Celah ditemukan saat membangun UI form pesanan: migration 047 (Syarat
-- & Ketentuan) menambahkan terms_content/terms_version_id ke
-- get_public_page (katalog) dan get_booking_request_status (halaman
-- status), tapi TIDAK ke get_public_ordering_page (terakhir disentuh
-- migration 046) — padahal endpoint /ordering-config (backend/src/
-- routes/etalase.ts) yang dipakai form pesanan untuk mengambil versi
-- syarat FRESH tiap kali keranjang dibuka justru manggil RPC ini, bukan
-- get_public_page. Tanpa ini form tidak pernah tahu versi mana yang
-- harus dikirim balik sebagai p_terms_version_id ke create_booking_request
-- (migration 047) — selalu null, jadi submit SELALU ditolak begitu toko
-- punya syarat aktif.
create or replace function get_public_ordering_page(p_slug text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result json;
begin
  select json_build_object(
    'business_id', pp.business_id,
    'pay_transfer_enabled', pp.pay_transfer_enabled,
    'pay_qris_enabled', pp.pay_qris_enabled,
    'pay_cash_enabled', pp.pay_cash_enabled,
    'confirmation_deadline_hours', pp.confirmation_deadline_hours,
    'writable', business_is_writable(pp.business_id),
    'terms_content', rtv.content,
    'terms_version_id', pp.current_terms_version_id
  )
  into result
  from public_pages pp
  left join rental_terms_versions rtv on rtv.id = pp.current_terms_version_id
  where pp.slug = p_slug
    and pp.published = true
    and pp.accept_online_orders = true;

  return result;
end;
$$;

revoke all on function get_public_ordering_page(text) from public, authenticated;
grant execute on function get_public_ordering_page(text) to anon;

select pg_notify('pgrst', 'reload schema');
