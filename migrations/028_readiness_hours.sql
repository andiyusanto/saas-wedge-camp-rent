-- ============================================================
-- Migration 028 — Jeda persiapan diganti dari hari ke jam
-- ============================================================
-- Direvisi dari items.readiness_days (migration 026) ke readiness_hours
-- atas permintaan eksplisit: banyak alat kamping (headlamp, kompor) bisa
-- dibersihkan jauh di bawah sehari, dan sejak bookings.picked_up_at/
-- actual_return_at (migration 027, 003) jadi instant ASLI (bukan cuma
-- tanggal), satuan jam jadi lebih tepat merepresentasikan kebutuhan
-- sungguhan vendor daripada dipaksa dibulatkan ke hari sendiri saat input.
--
-- PENTING (jangan disalahpahami sebagai presisi sub-hari): blocking-nya
-- SENDIRI tetap per TANGGAL KALENDER, sama seperti Kalender Ketersediaan
-- yang sengaja strip-per-hari (CLAUDE.md bagian 5) — jam cuma dipakai
-- sebagai UNIT INPUT yang lebih wajar, dibulatkan ke atas jadi hari
-- (ceil(jam/24)) di titik pemakaian. Diverifikasi langsung dari server.ts
-- Bilbo-Outdoors (bukan diasumsikan): readinessHours=0 -> tidak diblokir
-- sama sekali (tersedia lagi hari itu juga); 1-24 jam -> blokir PERSIS
-- hari kembali itu sendiri (tersedia mulai besok); 25-48 jam -> blokir
-- hari kembali + 1 hari lagi; dst. Lihat komentar lengkap di usedUnitsOn()
-- (backend/src/lib/availability.ts).
--
-- Karena project ini belum live ke vendor sungguhan (masih pilot/demo),
-- konversi langsung tanpa periode transisi dua-kolom: backfill
-- readiness_hours = readiness_days * 24 (soal nilai efektif sama persis
-- untuk baris yang sudah ada), lalu readiness_days dihapus.
alter table items
  add column if not exists readiness_hours int not null default 0
    check (readiness_hours >= 0);

update items set readiness_hours = readiness_days * 24 where readiness_days > 0;

alter table items drop column if exists readiness_days;

-- get_public_availability() (migration 021, terakhir diubah migration 026)
-- HARUS ikut menghitung readiness_hours yang sama persis dengan
-- usedUnitsOn() — termasuk perbaikan yang menyertakan status 'selesai'
-- (sebelumnya readiness_days diam-diam TIDAK PERNAH berlaku buat
-- pengembalian TEPAT WAKTU, cuma buat yang telat — celah itu ikut
-- ditutup di sini) dan menjangkarkan jendela 'telat'/'selesai' ke HARI
-- SUNGGUHAN barang kembali (actual_return_at, dibaca sebagai tanggal WIB
-- lewat `at time zone 'Asia/Jakarta'`), bukan end_date terjadwal.
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
          and (b.actual_return_at at time zone 'Asia/Jakarta')::date <= d.day
          and (b.actual_return_at at time zone 'Asia/Jakarta')::date + (ceil(i.readiness_hours / 24.0)::int - 1) >= d.day
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
