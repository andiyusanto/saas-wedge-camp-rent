-- ============================================================
-- Migration 055 -- Ubah Jadwal & Perpanjang (Tahap 2)
-- ============================================================
-- Brief & keputusan Andi: research/brief-paket-hari-dan-reschedule-2026-11.md
-- (Tahap 2). Dua aksi terpisah: "Ubah jadwal" (booking dipesan, tanggal
-- ambil & kembali keduanya bisa berubah) dan "Perpanjang" (booking aktif,
-- cuma tanggal kembali maju -- batas telat computeDueAt ikut geser).
--
-- businesses.reschedule_deadline_days: nullable, "ubah jadwal paling
-- lambat H-N hari sebelum tanggal ambil". DIPUTUSKAN Andi 10 Nov 2026:
-- PERINGATAN, bukan blokir -- kolom ini cuma dipakai backend untuk
-- menandai past_deadline (dan mewajibkan reason), tidak pernah menolak
-- permintaan. Tidak berlaku untuk Perpanjang (alat sudah diambil).
--
-- booking_reschedules: append-only (pola sama persis seperti
-- booking_status_history, migration 008) -- riwayat tanggal lama/baru,
-- total lama/baru, siapa, kapan, alasan, dan penanda lewat batas H-N.
-- Tidak ada policy update/delete.
-- ============================================================

alter table businesses
  add column if not exists reschedule_deadline_days int;

alter table businesses drop constraint if exists businesses_reschedule_deadline_positive;
alter table businesses add constraint businesses_reschedule_deadline_positive
  check (reschedule_deadline_days is null or reschedule_deadline_days >= 0);

create table booking_reschedules (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references bookings(id),
  business_id      uuid not null references businesses(id),
  action           text not null check (action in ('ubah_jadwal', 'perpanjang')),
  old_start_date   date not null,
  old_end_date     date not null,
  new_start_date   date not null,
  new_end_date     date not null,
  old_total_price  numeric not null,
  new_total_price  numeric not null,
  reason           text,
  past_deadline    boolean not null default false,
  changed_by       uuid not null references auth.users(id),
  changed_by_name  text not null,
  created_at       timestamptz not null default now()
);

alter table booking_reschedules enable row level security;

create policy "members_select_booking_reschedules"
  on booking_reschedules for select
  using (is_member_of(business_id));

create policy "members_insert_booking_reschedules"
  on booking_reschedules for insert
  with check (
    is_member_of(business_id)
    and booking_id in (select id from bookings where business_id = booking_reschedules.business_id)
    and changed_by = auth.uid()
  );

-- Sengaja TIDAK ada policy update/delete untuk klien manapun -- riwayat
-- perubahan jadwal tidak boleh diubah/dihapus retroaktif oleh siapa pun,
-- termasuk owner (sama prinsip booking_status_history & marketplace_consents).

-- ------------------------------------------------------------
-- reset_demo_bookings (037) -- + bersihkan booking_reschedules milik
-- business demo. Tanpa ini, reset gagal dengan FK violation begitu ada
-- baris booking_reschedules (ketahuan langsung saat verifikasi Tahap 2,
-- 10 Nov 2026) -- bookings tidak bisa dihapus selama masih direferensi
-- booking_reschedules.booking_id.
-- ------------------------------------------------------------
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
