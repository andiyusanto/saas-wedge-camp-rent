-- ============================================================
-- Migration 034 — Harga bertingkat per-hari (diadaptasi dari Bilbo-Outdoors)
-- ============================================================
-- Model lama (migration 009) cuma satu ambang: price_per_day sampai
-- discount_min_days hari, lalu discounted_price_per_day untuk sisanya.
-- Tidak bisa merepresentasikan pola vendor sungguhan "hari 1 Rp30rb,
-- hari 2 Rp20rb, hari 3 dst Rp10rb" (4 hari = 70rb, bukan kelipatan rata).
--
-- Diverifikasi langsung dari ~/Bilbo-Outdoors/src/pricing.ts +
-- src/types.ts (DayRateTable: day1Price..day5Price + extraDayRate) —
-- TAPI semantik kolom di sini SENGAJA BEDA dari Bilbo: Bilbo simpan
-- TOTAL KUMULATIF per tingkat (day3Price = total sewa 3 hari, lookup
-- langsung). Di sini simpan TARIF PER HARI itu sendiri (price_per_day =
-- tarif hari 1, day2_rate = tarif hari ke-2, dst, extra_day_rate = tarif
-- tiap hari ke-6 dst) — supaya:
--   (a) cocok dengan cara vendor mikir harga (CLAUDE.md bagian 5,
--       minim friksi) — mereka mikir "tarif hari ke-N", bukan "total
--       kumulatif sampai hari ke-N" yang harus dihitung sendiri dulu.
--   (b) tingkat kosong bisa mewarisi tarif tingkat sebelumnya (diresolve
--       di form, lihat ItemsScreen.tsx) dan otomatis BENAR untuk alat
--       flat — kalau day2_rate dst mewarisi NILAI KUMULATIF ala Bilbo,
--       alat flat (cuma isi hari 1) akan salah hitung (total 2 hari =
--       harga hari 1, bukan 2x lipatnya). Semantik per-hari tidak kena
--       bug ini: tingkat kosong = tarif sama dengan hari sebelumnya,
--       total = jumlah tarif tiap hari, otomatis N x harga flat.
--
-- Total sewa N hari = jumlah tarif hari 1..min(N,5) + maks(0,N-5) x
-- extra_day_rate. Fungsi bersama: computeItemRentalPrice() di
-- frontend/src/utils/formatters.ts (dan salinannya di
-- backend/src/lib/demoReset.ts + scripts/seed-demo.mjs, beda runtime,
-- jaga tetap sinkron).
alter table items
  add column if not exists day2_rate numeric,
  add column if not exists day3_rate numeric,
  add column if not exists day4_rate numeric,
  add column if not exists day5_rate numeric,
  add column if not exists extra_day_rate numeric;

-- Backfill dari model lama: tarif hari ke-k = price_per_day kalau
-- k <= discount_min_days, selain itu discounted_price_per_day (coalesce
-- ke price_per_day kalau belum pernah diisi — mayoritas item, jadi hasil
-- backfill-nya flat murni, sama seperti sekarang). Guard `where
-- day2_rate is null` membuat statement ini aman dijalankan ulang.
update items set
  day2_rate = case when 2 <= discount_min_days then price_per_day else coalesce(discounted_price_per_day, price_per_day) end,
  day3_rate = case when 3 <= discount_min_days then price_per_day else coalesce(discounted_price_per_day, price_per_day) end,
  day4_rate = case when 4 <= discount_min_days then price_per_day else coalesce(discounted_price_per_day, price_per_day) end,
  day5_rate = case when 5 <= discount_min_days then price_per_day else coalesce(discounted_price_per_day, price_per_day) end,
  extra_day_rate = case when 6 <= discount_min_days then price_per_day else coalesce(discounted_price_per_day, price_per_day) end
where day2_rate is null;

alter table items
  alter column day2_rate set not null,
  alter column day3_rate set not null,
  alter column day4_rate set not null,
  alter column day5_rate set not null,
  alter column extra_day_rate set not null;

-- TIDAK drop discount_min_days/discounted_price_per_day di migrasi ini.
-- Migrasi dijalankan manual (SQL Editor) oleh pemilik produk, ada jeda
-- nyata sebelum kode baru benar-benar dideploy — kode LAMA yang masih
-- baca dua kolom itu akan rusak kalau didrop sekarang. TODO: migrasi
-- terpisah untuk drop keduanya, SETELAH kode yang pakai kolom baru di
-- migrasi ini sudah confirmed live di production.

-- Snapshot subtotal per booking_item SAAT transaksi dibuat — BUKAN
-- dihitung ulang dari harga katalog saat ini, supaya Nota Sewa/struk WA
-- tidak diam-diam berubah kalau vendor mengedit harga alat setelah
-- transaksi itu selesai (price_at_booking & bookings.total_price sudah
-- lebih dulu pakai prinsip "beku" yang sama). Nullable, TIDAK di-backfill
-- — baris booking_items lama (sebelum migrasi ini) tetap null, kode
-- tampilan fallback ke price_at_booking * quantity * hari untuk baris
-- itu (perilaku yang sama seperti sebelum fitur ini ada).
alter table booking_items
  add column if not exists subtotal numeric;

-- get_public_page() (migration 019/020): ikut tampilkan tarif per
-- tingkat supaya Etalase Online bisa kasih tahu "mulai Rp X/hari untuk
-- sewa panjang" kalau alatnya memang punya tarif lebih murah. CREATE OR
-- REPLACE dengan nama/parameter/return type SAMA PERSIS (json) — grant
-- EXECUTE yang sudah ada dari migration 020 (ke anon + authenticated)
-- seharusnya tetap berlaku karena fungsinya tidak di-drop, cuma
-- diganti isinya — WAJIB diverifikasi live lewat curl tanpa login
-- setelah migrasi ini (jangan diasumsikan dari membaca migration file
-- saja, lihat catatan proyek soal Supabase default privileges).
create or replace function get_public_page(p_slug text)
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
    'business_name', b.name,
    'description', pp.description,
    'address', pp.address,
    'regency_name', r.name,
    'operating_hours', pp.operating_hours,
    'public_phone', pp.public_phone,
    'items', (
      select coalesce(json_agg(
        json_build_object(
          'id', i.id,
          'name', i.name,
          'category', i.category,
          'price_per_day', i.price_per_day,
          'day2_rate', i.day2_rate,
          'day3_rate', i.day3_rate,
          'day4_rate', i.day4_rate,
          'day5_rate', i.day5_rate,
          'extra_day_rate', i.extra_day_rate,
          'image_url', i.image_url,
          'variant', i.variant,
          'size', i.size,
          'color', i.color
        )
        order by i.name
      ), '[]'::json)
      from items i
      where i.business_id = pp.business_id
        and i.deactivated_at is null
    )
  )
  into result
  from public_pages pp
  join businesses b on b.id = pp.business_id
  left join regencies r on r.id = pp.regency_id
  where pp.slug = p_slug
    and pp.published = true;

  return result;
end;
$$;
