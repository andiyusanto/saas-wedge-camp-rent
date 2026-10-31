-- ============================================================
-- Migration 042 — Tambah logo_url ke get_booking_request_status
-- ============================================================
-- Ditemukan perlu dari review tampilan tahap 3 (-c1): halaman status
-- adalah tempat pelanggan mentransfer uang — identitas toko (logo+nama)
-- harus paling menonjol di atas (kepercayaan + mencegah salah transfer
-- ke toko lain), bukan cuma judul generik "Status Pesanan Online".
--
-- `logo_url` (businesses.logo_url, migration 035) SUDAH publik lewat
-- get_public_page() — menambahkannya di sini BUKAN exposure baru, sama
-- alasan seperti public_phone/slug di migration 041. business_id TETAP
-- tidak pernah dikembalikan ke JSON. Signature sama (uuid), grant
-- ditulis ulang eksplisit sesuai konvensi.
create or replace function get_booking_request_status(p_token uuid)
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
    'status', case when br.status = 'menunggu' and br.expires_at <= now() then 'kedaluwarsa' else br.status end,
    'customer_name', br.customer_name,
    'start_date', br.start_date,
    'end_date', br.end_date,
    'estimated_price', br.estimated_price,
    'payment_method', br.payment_method,
    'dp_amount', br.dp_amount,
    'rejection_reason', br.rejection_reason,
    'business_name', b.name,
    'logo_url', b.logo_url,
    'public_phone', pp.public_phone,
    'slug', pp.slug,
    'confirmation_message', pp.confirmation_message,
    'payment_snapshot', case when br.status = 'dikonfirmasi' then br.payment_snapshot else null end,
    'items', (
      select coalesce(json_agg(
        json_build_object('name', i.name, 'quantity', bri.quantity)
      ), '[]'::json)
      from booking_request_items bri
      join items i on i.id = bri.item_id
      where bri.booking_request_id = br.id
    )
  )
  into result
  from booking_requests br
  join businesses b on b.id = br.business_id
  left join public_pages pp on pp.business_id = br.business_id
  where br.confirmation_token = p_token;

  return result; -- null kalau token tidak ada — caller balikin 404
end;
$$;

revoke all on function get_booking_request_status(uuid) from public;
revoke all on function get_booking_request_status(uuid) from authenticated;
grant execute on function get_booking_request_status(uuid) to anon;

select pg_notify('pgrst', 'reload schema');
