-- ============================================================
-- Migration 041 — Tambah public_phone+slug ke get_booking_request_status
-- ============================================================
-- Ditemukan perlu saat menyusun rencana tahap 3 (halaman status
-- /pesanan/:token): tombol utama halaman itu "Kirim pesanan ke WA
-- {toko}" (rencana 2.5, menggantikan Sewalog mengirim WA sendiri — NOL
-- biaya WA API) butuh nomor WA PUBLIK vendor, tapi get_booking_request_status
-- (037) sama sekali tidak mengembalikannya, dan halaman status cuma
-- punya token (tidak punya slug) — tidak ada jalur ambil ini tanpa
-- mengubah function ini.
--
-- `public_phone` dan `slug` DUA-DUANYA sudah publik lewat get_public_page
-- (019, dibaca siapa saja yang buka /toko/{slug}) — menambahkannya di
-- sini BUKAN exposure data baru, cuma jalur baca kedua untuk data yang
-- sudah publik. `business_id` TETAP TIDAK PERNAH dikembalikan ke JSON
-- (cuma dipakai internal di WHERE/JOIN query ini) — scope exposure yang
-- sama seperti yang sudah diputuskan di get_public_page/get_public_ordering_page.
--
-- CREATE OR REPLACE dengan SIGNATURE SAMA (get_booking_request_status(uuid))
-- — grant yang sudah ada (anon) seharusnya otomatis tetap berlaku untuk
-- signature yang sama, tapi tetap ditulis ulang eksplisit di bawah
-- (bukan diandalkan diam-diam) sesuai konvensi project "jangan andalkan
-- default privileges Supabase secara implisit".
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
