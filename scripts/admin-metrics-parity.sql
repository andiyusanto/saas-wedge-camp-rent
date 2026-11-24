-- ============================================================
-- admin-metrics-parity.sql — Bandingkan metrik admin_list_businesses
-- (migration 076) vs scripts/weekly-metrics.sql Blok 3
-- ============================================================
-- Dijalankan MANUAL oleh Andi di SQL Editor Supabase (role `postgres`,
-- BUKAN lewat RPC admin_list_businesses() langsung -- is_app_admin()
-- di dalamnya memeriksa auth.uid() dari JWT request, yang TIDAK ADA
-- sama sekali di SQL Editor, jadi RPC itu akan selalu menolak di sini).
-- Query di bawah ini menyalin LOGIKA agregat admin_list_businesses
-- (bukan memanggil fungsinya) dan menghitung ulang versi
-- weekly-metrics-style SECARA INDEPENDEN untuk bulan yang sama,
-- supaya dua ekspresi yang ditulis terpisah bisa saling diverifikasi
-- (double-entry check) -- bukan membandingkan fungsi dengan dirinya
-- sendiri.
--
-- SATU statement SELECT (SQL Editor cuma menampilkan hasil terakhir
-- kalau dijalankan sekaligus / "Run All") -- jalankan blok ini saja.
--
-- Hasil yang diharapkan:
--   diff_txn_count     = 0 untuk SEMUA baris
--   diff_last_active   = 0 (atau sama-sama null) untuk SEMUA baris
--   diff_items         BOLEH TIDAK NOL -- lihat catatan kolom di bawah,
--                      ini perbedaan DISENGAJA (alat aktif vs semua alat).
--
-- Ganti :bulan di bawah (format 'YYYY-MM-01') untuk menguji bulan lain
-- selain bulan berjalan WIB -- default sudah bulan berjalan.

with params as (
  select date_trunc('month', (now() at time zone 'Asia/Jakarta'))::date as bulan
),
demo as (
  select business_id
  from business_members
  where role = 'owner' and email = 'demo.pemilik@sewalog.test'
),
-- ---- Versi A: salinan logika admin_list_businesses (migration 076) ----
admin_style as (
  select
    b.id as business_id,
    b.name,
    (
      select count(*) from bookings bk
      where bk.business_id = b.id
        and bk.status <> 'dibatalkan'
        and (bk.created_at at time zone 'Asia/Jakarta') >= p.bulan
        and (bk.created_at at time zone 'Asia/Jakarta') < (p.bulan + interval '1 month')
    ) as a_txn_count_month,
    (
      select max(bk.created_at) at time zone 'Asia/Jakarta'
      from bookings bk
      where bk.business_id = b.id and bk.status <> 'dibatalkan'
    )::date as a_last_active_date,
    (select count(*) from items i where i.business_id = b.id and i.deactivated_at is null) as a_active_items_count
  from businesses b, params p
  where b.id not in (select business_id from demo)
),
-- ---- Versi B: ditulis ULANG independen, gaya weekly-metrics Blok 3 ----
-- (Blok 3 asli tidak difilter bulan -- jumlah_transaksi/transaksi_terakhir
-- di sana selalu all-time; di sini SENGAJA ditambah filter bulan yang
-- SAMA biar sebanding dengan kolom bulan admin_list_businesses, dan
-- transaksi_terakhir dihitung all-time persis Blok 3 asli).
weekly_style as (
  select
    b.id as business_id,
    (
      select count(*) from bookings bk
      where bk.business_id = b.id
        and bk.status <> 'dibatalkan'
        and date_trunc('month', bk.created_at at time zone 'Asia/Jakarta')::date = p.bulan
    ) as b3_txn_count_month,
    (
      select max(bk.created_at) at time zone 'Asia/Jakarta'
      from bookings bk
      where bk.business_id = b.id and bk.status <> 'dibatalkan'
    )::date as b3_last_active_date,
    (select count(*) from items i where i.business_id = b.id) as b3_jumlah_alat_semua
  from businesses b, params p
  where b.id not in (select business_id from demo)
)
select
  a.name,
  a.a_txn_count_month,
  w.b3_txn_count_month,
  (a.a_txn_count_month - w.b3_txn_count_month) as diff_txn_count, -- HARUS 0
  a.a_last_active_date,
  w.b3_last_active_date,
  (a.a_last_active_date is distinct from w.b3_last_active_date) as diff_last_active, -- HARUS false
  a.a_active_items_count as items_aktif_a,
  w.b3_jumlah_alat_semua as jumlah_alat_semua_b3,
  (a.a_active_items_count - w.b3_jumlah_alat_semua) as diff_items -- BOLEH <> 0 kalau ada alat dinonaktifkan, lihat catatan di atas
from admin_style a
join weekly_style w on w.business_id = a.business_id
order by abs(a.a_txn_count_month - w.b3_txn_count_month) desc, a.name;
