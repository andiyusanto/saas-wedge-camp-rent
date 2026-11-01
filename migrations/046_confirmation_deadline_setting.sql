-- ============================================================
-- Migration 046 — Batas konfirmasi per-business (Pesanan Online tahap 5)
-- ============================================================
-- Sebelum ini, batas kedaluwarsa pesanan online SELALU 24 jam
-- (DEFAULT_EXPIRY_HOURS hardcoded di backend/src/routes/bookingRequests.ts,
-- migration 037) — ATAU awal hari start_date WIB kalau itu lebih dulu,
-- mana yang lebih cepat. Vendor pilot ingin ini bisa diatur sendiri (mis.
-- vendor yang jarang cek HP mau 48 jam, vendor yang gercep mau 6 jam).
--
-- Kolom baru di public_pages, diisi dari Etalase Online settings card,
-- dibaca backend lewat get_public_ordering_page (ditambah di sini) lalu
-- dipakai `bookingRequests.ts` sebagai pengganti DEFAULT_EXPIRY_HOURS
-- (perubahan backend menyusul di file terpisah, bukan migration ini).
--
-- Batas atas create_booking_request (p_expires_at <= now() + interval
-- '7 days', migration 037) TETAP TIDAK BERUBAH — itu hard cap defense-in-
-- depth di RPC publik, independen dari setting per-business ini. Setting
-- ini cuma mengganti angka 24 jam DEFAULT yang dipakai backend untuk
-- MENGHITUNG p_expires_at sebelum dikirim ke RPC, bukan mengubah
-- validasi RPC itu sendiri.
alter table public_pages
  add column if not exists confirmation_deadline_hours int not null default 24
    constraint confirmation_deadline_hours_range check (confirmation_deadline_hours between 2 and 72);

-- --------------------------------------------------------------
-- get_public_ordering_page — tambah confirmation_deadline_hours
-- --------------------------------------------------------------
-- Signature sama (text) seperti migration 044 — backend butuh angka ini
-- untuk menghitung expiresAt saat submit.
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
    'writable', business_is_writable(pp.business_id)
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

-- --------------------------------------------------------------
-- get_booking_request_status — tambah expires_at
-- --------------------------------------------------------------
-- Ditunda sejak tahap 3 (lihat research/etalase-online-ordering-plan-
-- 2026-10.md) — halaman status sekarang bisa menampilkan "Batas
-- konfirmasi: {hari, tanggal, jam WIB}" ke pelanggan, bukan cuma status
-- mentah. Signature sama (uuid) seperti migration 042, grant ditulis
-- ulang eksplisit sesuai konvensi file-file get_booking_request_status
-- sebelumnya.
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
    'expires_at', br.expires_at,
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
