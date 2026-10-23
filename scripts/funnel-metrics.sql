-- ============================================================
-- Funnel onboarding vendor — tinjauan mingguan (read-only)
-- ============================================================
-- Dijalankan MANUAL di Supabase SQL Editor, bukan dipanggil dari app.
-- Cuma SELECT, tidak mengubah data atau skema apapun.
--
-- Dua query terpisah di bawah (QUERY 1 = detail per bisnis, QUERY 2 =
-- ringkasan total per tahap) — jalankan satu per satu (blok teks, lalu
-- Ctrl+Enter/Run), karena Supabase SQL Editor cuma menampilkan hasil
-- statement TERAKHIR kalau keduanya dijalankan sekaligus.
--
-- Definisi tahap sesuai konteks marketing-plan-2026-q4.md bagian 2
-- (Akun/Aktif/Rutin), dicek dari yang PALING LANJUT ke paling awal:
--   Rutin = ada booking (bukan dibatalkan) yang dibuat >= 7 hari kalender
--           WIB setelah booking pertama (bukan dibatalkan)
--   Aktif = punya >= 1 booking yang bukan dibatalkan, tapi belum Rutin
--   Akun  = item aktif >= 5, tapi belum Aktif
--   (kosong, belum sampai tahap Akun) kalau item aktif < 5
-- Tahap "Prospek/Terhubung/Demo" tidak ada datanya di database (itu di
-- spreadsheet pelacak manual, bagian 3.5 marketing plan), jadi tidak
-- muncul di sini.
--
-- Zona waktu: semua batas HARI dihitung di WIB (UTC+7, tanpa DST), bukan
-- UTC polos atau timezone server — sama seperti todayInWIB() di
-- backend/src/lib/dates.ts (CLAUDE.md bagian 4). "7 hari terakhir" artinya
-- 7 hari kalender WIB termasuk hari ini (hari ini dan 6 hari sebelumnya).
--
-- Exclude: bisnis demo ("Demo — Coba Sewalog") dan bisnis manapun yang
-- punya anggota (owner ATAUPUN karyawan) berakun *@sewalog.test — bukan
-- cuma owner, supaya ikut kena kalau suatu saat ada bisnis demo tambahan
-- yang anggotanya akun test. Bisnis yang sudah dinonaktifkan
-- (deactivated_at terisi) juga dikecualikan, karena bukan vendor aktif.

-- ============================================================
-- QUERY 1 — Detail per bisnis
-- ============================================================
with excluded_businesses as (
  select b.id
  from businesses b
  where b.name = 'Demo — Coba Sewalog'
     or exists (
       select 1
       from business_members bm
       where bm.business_id = b.id
         and bm.email ilike '%@sewalog.test'
     )
),
candidate_businesses as (
  select b.*
  from businesses b
  where b.deactivated_at is null
    and b.id not in (select id from excluded_businesses)
),
item_counts as (
  select business_id, count(*) as item_count
  from items
  where deactivated_at is null
  group by business_id
),
first_booking as (
  select business_id, min(created_at) as first_booking_at
  from bookings
  where status <> 'dibatalkan'
  group by business_id
),
routine_check as (
  -- Rutin: ada booking lain (bukan dibatalkan) >= 7 hari kalender WIB
  -- setelah booking pertama (bukan dibatalkan) milik bisnis yang sama.
  select distinct fb.business_id
  from first_booking fb
  join bookings b2
    on b2.business_id = fb.business_id
   and b2.status <> 'dibatalkan'
   and (b2.created_at + interval '7 hours')::date
       >= (fb.first_booking_at + interval '7 hours')::date + 7
),
recent_bookings as (
  select business_id, count(*) as bookings_last_7d
  from bookings
  where (created_at + interval '7 hours')::date
        >= (now() + interval '7 hours')::date - 6
  group by business_id
)
select
  cb.name as nama_bisnis,
  r.name as kota,
  (cb.created_at + interval '7 hours')::date as tanggal_dibuat_wib,
  coalesce(ic.item_count, 0) as jumlah_item,
  (fb.first_booking_at + interval '7 hours')::date as tanggal_booking_pertama_wib,
  coalesce(rb.bookings_last_7d, 0) as booking_7_hari_terakhir,
  case
    when rc.business_id is not null then 'Rutin'
    when fb.business_id is not null then 'Aktif'
    when coalesce(ic.item_count, 0) >= 5 then 'Akun'
    else null
  end as tahap
from candidate_businesses cb
left join regencies r on r.id = cb.regency_id
left join item_counts ic on ic.business_id = cb.id
left join first_booking fb on fb.business_id = cb.id
left join routine_check rc on rc.business_id = cb.id
left join recent_bookings rb on rb.business_id = cb.id
order by tahap nulls last, tanggal_dibuat_wib desc;

-- ============================================================
-- QUERY 2 — Ringkasan total per tahap (jalankan terpisah dari QUERY 1)
-- ============================================================
with excluded_businesses as (
  select b.id
  from businesses b
  where b.name = 'Demo — Coba Sewalog'
     or exists (
       select 1
       from business_members bm
       where bm.business_id = b.id
         and bm.email ilike '%@sewalog.test'
     )
),
candidate_businesses as (
  select b.*
  from businesses b
  where b.deactivated_at is null
    and b.id not in (select id from excluded_businesses)
),
item_counts as (
  select business_id, count(*) as item_count
  from items
  where deactivated_at is null
  group by business_id
),
first_booking as (
  select business_id, min(created_at) as first_booking_at
  from bookings
  where status <> 'dibatalkan'
  group by business_id
),
routine_check as (
  select distinct fb.business_id
  from first_booking fb
  join bookings b2
    on b2.business_id = fb.business_id
   and b2.status <> 'dibatalkan'
   and (b2.created_at + interval '7 hours')::date
       >= (fb.first_booking_at + interval '7 hours')::date + 7
),
staged as (
  select
    cb.id,
    case
      when rc.business_id is not null then 'Rutin'
      when fb.business_id is not null then 'Aktif'
      when coalesce(ic.item_count, 0) >= 5 then 'Akun'
      else 'Belum Akun'
    end as tahap
  from candidate_businesses cb
  left join item_counts ic on ic.business_id = cb.id
  left join first_booking fb on fb.business_id = cb.id
  left join routine_check rc on rc.business_id = cb.id
)
select tahap, count(*) as jumlah_bisnis
from staged
group by tahap
order by
  case tahap
    when 'Rutin' then 1
    when 'Aktif' then 2
    when 'Akun' then 3
    when 'Belum Akun' then 4
  end;
