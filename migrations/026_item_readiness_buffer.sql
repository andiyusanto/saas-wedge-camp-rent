-- ============================================================
-- Migration 026 — Jeda persiapan per-alat (readiness buffer)
-- ============================================================
-- Diadaptasi dari fitur "readinessDays/readinessHours" Bilbo-Outdoors
-- (referensi produk sejenis, owner sama — lihat CLAUDE.md) setelah
-- membandingkan dua fix bug Bilbo baru-baru ini (e31b654, 2196472) yang
-- menutup celah waktu Sewalog sendiri sama sekali belum punya fiturnya.
-- Alasan nyata: alat kamping (tenda, sleeping bag) sering butuh waktu
-- diangin-anginkan/dicek kondisi sebelum siap disewa lagi setelah
-- kembali — tanpa ini, alat langsung kelihatan "tersedia penuh" persis
-- di hari yang sama ia kembali/ditutup, padahal fisiknya belum benar-
-- benar siap.
--
-- Kolom baru, bukan tabel terpisah — satu angka per alat, default 0
-- (tidak ada jeda sama sekali, byte-for-byte sama seperti sebelum
-- migration ini untuk semua alat yang belum diisi). Satuan HARI
-- (bukan jam seperti Bilbo) — Sewalog sudah day-granularity murni sejak
-- awal (bookings.start_date/end_date bertipe `date`, tanpa komponen
-- jam sama sekali), jadi readiness dalam jam cuma akan dibulatkan ke
-- hari juga di akhir seperti yang Bilbo lakukan sendiri — lebih jujur
-- ditawarkan sebagai hari langsung ke vendor daripada berpura-pura
-- presisi jam yang tidak pernah benar-benar dipakai.
alter table items
  add column if not exists readiness_days int not null default 0
    check (readiness_days >= 0);

-- get_public_availability() (migration 021) HARUS ikut menghitung
-- readiness_days supaya konsisten dengan usedUnitsOn() (backend/src/lib/
-- availability.ts) — dua tempat itu WAJIB selalu sepakat soal kapan
-- sebuah alat dianggap terpakai pada tanggal tertentu, persis seperti
-- catatan yang sudah ada di sana. Logika blokir SIMETRIS: mundur
-- readiness_days sebelum start_date, maju readiness_days setelah
-- end_date (lihat komentar lengkap penerapan simetris di usedUnitsOn()).
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
      and (b.start_date - i.readiness_days) <= d.day
      and (
        b.status = 'aktif'
        or (b.status in ('dipesan', 'telat') and (b.end_date + i.readiness_days) >= d.day)
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
