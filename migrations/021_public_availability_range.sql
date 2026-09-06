-- ============================================================
-- Migration 021 — Pencarian ketersediaan Etalase Online jadi rentang tanggal
-- ============================================================
-- get_public_availability() (migration 020) tadinya cuma cek SATU tanggal.
-- Itu tidak cukup buat menjawab pertanyaan sebenarnya penyewa ("bisa sewa
-- dari tgl 10 sampai 15?") — alat bisa kelihatan tersedia di hari pertama
-- tapi sudah dipakai booking lain di hari ketiga. Diganti jadi rentang
-- [p_start_date, p_end_date] inklusif, sama seperti cara
-- POST /bookings (routes/bookings.ts) memvalidasi kapasitas — jalan tiap
-- hari dalam rentang dan mensyaratkan SEMUA hari cukup stok, bukan cuma
-- satu hari. `remaining` yang dibalikkan di sini adalah titik TERBURUK
-- (hari dengan sisa unit paling sedikit) di sepanjang rentang — itu yang
-- benar-benar membatasi apakah rentang itu bisa disewa penuh atau tidak.

drop function if exists get_public_availability(text, date);

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
begin
  if p_end_date < p_start_date then
    return '[]'::json;
  end if;

  select pp.business_id into v_business_id
  from public_pages pp
  where pp.slug = p_slug
    and pp.published = true;

  if v_business_id is null then
    return null;
  end if;

  with days as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as day
  ),
  -- Logika blokir per (item, hari) SAMA PERSIS dengan usedUnitsOn()
  -- (backend/src/lib/availability.ts) — kalau usedUnitsOn() berubah, ubah
  -- juga query ini.
  usage_per_day as (
    select bi.item_id, d.day, sum(bi.quantity) as qty
    from booking_items bi
    join bookings b on b.id = bi.booking_id
    cross join days d
    where b.business_id = v_business_id
      and b.start_date <= d.day
      and (
        b.status = 'aktif'
        or (b.status in ('dipesan', 'telat') and b.end_date >= d.day)
      )
    group by bi.item_id, d.day
  ),
  worst_day_usage as (
    -- MAX per item = hari dengan pemakaian tertinggi = remaining terendah
    -- di sepanjang rentang, yaitu titik yang sebenarnya membatasi.
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

grant execute on function get_public_availability(text, date, date) to anon, authenticated;
