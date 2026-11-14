-- ============================================================
-- Migration 063 -- Cara hitung denda telat
-- ============================================================
-- Brief disetujui Andi 15 Nov 2026: research/brief-cara-hitung-denda-telat-2026-11.md
-- (wawancara TikTok+IG: banyak rental baru/fleksibel TIDAK memungut
-- denda telat; banyak juga pakai "telat = +1 hari penuh"; sebagian
-- pakai denda per jam). Pengaturan per rental di Kelola Usaha, dekat
-- Toleransi telat & Batas jam kembali (migration 062) — EMPAT mode:
--
-- 1. bertahap_12jam (DEFAULT, perilaku PERSIS sekarang -- computeLateFee/
--    computeTieredLateFee di lib/penalty.ts TIDAK diubah sama sekali).
-- 2. per_hari_24jam: telat lewat toleransi dibulatkan ke ATAS per 24 jam
--    (1 menit lewat toleransi = 1 hari penuh, tanpa setengah hari).
-- 3. per_jam: nominal Rp/jam PER TRANSAKSI (bukan per alat, v1) x jam
--    telat lewat toleransi (dibulatkan ke atas), dengan batas atas
--    OPSIONAL (aktif default) = PERSIS angka yang akan dihasilkan mode
--    "per hari penuh" untuk telat sejumlah jam yang sama -- lihat
--    computeFullDayLateFee/computeFullDayLateFeeFlat di lib/penalty.ts.
-- 4. tanpa_denda: saran denda Rp0, rincian disembunyikan. Nominal TETAP
--    bisa diisi manual di ReturnModal (field tidak dikunci).
--
-- Toleransi telat (jam) & Batas jam kembali (062) TETAP titik mulai
-- hitung di SEMUA mode, tidak disentuh.
--
-- "Dikali jumlah alat" (opsi di brief untuk mode per_jam) DITUNDA ke v2
-- (keputusan Andi 15 Nov 2026) -- TIDAK ADA kolom untuk itu di sini.

alter table businesses add column if not exists late_fee_mode text not null default 'bertahap_12jam';
alter table businesses drop constraint if exists businesses_late_fee_mode_check;
alter table businesses add constraint businesses_late_fee_mode_check
  check (late_fee_mode in ('bertahap_12jam', 'per_hari_24jam', 'per_jam', 'tanpa_denda'));

alter table businesses add column if not exists late_fee_per_hour numeric;
alter table businesses drop constraint if exists businesses_late_fee_per_hour_check;
alter table businesses add constraint businesses_late_fee_per_hour_check
  check (late_fee_per_hour is null or late_fee_per_hour >= 0);

alter table businesses add column if not exists late_fee_per_hour_cap_enabled boolean not null default true;

-- Review -c1 poin 3: mode per_jam TANPA nominal tidak boleh tersimpan
-- sama sekali di businesses (setting LIVE) -- dicek di DB, bukan cuma
-- form, supaya endpoint/jalur lain yang mungkin menulis langsung tidak
-- bisa melewati ini.
alter table businesses drop constraint if exists businesses_late_fee_per_hour_required_check;
alter table businesses add constraint businesses_late_fee_per_hour_required_check
  check (late_fee_mode <> 'per_jam' or (late_fee_per_hour is not null and late_fee_per_hour > 0));

-- Snapshot (pola persis rental_day_mode migration 049 / return_deadline_time
-- migration 062) -- diisi dari businesses.late_fee_* SAAT POST /bookings.
-- null = bertahap_12jam (baris lama, TIDAK berubah). TIDAK ada constraint
-- "per_jam wajib nominal" di sini -- snapshot booking untuk per_jam tanpa
-- per_hour (seharusnya tidak pernah terjadi karena constraint businesses
-- di atas, tapi kalau somehow terjadi) ditangani AMAN di kode (saran Rp0 +
-- catatan "isi manual"), bukan error/exception.
alter table bookings add column if not exists late_fee_mode text;
alter table bookings drop constraint if exists bookings_late_fee_mode_check;
alter table bookings add constraint bookings_late_fee_mode_check
  check (late_fee_mode is null or late_fee_mode in ('bertahap_12jam', 'per_hari_24jam', 'per_jam', 'tanpa_denda'));

alter table bookings add column if not exists late_fee_per_hour numeric;
alter table bookings add column if not exists late_fee_per_hour_cap_enabled boolean;
