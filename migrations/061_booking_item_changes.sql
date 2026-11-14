-- ============================================================
-- Migration 061 -- Ubah Alat (transaksi "Siap Diambil")
-- ============================================================
-- Brief disetujui Andi 14 Nov 2026: research/brief-ubah-alat-siap-diambil-2026-11.md
-- (vendor Para Adventure/Bondowoso, wawancara IG/TikTok). Tombol "Ubah
-- Alat" HANYA untuk booking berstatus 'dipesan' ("Siap Diambil") --
-- tambah/ubah jumlah/hapus alat, tanggal TIDAK berubah (beda dari Ubah
-- Jadwal, migration 055).
--
-- Kenapa RPC baru (bukan pola reschedule/extend yang beberapa request
-- Express terpisah): mengganti isi booking_items (hapus+insert banyak
-- baris) lebih berisiko kalau gagal di tengah jalan (bisa menyisakan
-- booking tanpa alat sama sekali, atau stok ganda terhitung) dibanding
-- update satu kolom scalar seperti reschedule/extend -- brief eksplisit
-- minta "satu transaksi Postgres (RPC)". Perhitungan HARGA (tarif
-- bertingkat computeItemRentalPrice/computeBookingTotalPrice) SENGAJA
-- TIDAK diulang di SQL -- itu sudah ada di 3 runtime terpisah
-- (frontend, backend lib/pricing.ts, demoReset.ts/seed-demo.mjs) dengan
-- risiko drift yang sudah dicatat eksplisit di migration 034; RPC ini
-- cuma mengeksekusi TULIS banyak tabel secara atomik dari payload yang
-- SUDAH dihitung Express (PATCH /bookings/:id/items, lib/pricing.ts).

-- --------------------------------------------------------------
-- 1. booking_item_changes -- riwayat append-only
-- --------------------------------------------------------------
-- BUKAN perluasan booking_reschedules (migration 055) -- skema itu
-- date-centric (old/new start/end date), tidak cocok untuk daftar alat.
-- old_items/new_items snapshot NAMA alat sebagai teks (bukan cuma
-- item_id + join saat tampil) supaya riwayat tetap akurat kalau nama
-- alat diganti belakangan -- pola sama alasan penalties/struk snapshot
-- nama. Bentuk tiap elemen: {item_id, name, quantity, subtotal}.
create table booking_item_changes (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references bookings(id),
  business_id       uuid not null references businesses(id),
  old_items         jsonb not null,
  new_items         jsonb not null,
  old_total_price   numeric not null,
  new_total_price   numeric not null,
  reason            text,
  changed_by        uuid not null references auth.users(id),
  changed_by_name   text not null,
  created_at        timestamptz not null default now()
);

alter table booking_item_changes enable row level security;

create policy "members_select_booking_item_changes"
  on booking_item_changes for select
  using (is_member_of(business_id));

create policy "members_insert_booking_item_changes"
  on booking_item_changes for insert
  with check (
    is_member_of(business_id)
    and booking_id in (select id from bookings where business_id = booking_item_changes.business_id)
    and changed_by = auth.uid()
  );

-- Sengaja TIDAK ada policy update/delete -- riwayat tidak boleh diubah
-- retroaktif oleh siapa pun, termasuk owner (pola sama booking_reschedules,
-- booking_status_history).

-- --------------------------------------------------------------
-- 2. apply_booking_item_changes -- satu-satunya jalur tulis
-- --------------------------------------------------------------
-- SECURITY DEFINER = BYPASS RLS -- semua pengecekan di bawah WAJIB
-- diulang manual di sini, tidak bisa mengandalkan policy klien seperti
-- biasa. p_new_items: jsonb array, tiap elemen
-- {item_id, quantity, price_at_booking, day2_rate_at_booking,
--  day3_rate_at_booking, day4_rate_at_booking, day5_rate_at_booking,
--  extra_day_rate_at_booking, subtotal} -- SUDAH dihitung/di-snapshot
-- Express (PATCH /bookings/:id/items): alat existing pakai tarif
-- SNAPSHOT lama apa adanya, alat baru pakai tarif katalog SAAT INI.
--
-- Review -c1 (14 Nov 2026) poin 1 -- WAJIB: validasi tiap item_id di
-- p_new_items benar-benar milik business YANG SAMA dengan booking ini
-- (items.business_id = booking.business_id). Tanpa ini, anggota bisa
-- menautkan alat milik business lain ke booking-nya sendiri (RPC ini
-- bypass RLS items, jadi tidak ada penjagaan lain). Skema items TIDAK
-- punya kolom "aktif/nonaktif" (tidak ada soft-delete) -- exists di
-- tabel items dengan business_id yang cocok SUDAH cukup sebagai
-- penanda "alat ini valid dipakai".
--
-- Review -c1 poin 3 -- CATATAN RISIKO (didokumentasikan, SENGAJA TIDAK
-- ditutup sekarang): RPC ini bisa dipanggil LANGSUNG oleh anggota
-- (lewat JWT sendiri) TANPA melalui validasi stok Express (PATCH
-- /bookings/:id/items) -- RPC sendiri TIDAK mengulang pengecekan stok
-- (readiness_hours, usedUnitsOn dkk, logika TS-only di lib/availability.ts,
-- sengaja tidak diduplikasi ke SQL dengan alasan sama seperti pricing
-- di atas). Risiko ini SETARA dengan policy RLS "members_insert_own_booking_items"
-- yang SUDAH ADA (migration 044) -- anggota mana pun yang punya akses
-- booking ini SUDAH BISA insert booking_items langsung lewat Supabase
-- client tanpa lewat Express sama sekali, independen dari RPC ini. Jadi
-- BUKAN celah baru yang dibuka migration ini, cuma jalur tambahan
-- dengan risiko yang sama -- staf nakal yang overbook alat sendiri
-- cuma merugikan business-nya sendiri, bukan business lain (sudah
-- dibatasi is_member_of + validasi item_id di atas).
create or replace function apply_booking_item_changes(
  p_booking_id uuid,
  p_new_items jsonb,
  p_new_total_price numeric,
  p_reason text,
  p_changed_by_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_old_items jsonb;
  v_new_items jsonb;
  v_item_count int;
begin
  select id, business_id, status, total_price
  into v_booking
  from bookings
  where id = p_booking_id
  for update;

  if v_booking is null then
    raise exception 'apply_booking_item_changes: transaksi tidak ditemukan';
  end if;

  if not is_member_of(v_booking.business_id) then
    raise exception 'apply_booking_item_changes: tidak berhak';
  end if;

  -- Keputusan Andi 14 Nov 2026: SELURUH aksi Ubah Alat dikunci kalau
  -- business hanya-baca (bukan cuma "tambah alat baru" seperti RLS
  -- booking_items INSERT yang sudah ada) -- mengubah isi pesanan
  -- (termasuk kurangi/hapus alat) dianggap "kerja baru", beda dari
  -- menyelesaikan transaksi berjalan (ambil/kembalikan/batalkan yang
  -- tetap terbuka). Satu aturan, bukan dua, untuk UX sederhana.
  if not business_is_writable(v_booking.business_id) then
    raise exception 'apply_booking_item_changes: akun ini hanya-baca, tidak bisa mengubah transaksi';
  end if;

  if v_booking.status != 'dipesan' then
    raise exception 'apply_booking_item_changes: Ubah Alat cuma berlaku untuk transaksi berstatus Siap Diambil';
  end if;

  if p_new_items is null or jsonb_typeof(p_new_items) != 'array' or jsonb_array_length(p_new_items) < 1 then
    raise exception 'apply_booking_item_changes: minimal satu alat harus tersisa';
  end if;

  if p_new_total_price is null or p_new_total_price < 0 then
    raise exception 'apply_booking_item_changes: total harga tidak valid';
  end if;

  -- Review -c1 poin 1: tiap item_id WAJIB milik business yang sama
  -- dengan booking ini DAN masih aktif (items.deactivated_at is null,
  -- kolom soft-delete yang sudah ada -- koreksi dari draft awal migration
  -- ini yang sempat salah bilang items tidak punya kolom aktif/nonaktif
  -- sama sekali), dan quantity WAJIB bilangan bulat >= 1. Diterapkan ke
  -- SEMUA item di p_new_items, termasuk yang sebenarnya alat EXISTING
  -- yang cuma dipertahankan tanpa perubahan -- efek sampingnya: kalau
  -- satu alat di booking ini dinonaktifkan SETELAH dipesan, vendor jadi
  -- tidak bisa Ubah Alat sama sekali (termasuk untuk mengubah alat LAIN
  -- di booking yang sama) sampai alat itu dihapus dari daftar atau
  -- diaktifkan ulang -- kasus tepi yang diketahui, didokumentasikan di
  -- sini, bukan ditutupi diam-diam.
  if exists (
    select 1
    from jsonb_to_recordset(p_new_items) as x(item_id uuid, quantity int)
    where x.item_id is null
       or x.quantity is null
       or x.quantity < 1
       or not exists (
            select 1 from items i
            where i.id = x.item_id and i.business_id = v_booking.business_id and i.deactivated_at is null
          )
  ) then
    raise exception 'apply_booking_item_changes: ada alat yang tidak valid, bukan milik usaha ini, nonaktif, atau jumlah tidak valid';
  end if;

  -- Snapshot OLD items dari booking_items + nama items SAAT INI,
  -- SEBELUM dihapus -- dibaca di sini (bukan dari parameter) supaya
  -- riwayat akurat terhadap state TEPAT sebelum mutasi ini, bukan state
  -- yang mungkin sudah basi dari pembacaan Express sebelumnya.
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', bi.item_id,
           'name', i.name,
           'quantity', bi.quantity,
           'subtotal', bi.subtotal
         )), '[]'::jsonb)
  into v_old_items
  from booking_items bi
  join items i on i.id = bi.item_id
  where bi.booking_id = p_booking_id;

  -- booking_items TIDAK punya unique constraint (booking_id,item_id),
  -- jadi ON CONFLICT tidak bisa dipakai tanpa migration tambahan --
  -- delete-all + insert-all dalam transaksi yang sama tetap atomik.
  -- Review -c1 poin 2 (dicek eksplisit sebelum migration ini ditulis):
  -- tidak ada FK atau referensi lain ke booking_items.id di mana pun
  -- (penalties.item_id -> items(id), BUKAN booking_items(id); deposits
  -- tidak menyimpan referensi alat sama sekali; frontend tidak pernah
  -- membaca/menyimpan booking_items.id, hanya item_id/quantity/subtotal
  -- yang selalu di-fetch ulang) -- mengganti id lewat delete+insert aman.
  delete from booking_items where booking_id = p_booking_id;

  insert into booking_items (
    booking_id, item_id, quantity, price_at_booking, subtotal,
    day2_rate_at_booking, day3_rate_at_booking, day4_rate_at_booking,
    day5_rate_at_booking, extra_day_rate_at_booking
  )
  select
    p_booking_id,
    (x->>'item_id')::uuid,
    (x->>'quantity')::int,
    (x->>'price_at_booking')::numeric,
    (x->>'subtotal')::numeric,
    (x->>'day2_rate_at_booking')::numeric,
    (x->>'day3_rate_at_booking')::numeric,
    (x->>'day4_rate_at_booking')::numeric,
    (x->>'day5_rate_at_booking')::numeric,
    (x->>'extra_day_rate_at_booking')::numeric
  from jsonb_array_elements(p_new_items) as x;

  select jsonb_agg(jsonb_build_object(
           'item_id', (x->>'item_id')::uuid,
           'name', i.name,
           'quantity', (x->>'quantity')::int,
           'subtotal', (x->>'subtotal')::numeric
         ))
  into v_new_items
  from jsonb_array_elements(p_new_items) as x
  join items i on i.id = (x->>'item_id')::uuid;

  update bookings set total_price = p_new_total_price where id = p_booking_id;

  insert into booking_item_changes (
    booking_id, business_id, old_items, new_items, old_total_price, new_total_price,
    reason, changed_by, changed_by_name
  ) values (
    p_booking_id, v_booking.business_id, v_old_items, v_new_items, v_booking.total_price, p_new_total_price,
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(), p_changed_by_name
  );
end;
$$;

revoke all on function apply_booking_item_changes(uuid, jsonb, numeric, text, text) from public, anon;
grant execute on function apply_booking_item_changes(uuid, jsonb, numeric, text, text) to authenticated;

-- --------------------------------------------------------------
-- 3. reset_demo_bookings -- + bersihkan booking_item_changes
-- --------------------------------------------------------------
-- create or replace ulang persis isi migration 055 (yang sendiri sudah
-- ulang 037/036), ditambah DELETE booking_item_changes sebelum bookings
-- -- tanpa ini, reset gagal dengan FK violation begitu demo pernah
-- dipakai untuk uji Ubah Alat (pola sama persis insiden booking_reschedules
-- di migration 055).
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
      and lower(auth.jwt() ->> 'email') = 'demo.pemilik@sewalog.test'
  ) into is_demo_owner;

  if not is_demo_owner then
    raise exception 'reset_demo_bookings: business_id bukan business demo, atau pemanggil bukan owner demo yang login';
  end if;

  delete from booking_request_items
    where booking_request_id in (select id from booking_requests where business_id = p_business_id);
  delete from booking_requests
    where business_id = p_business_id;

  delete from booking_item_changes
    where business_id = p_business_id;
  delete from booking_reschedules
    where business_id = p_business_id;
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

revoke all on function reset_demo_bookings(uuid) from public;
revoke all on function reset_demo_bookings(uuid) from anon;
grant execute on function reset_demo_bookings(uuid) to authenticated;
