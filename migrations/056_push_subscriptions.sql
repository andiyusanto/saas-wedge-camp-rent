-- ============================================================
-- Migration 056 -- Notifikasi push: Pesanan Online baru (v1)
-- ============================================================
-- Brief & keputusan Andi: research/brief-notifikasi-push-2026-11.md.
-- Cakupan v1: HANYA notifikasi "pesanan baru masuk" dari formulir
-- Etalase. Pengingat jatuh tempo/keterlambatan belum dibangun.
--
-- push_subscriptions: satu baris per perangkat yang opt-in. RLS sama
-- persis pola is_member_of() yang sudah dipakai booking_requests
-- (migration 037) -- owner DAN karyawan sama-sama bisa lihat Pesanan
-- masuk, jadi keduanya boleh kelola subscription device masing-masing.
-- Tidak ada akses anon ke tabel ini sama sekali.
--
-- Pengiriman push dipicu dari jalur publik anonim
-- (POST /public/booking-requests/:slug, tanpa login) setelah
-- create_booking_request sukses -- backend butuh membaca subscription
-- milik business itu TANPA JWT pelanggan. Pola sama persis
-- create_booking_request: RPC security definer yang mensyaratkan
-- secret dari private_config, revoke execute dari anon/public.
-- ============================================================

create table push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id),
  user_id         uuid not null references auth.users(id),
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz
);

create index push_subscriptions_business_idx on push_subscriptions (business_id);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy "members_select_own_push_subscriptions"
  on push_subscriptions for select
  using (is_member_of(business_id) and user_id = auth.uid());

create policy "members_insert_own_push_subscriptions"
  on push_subscriptions for insert
  with check (is_member_of(business_id) and user_id = auth.uid());

create policy "members_delete_own_push_subscriptions"
  on push_subscriptions for delete
  using (is_member_of(business_id) and user_id = auth.uid());

-- Sengaja TIDAK ADA policy update -- endpoint ganti (browser kirim
-- subscription baru setelah yang lama kedaluwarsa) ditangani sebagai
-- delete+insert di backend (lebih sederhana daripada upsert on-conflict
-- lewat RLS), dan last_success_at ditulis lewat RPC di bawah (bypass
-- RLS, sama seperti kebutuhan update append-only lain di app ini).

revoke all on push_subscriptions from anon;

-- --------------------------------------------------------------
-- RPC dibaca jalur anonim (POST booking-requests), bukan tabel
-- langsung -- defense in depth sama seperti create_booking_request.
-- --------------------------------------------------------------
create or replace function get_push_subscriptions_for_business(
  p_secret text,
  p_business_id uuid
)
returns table (
  id uuid,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_secret text;
begin
  select value into expected_secret from private_config where key = 'booking_request_secret';
  if expected_secret is null or p_secret is distinct from expected_secret then
    raise exception 'get_push_subscriptions_for_business: secret tidak valid';
  end if;

  return query
    select s.id, s.endpoint, s.p256dh, s.auth
    from push_subscriptions s
    where s.business_id = p_business_id;
end;
$$;

revoke all on function get_push_subscriptions_for_business(text, uuid) from public;
revoke all on function get_push_subscriptions_for_business(text, uuid) from anon;

-- Dipanggil backend lewat jalur anonim yang sama (secret, bukan JWT)
-- setelah kirim push sukses (last_success_at) atau gagal permanen
-- (404/410 -- baris dihapus langsung lewat RPC ini juga, bukan lewat
-- klien anon yang tidak punya policy delete).
create or replace function record_push_result(
  p_secret text,
  p_subscription_id uuid,
  p_success boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_secret text;
begin
  select value into expected_secret from private_config where key = 'booking_request_secret';
  if expected_secret is null or p_secret is distinct from expected_secret then
    raise exception 'record_push_result: secret tidak valid';
  end if;

  if p_success then
    update push_subscriptions set last_success_at = now() where id = p_subscription_id;
  else
    delete from push_subscriptions where id = p_subscription_id;
  end if;
end;
$$;

revoke all on function record_push_result(text, uuid, boolean) from public;
revoke all on function record_push_result(text, uuid, boolean) from anon;
