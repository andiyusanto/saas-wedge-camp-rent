-- ============================================================
-- weekly-metrics.sql — Metrik aktivasi vendor mingguan (READ-ONLY)
-- ============================================================
-- Dijalankan manual oleh Andi di SQL Editor Supabase (bukan lewat
-- backend/app, tidak ada endpoint untuk ini). File ini TIGA blok SELECT
-- TERPISAH, bukan satu query gabungan — SQL Editor Supabase cuma
-- menampilkan hasil statement TERAKHIR kalau dijalankan sekaligus, jadi
-- jalankan satu per satu (select & run tiap blok terpisah), bukan "Run
-- All" sekali jalan.
--
-- Semua perhitungan minggu/tanggal dikonversi ke WIB (Asia/Jakarta)
-- dulu sebelum di-date_trunc — konsisten dengan prinsip WIB hardcoded
-- di CLAUDE.md bagian 4, supaya batas minggu tidak bergeser gara-gara
-- timezone server Supabase.
--
-- "Transaksi" di sini SELALU berarti bookings.created_at (waktu
-- transaksi DICATAT staf), BUKAN bookings.start_date (tanggal sewa
-- yang dipilih, bisa jauh di masa depan/lampau dari saat dicatat) —
-- metrik aktivasi vendor peduli kapan vendor BENAR-BENAR memakai app,
-- bukan tanggal sewa pelanggannya.
--
-- Business demo (lihat migration 036, reset_demo_bookings) dikecualikan
-- dari SEMUA blok di bawah lewat CTE `demo`, konsisten dengan cara
-- reset_demo_bookings() mengidentifikasi business itu (business_members
-- dengan role owner + email snapshot demo.pemilik@sewalog.test).
--
-- Booking berstatus 'dibatalkan' TIDAK dihitung sebagai transaksi di
-- mana pun di file ini (first_txn, blok 2, jumlah_transaksi,
-- transaksi_terakhir) — transaksi yang dibatalkan bukan bukti pemakaian
-- nyata, apalagi dipakai sebagai definisi aktivasi.

-- --------------------------------------------------------------
-- BLOK 1 — Kohort aktivasi per MINGGU DAFTAR
-- --------------------------------------------------------------
-- Untuk usaha yang mendaftar minggu W: berapa yang akhirnya punya >=1
-- alat (kapan pun, tidak dibatasi jendela waktu), dan berapa yang
-- "teraktivasi" — transaksi pertamanya tercatat <=7 hari sejak
-- businesses.created_at. Basis minggu di sini adalah tanggal DAFTAR,
-- bukan tanggal transaksi.
with demo as (
  select business_id
  from business_members
  where role = 'owner' and email = 'demo.pemilik@sewalog.test'
),
first_txn as (
  select business_id, min(created_at) as first_created_at
  from bookings
  where status <> 'dibatalkan'
  group by business_id
)
select
  date_trunc('week', b.created_at at time zone 'Asia/Jakarta')::date as minggu_daftar,
  count(*) as usaha_baru_mendaftar,
  count(*) filter (
    where exists (select 1 from items i where i.business_id = b.id)
  ) as usaha_punya_alat,
  count(*) filter (
    where ft.first_created_at is not null
      and ft.first_created_at <= b.created_at + interval '7 days'
  ) as usaha_aktivasi_7hari
from businesses b
left join first_txn ft on ft.business_id = b.id
where b.id not in (select business_id from demo)
group by 1
order by 1;

-- --------------------------------------------------------------
-- BLOK 2 — Aktivitas transaksi per MINGGU KALENDER
-- --------------------------------------------------------------
-- Basis minggu di sini adalah tanggal TRANSAKSI (bookings.created_at),
-- independen dari kapan usahanya mendaftar — usaha lama yang baru aktif
-- lagi minggu ini tetap terhitung.
with demo as (
  select business_id
  from business_members
  where role = 'owner' and email = 'demo.pemilik@sewalog.test'
)
select
  date_trunc('week', bk.created_at at time zone 'Asia/Jakarta')::date as minggu_transaksi,
  count(distinct bk.business_id) as usaha_aktif_mingguan,
  count(*) as total_transaksi
from bookings bk
where bk.business_id not in (select business_id from demo)
  and bk.status <> 'dibatalkan'
group by 1
order by 1;

-- --------------------------------------------------------------
-- BLOK 3 — Daftar per usaha (bahan follow-up DM)
-- --------------------------------------------------------------
with demo as (
  select business_id
  from business_members
  where role = 'owner' and email = 'demo.pemilik@sewalog.test'
)
select
  b.name as nama_usaha,
  r.name as kota, -- nullable, belum semua usaha isi Kota di Info Usaha
  (b.created_at at time zone 'Asia/Jakarta')::date as tanggal_daftar,
  (select count(*) from items i where i.business_id = b.id) as jumlah_alat,
  (
    select count(*) from bookings bk
    where bk.business_id = b.id and bk.status <> 'dibatalkan'
  ) as jumlah_transaksi,
  (
    select max(bk.created_at) at time zone 'Asia/Jakarta'
    from bookings bk
    where bk.business_id = b.id and bk.status <> 'dibatalkan'
  )::date as transaksi_terakhir
from businesses b
left join regencies r on r.id = b.regency_id
where b.id not in (select business_id from demo)
order by tanggal_daftar desc;
