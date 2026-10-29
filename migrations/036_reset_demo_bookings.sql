-- ============================================================
-- Migration 036 — RPC khusus demo: hapus total rantai booking lama
-- ============================================================
-- Latar: tombol "Reset data demo" (routes/demo.ts -> demoReset.ts) cuma
-- menutup booking berstatus dipesan/aktif lewat endpoint asli (/pickup +
-- /cancel) sebelum bikin transaksi contoh baru. Booking yang SUDAH
-- DITUTUP (selesai/telat) tidak pernah disentuh — memang tidak ada
-- endpoint produk untuk "membuka lagi" transaksi yang sudah selesai
-- (/cancel menolak kalau status bukan 'aktif', sengaja, demi integritas
-- data vendor asli). Akibatnya setiap reset menambah baris selesai/telat
-- BARU yang menumpuk selamanya — untuk item dengan readiness_hours > 0
-- (CR-05, TND-01), usedUnitsOn() menjangkarkan jendela jeda persiapan ke
-- actual_return_at tiap baris itu, jadi tumpukan baris historis dari
-- reset-reset sebelumnya ikut memblokir stok di tanggal yang sama sampai
-- melebihi total_units -> POST /bookings baru bisa ditolak 409 (sisa
-- negatif). Ini bukan bug di algoritma validasi kapasitas produksi
-- (usedUnitsOn tetap benar untuk booking sungguhan vendor, yang memang
-- cuma dibuat sekali per peristiwa fisik nyata) — murni artefak cara
-- demoReset.ts dibangun: skrip ini membuat transaksi SINTETIS identik
-- berkali-kali sehari, sesuatu yang tidak pernah terjadi di alur vendor
-- asli.
--
-- Perbaikan: demoReset.ts/seed-demo.mjs sekarang menghapus TOTAL semua
-- booking (status apa pun) milik business demo di awal tiap reset,
-- bukan cuma menutup dipesan/aktif — supaya reset benar-benar mulai dari
-- nol setiap kali, tahan dijalankan berkali-kali tanpa akumulasi.
--
-- TIDAK menambah policy DELETE generik di bookings/booking_items/
-- deposits/penalties/booking_status_history — itu akan melanggar prinsip
-- append-only booking_status_history untuk VENDOR ASLI (CLAUDE.md bagian
-- 7, sama alasan kenapa marketplace_consents tidak punya policy
-- update/delete). Sebagai gantinya: SATU fungsi SQL security definer
-- yang di dalamnya sendiri memverifikasi target business_id benar-benar
-- business demo DAN pemanggil benar-benar login sebagai owner demo itu
-- (auth.uid() = user_id), sebelum menghapus apa pun — jadi secara
-- struktural tidak mungkin dipanggil ke business vendor asli, independen
-- dari apa pun yang dikirim pemanggil (bukan cuma soal hak akses REST).
--
-- business_members.email (snapshot login, migration 010) dipakai
-- langsung buat verifikasi ini — TIDAK perlu join ke auth.users.
--
-- Cakupan hapus: booking_status_history, penalties, deposits,
-- booking_items, bookings (urutan sesuai FK, lihat skema-final.sql) —
-- SATU-SATUNYA tabel yang punya FK ke bookings(id). items, public_pages,
-- businesses (termasuk logo_url), dan customers TIDAK ikut terhapus —
-- katalog/etalase/profil usaha demo tetap dipertahankan dan
-- di-upsert/dipatch seperti biasa oleh demoReset.ts setelah RPC ini
-- dipanggil. customer_photo_url di bookings cuma kolom URL ke R2 (tanpa
-- FK) — objeknya jadi orphan setelah booking-nya dihapus, konsisten
-- dengan konvensi "tidak ada delete-on-replace" yang sudah dipakai di
-- fitur upload lain (harmless, lihat memory project).
create or replace function reset_demo_bookings(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  is_demo_owner boolean;
begin
  select exists (
    select 1
    from business_members bm
    where bm.business_id = p_business_id
      and bm.role = 'owner'
      and bm.email = 'demo.pemilik@sewalog.test'
      and bm.user_id = auth.uid()
      -- Lapis tambahan: email snapshot di business_members ikut dicek
      -- terhadap email di JWT token pemanggil sendiri (bukan cuma kolom
      -- yang disnapshot, yang secara teori ikut UPDATE businesses tapi
      -- TIDAK ikut UPDATE business_members manapun — tidak ada policy
      -- UPDATE untuk business_members sama sekali, jadi kolom ini
      -- sebenarnya sudah tidak bisa diubah user manapun; ini murni jaga-
      -- jaga ekstra, bukan menutup celah yang terbukti ada).
      and lower(auth.jwt() ->> 'email') = 'demo.pemilik@sewalog.test'
  ) into is_demo_owner;

  if not is_demo_owner then
    raise exception 'reset_demo_bookings: business_id bukan business demo, atau pemanggil bukan owner demo yang login';
  end if;

  delete from booking_status_history
    where booking_id in (select id from bookings where business_id = p_business_id);
  delete from penalties
    where booking_id in (select id from bookings where business_id = p_business_id);
  delete from deposits
    where booking_id in (select id from bookings where business_id = p_business_id);
  delete from booking_items
    where booking_id in (select id from bookings where business_id = p_business_id);
  delete from bookings
    where business_id = p_business_id;
end;
$$;

-- Default Supabase: EXECUTE pada fungsi baru otomatis ter-grant ke PUBLIC
-- (lihat memory project soal ini) — WAJIB di-revoke eksplisit supaya anon
-- (termasuk sesi yang belum login) tidak bisa memanggilnya sama sekali,
-- baru grant ke authenticated. Pemeriksaan di dalam fungsi (auth.uid())
-- adalah pertahanan kedua, bukan pengganti grant yang benar — tanpa
-- revoke ini, pengguna authenticated NON-demo tetap bisa memanggil
-- fungsinya (cuma akan kena exception, bukan ditolak di level grant).
-- WAJIB diverifikasi live lewat curl (anon key -> ditolak; login non-demo
-- -> exception; login demo.pemilik -> sukses), jangan diasumsikan dari
-- file migrasi saja.
revoke all on function reset_demo_bookings(uuid) from public;
revoke all on function reset_demo_bookings(uuid) from anon;
grant execute on function reset_demo_bookings(uuid) to authenticated;
