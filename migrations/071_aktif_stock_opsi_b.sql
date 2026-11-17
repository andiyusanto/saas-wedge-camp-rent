-- Migration 071 — Stok "Sedang Disewa" (Opsi B), brief URGENT 17 Nov
-- 2026 (research/brief-stok-sedang-disewa-opsi-b-2026-11.md, disetujui
-- Andi, komplain Campease).
--
-- Bug dilaporkan: transaksi berstatus 'aktif' memblokir SEMUA tanggal ke
-- depan tanpa batas (aturan disalin dari Bilbo-Outdoors, keputusan owner
-- Bilbo 2 Sep 2026, commit Sewalog 2a6092c 6 Sep 2026) — booking SETELAH
-- tanggal kembali yang sudah dijadwalkan tidak bisa diterima, padahal
-- alatnya belum tentu telat.
--
-- Aturan baru (Opsi B), untuk status = 'aktif', `today` = tanggal hari
-- ini di ZONA RENTAL (businesses.timezone, pola migration 053):
--   - BELUM TELAT (today <= end_date): blokir start_date−readiness s/d
--     end_date+readiness, SAMA PERSIS dengan 'dipesan' (simetris).
--   - SUDAH TELAT (today > end_date): blokir start_date−readiness TANPA
--     BATAS ATAS, sampai Proses Pengembalian (perilaku lama/Bilbo tetap
--     berlaku di sini — alat yang tidak kembali tepat waktu memang harus
--     mengunci stok sampai ketahuan statusnya).
-- Batas "telat" berbasis TANGGAL (today > end_date), BUKAN jam toleransi
-- atau Batas Jam Kembali (migration 062) — dua pengaturan itu murni
-- urusan DENDA, tidak pernah dipakai untuk logika stok sebelum maupun
-- sesudah migration ini. Status lain (dipesan/telat-selesai dengan
-- actual_return_at/dibatalkan) TIDAK berubah sama sekali.
--
-- WAJIB sepakat persis di 3 tempat (diverifikasi test pembanding tiga
-- arah, data fixture SAMA, bukan lewat berbagi kode — pola sama migration
-- 070): usedUnitsOn() TS (backend/src/lib/availability.ts, diubah di
-- commit yang sama dengan migration ini, BUKAN di sini), used_units_on_sql
-- (migration 070, INTERNAL — revoked dari semua role, dipakai
-- create_booking_atomic), dan get_public_availability (migration 053,
-- anon publik — Etalase Online, Pesanan Online, Kalender Ketersediaan).
--
-- Idempoten (create or replace) — signature, grant, dan revoke KEDUA
-- fungsi di bawah TIDAK BERUBAH SAMA SEKALI dari versi terakhir (070
-- untuk used_units_on_sql, 053 untuk get_public_availability) — cuma isi
-- kondisi CTE/WHERE untuk status 'aktif' yang berubah, field/parameter
-- lain persis sama. Grant/revoke di bawah ini SEKADAR re-assert defensif
-- (pola sama migration 065), bukan perubahan.

-- =====================================================================
-- 1. used_units_on_sql() -- dipakai HANYA oleh create_booking_atomic(),
--    INTERNAL (revoked dari semua role). Diff terhadap migration 070:
--    cabang 'aktif' sebelumnya `(b.start_date - margin) <= p_date` TANPA
--    syarat lain (unbounded) -- sekarang ditambah syarat kedua yang
--    SELALU true kalau sudah telat (now()::date di zona rental > end_date),
--    atau p_date <= end_date+margin kalau belum telat. Baris lain
--    (dipesan/telat-selesai) TIDAK disentuh sama sekali.
-- =====================================================================
create or replace function used_units_on_sql(
  p_business_id uuid,
  p_item_id uuid,
  p_date date,
  p_readiness_hours int,
  p_timezone text
)
returns int
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(bi.quantity), 0)::int
  from booking_items bi
  join bookings b on b.id = bi.booking_id
  where b.business_id = p_business_id
    and bi.item_id = p_item_id
    and (
      (b.status = 'aktif'
        and (b.start_date - ceil(p_readiness_hours / 24.0)::int) <= p_date
        and (
          (now() at time zone coalesce(p_timezone, 'Asia/Jakarta'))::date > b.end_date
          or p_date <= (b.end_date + ceil(p_readiness_hours / 24.0)::int)
        ))
      or (b.status = 'dipesan'
          and (b.start_date - ceil(p_readiness_hours / 24.0)::int) <= p_date
          and (b.end_date + ceil(p_readiness_hours / 24.0)::int) >= p_date)
      or (b.status in ('telat', 'selesai')
          and b.actual_return_at is not null
          and p_readiness_hours > 0
          and (b.actual_return_at at time zone coalesce(p_timezone, 'Asia/Jakarta'))::date <= p_date
          and (b.actual_return_at at time zone coalesce(p_timezone, 'Asia/Jakarta'))::date + (ceil(p_readiness_hours / 24.0)::int - 1) >= p_date)
    );
$$;

revoke all on function used_units_on_sql(uuid, uuid, date, int, text) from public, anon, authenticated;

-- =====================================================================
-- 2. get_public_availability() -- jalur ANON PUBLIK (Etalase Online,
--    Pesanan Online, dan dipakai balik oleh Kalender Ketersediaan lewat
--    GET /api/availability di backend... TIDAK, GET /api/availability
--    sendiri pakai usedUnitsOn() TS langsung, bukan RPC ini -- RPC ini
--    murni dipakai anon/publik: get_public_page, create_booking_request,
--    routes/etalase.ts). Diff terhadap migration 053: cabang 'aktif' di
--    CTE usage_per_day sebelumnya cuma
--    `(b.start_date - readiness) <= d.day` (unbounded) -- sekarang ikut
--    syarat kedua yang sama dengan used_units_on_sql di atas. v_tz sudah
--    jadi variabel yang dibaca dari businesses.timezone sejak 053, tidak
--    perlu variabel baru. Field hasil (id/total_units/remaining),
--    signature, dan cabang dipesan/telat-selesai TIDAK disentuh.
-- =====================================================================
create or replace function get_public_availability(p_slug text, p_start_date date, p_end_date date)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result json;
  v_business_id uuid;
  v_tz text;
begin
  if p_end_date < p_start_date then
    return '[]'::json;
  end if;

  select pp.business_id into v_business_id
  from public_pages pp
  where pp.slug = p_slug
    and pp.published = true;

  select coalesce(timezone, 'Asia/Jakarta') into v_tz from businesses where id = v_business_id;

  if v_business_id is null then
    return null;
  end if;

  with days as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as day
  ),
  usage_per_day as (
    select bi.item_id, d.day, sum(bi.quantity) as qty
    from booking_items bi
    join bookings b on b.id = bi.booking_id
    join items i on i.id = bi.item_id
    cross join days d
    where b.business_id = v_business_id
      and (
        (
          b.status = 'aktif'
          and (b.start_date - ceil(i.readiness_hours / 24.0)::int) <= d.day
          and (
            (now() at time zone v_tz)::date > b.end_date
            or d.day <= (b.end_date + ceil(i.readiness_hours / 24.0)::int)
          )
        )
        or (
          b.status = 'dipesan'
          and (b.start_date - ceil(i.readiness_hours / 24.0)::int) <= d.day
          and (b.end_date + ceil(i.readiness_hours / 24.0)::int) >= d.day
        )
        or (
          b.status in ('telat', 'selesai')
          and b.actual_return_at is not null
          and i.readiness_hours > 0
          and (b.actual_return_at at time zone v_tz)::date <= d.day
          and (b.actual_return_at at time zone v_tz)::date + (ceil(i.readiness_hours / 24.0)::int - 1) >= d.day
        )
      )
    group by bi.item_id, d.day
  ),
  worst_day_usage as (
    select item_id, max(qty) as qty
    from usage_per_day
    group by item_id
  )
  select coalesce(json_agg(
    json_build_object(
      'id', i.id,
      'total_units', i.total_units,
      'remaining', i.total_units - coalesce(w.qty, 0)
    )
    order by i.name
  ), '[]'::json)
  into result
  from items i
  left join worst_day_usage w on w.item_id = i.id
  where i.business_id = v_business_id
    and i.deactivated_at is null;

  return result;
end;
$$;

revoke all on function get_public_availability(text, date, date) from public;
grant execute on function get_public_availability(text, date, date) to anon, authenticated;
