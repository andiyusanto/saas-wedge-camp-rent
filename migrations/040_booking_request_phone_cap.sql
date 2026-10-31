-- ============================================================
-- Migration 040 — Cek batas pesanan 'menunggu' per nomor WA (rencana 2.7)
-- ============================================================
-- Ditemukan perlu setelah review -c1 pada tahap 2: batas "maks 3
-- pesanan 'menunggu' bersamaan per nomor WA per business" butuh baca
-- booking_requests dari endpoint submit publik (anon, sebelum insert),
-- tapi tabel itu sengaja TIDAK punya policy select untuk anon (migration
-- 037 bagian 4). RPC tipis ini satu-satunya jalur baca untuk pengecekan
-- itu — secret sama seperti create_booking_request (defense in depth
-- yang sama), cuma mengembalikan COUNT, bukan data pesanan apa pun.
create or replace function count_pending_booking_requests_by_phone(
  p_secret text,
  p_business_id uuid,
  p_customer_phone text
)
returns int
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  expected_secret text;
  result int;
begin
  select value into expected_secret from private_config where key = 'booking_request_secret';
  if expected_secret is null or p_secret is distinct from expected_secret then
    raise exception 'count_pending_booking_requests_by_phone: secret tidak valid';
  end if;

  select count(*) into result
  from booking_requests
  where business_id = p_business_id
    and customer_phone = p_customer_phone
    and status = 'menunggu'
    and expires_at > now();

  return result;
end;
$$;

revoke all on function count_pending_booking_requests_by_phone(text, uuid, text) from public, authenticated;
grant execute on function count_pending_booking_requests_by_phone(text, uuid, text) to anon;

select pg_notify('pgrst', 'reload schema');
