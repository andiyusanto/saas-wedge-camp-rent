-- ============================================================
-- Migration 051 — Nomor WA admin untuk Pesanan Online (sampai 3, label tetap Admin 1/2/3)
-- ============================================================
-- Rencana: Andi 3-4 Nov 2026, opsi B — vendor bisa atur sampai 3 nomor
-- WA admin yang menerima pesanan online, label TETAP "Admin 1"/"Admin
-- 2"/"Admin 3" (tidak bisa diganti nama). Kolom terpisah (bukan
-- text[]) SENGAJA dipilih dibanding array — slot tetap, bukan daftar
-- yang bisa berubah urutan saat update sebagian, jadi label "Admin N"
-- selalu merujuk kolom yang sama.
alter table public_pages
  add column if not exists order_admin_phone_1 text,
  add column if not exists order_admin_phone_2 text,
  add column if not exists order_admin_phone_3 text;

-- Review -c1: pemilik bisa update public_pages LANGSUNG lewat RLS
-- (owner_update_own_public_page, migration 019) — normalisasi di sisi
-- UI/backend (ke bentuk "62xxxxxxxxxx", pola sama seperti
-- normalizePhone() di bookingRequests.ts) BUKAN satu-satunya jalur
-- tulis, jadi constraint di DB ini penegak sebenarnya, bukan cuma
-- validasi kosmetik. Regex generik (menerima + opsional) supaya tidak
-- menolak nilai lama yang mungkin pernah diisi manual lewat SQL editor
-- sebelum UI ini ada dan belum ternormalisasi sempurna.
-- Idempotent lewat drop-if-exists sebelum add — pelajaran dari migration
-- 043/044 yang dalam praktiknya sempat dijalankan lebih dari sekali.
alter table public_pages drop constraint if exists order_admin_phone_1_format;
alter table public_pages drop constraint if exists order_admin_phone_2_format;
alter table public_pages drop constraint if exists order_admin_phone_3_format;
alter table public_pages
  add constraint order_admin_phone_1_format check (order_admin_phone_1 is null or order_admin_phone_1 ~ '^\+?[0-9]{8,15}$'),
  add constraint order_admin_phone_2_format check (order_admin_phone_2 is null or order_admin_phone_2 ~ '^\+?[0-9]{8,15}$'),
  add constraint order_admin_phone_3_format check (order_admin_phone_3 is null or order_admin_phone_3 ~ '^\+?[0-9]{8,15}$');

-- Admin 1 default ke public_phone Etalase kalau dikosongkan — DIRESOLVE
-- DI RPC lewat coalesce() di bawah, bukan disalin saat disimpan, supaya
-- tetap ikut berubah kalau public_phone diedit belakangan selama Admin
-- 1 belum pernah diisi eksplisit oleh vendor.

-- --------------------------------------------------------------
-- get_booking_request_status — create-or-replace ulang, DIFF DARI VERSI
-- LATEST (migration 047, bukan versi 037/041/042/044/046 yang lebih
-- lama) + 4 field baru: order_admin_phone_1/2/3 dan order_code.
--
-- order_code = 6 karakter pertama booking_requests.id (BUKAN
-- confirmation_token) — token tetap rahasia/access-key URL, order_code
-- cuma kode pendek buat dicocokkan manual antar admin kalau pelanggan
-- menghubungi admin yang berbeda dari yang pertama kali ditunjukkan.
-- Dedupe nomor yang sama dengan Admin 1 (setelah normalisasi) dan
-- fallback "tidak ada nomor sama sekali" DITANGANI DI renderStatusPage
-- (etalase.ts), bukan di sini — RPC ini cuma mengirim nilai mentah apa
-- adanya.
-- --------------------------------------------------------------
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
    'order_code', upper(left(br.id::text, 6)),
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
    'order_admin_phone_1', coalesce(pp.order_admin_phone_1, pp.public_phone),
    'order_admin_phone_2', pp.order_admin_phone_2,
    'order_admin_phone_3', pp.order_admin_phone_3,
    'confirmation_message', pp.confirmation_message,
    'accepted_terms_content', rtv.content,
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
  left join rental_terms_versions rtv on rtv.id = br.terms_version_id
  where br.confirmation_token = p_token;

  return result; -- null kalau token tidak ada — caller balikin 404
end;
$$;

revoke all on function get_booking_request_status(uuid) from public;
revoke all on function get_booking_request_status(uuid) from authenticated;
grant execute on function get_booking_request_status(uuid) to anon;

select pg_notify('pgrst', 'reload schema');
