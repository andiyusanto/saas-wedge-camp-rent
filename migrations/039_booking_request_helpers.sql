-- ============================================================
-- Migration 039 — Dua RPC kecil tambahan untuk endpoint submit publik
-- ============================================================
-- Ditemukan perlu saat menulis backend/src/routes/bookingRequests.ts
-- (tahap 2): endpoint submit butuh business_id+flag bayar dari slug
-- SEBELUM memanggil create_booking_request (037), dan butuh
-- confirmation_token baru setelah insert untuk dikirim ke klien — tidak
-- ada policy select publik di public_pages (kolom bayar) maupun
-- booking_requests (disengaja, lihat 037), jadi dua RPC tipis ini
-- menjadi SATU-SATUNYA jalur baca masing-masing, sama pola dengan
-- get_public_page (019) — daftar kolom dihardcode eksplisit, tidak
-- pernah SELECT *.

-- get_public_ordering_page: null kalau toko tidak ditemukan ATAU
-- published=false ATAU accept_online_orders=false (endpoint pemanggil
-- menganggap null sebagai "toko tidak menerima pesanan online" tanpa
-- membedakan tiga alasan itu ke klien — tidak perlu, dan menghindari
-- membocorkan info "toko ada tapi belum publish").
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
    'pay_cash_enabled', pp.pay_cash_enabled
  )
  into result
  from public_pages pp
  where pp.slug = p_slug
    and pp.published = true
    and pp.accept_online_orders = true;

  return result;
end;
$$;

revoke all on function get_public_ordering_page(text) from public, authenticated;
grant execute on function get_public_ordering_page(text) to anon;

-- get_booking_request_token: secret WAJIB cocok (sama syarat seperti
-- create_booking_request), DAN hanya mengembalikan token untuk baris
-- yang baru saja dibuat lewat secret yang sama — ini bukan jalur baca
-- bebas ("ambil token berdasarkan id apa saja"), karena id baris bisa
-- saja ditebak/di-enumerate (uuid v4 praktis tidak, tapi tetap defense
-- in depth konsisten dengan create_booking_request). Dipanggil backend
-- SEGERA setelah create_booking_request berhasil, dalam request yang
-- sama — tidak ada kebutuhan dipanggil belakangan untuk id lama.
create or replace function get_booking_request_token(p_secret text, p_booking_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  expected_secret text;
  result uuid;
begin
  select value into expected_secret from private_config where key = 'booking_request_secret';
  if expected_secret is null or p_secret is distinct from expected_secret then
    raise exception 'get_booking_request_token: secret tidak valid';
  end if;

  select confirmation_token into result
  from booking_requests
  where id = p_booking_request_id;

  return result;
end;
$$;

revoke all on function get_booking_request_token(text, uuid) from public, authenticated;
grant execute on function get_booking_request_token(text, uuid) to anon;

select pg_notify('pgrst', 'reload schema');
