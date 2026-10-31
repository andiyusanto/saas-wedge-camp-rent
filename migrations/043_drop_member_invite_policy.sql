-- ============================================================
-- Migration 043 — URGENT: hapus policy insert business_invites yang
-- seharusnya sudah mati sejak migration 014
-- ============================================================
-- BUG KEAMANAN LIVE DI PRODUKSI (ditemukan 31 Okt 2026 lewat pg_policies
-- langsung, dikonfirmasi Andi): migration 014 (Kelola Usaha owner-only)
-- MENULISKAN `drop policy if exists "members_create_invites"` lalu
-- membuat `owner_create_invites` (is_owner_of, bukan is_member_of) —
-- niatnya undang karyawan baru HARUS owner-only. Tapi drop itu entah
-- kenapa tidak menghapus policy lama yang benar-benar live (drift tak
-- terdokumentasi, sama polanya seperti drift items/customers/bookings/
-- booking_items yang baru ketahuan di review migration 044). Akibatnya
-- KEDUA policy insert hidup berdampingan sampai sekarang — RLS Postgres
-- meng-OR-kan semua policy yang cocok untuk perintah yang sama, jadi
-- `members_create_invites` (is_member_of, BUKAN owner-only) tetap
-- mengizinkan KARYAWAN mengundang karyawan lain, meregresi fix keamanan
-- 014 secara diam-diam SELAMA INI.
--
-- Pertahanan kedua di backend/src/routes/team.ts (`POST /team/invites`)
-- SUDAH mengecek `getCallerRole(...) === 'owner'` sebelum insert — jadi
-- jalur lewat endpoint Express yang ada SEKARANG aman. Tapi RLS sendiri
-- (satu-satunya penjaga kalau ada kode lain yang insert langsung lewat
-- Supabase client, atau endpoint baru nanti lupa menambahkan cek yang
-- sama) sudah bocor sejak 014 — migration ini menutupnya SEKARANG,
-- terpisah dan SEBELUM migration 044 (langganan) supaya tidak menunggu
-- fitur lain yang lebih besar.
--
-- Dijalankan Andi SEGERA, terpisah dari 044.
drop policy if exists "members_create_invites" on business_invites;

-- Verifikasi keras — gagalkan migration kalau masih ada policy INSERT
-- lain di business_invites selain owner_create_invites (yang sudah ada
-- dari migration 014, tidak disentuh di sini).
do $$
begin
  if exists (
    select 1 from pg_policies
    where tablename = 'business_invites' and cmd = 'INSERT' and policyname <> 'owner_create_invites'
  ) then
    raise exception 'migration 043: masih ada policy INSERT lain di business_invites selain owner_create_invites — cek pg_policies manual';
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
