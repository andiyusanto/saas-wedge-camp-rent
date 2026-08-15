-- ============================================================
-- Migration 008 — Audit trail: riwayat status booking + jejak alat
-- ============================================================
-- Dua bentuk berbeda sesuai sifat datanya (didiskusikan sebelum ini
-- ditulis):
-- - booking punya alur status yang jelas (dipesan->aktif->selesai/telat/
--   dibatalkan) -> layak dicatat sebagai RIWAYAT (tabel append-only,
--   satu baris per transisi), supaya kelihatan urutannya.
-- - items cuma CRUD biasa, bukan state machine -> cukup kolom "siapa
--   terakhir tanggung jawab", bukan tabel riwayat penuh.

-- --------------------------------------------------------------
-- booking_status_history — append-only, sama prinsipnya dengan
-- marketplace_consents: tidak ada policy update/delete, supaya riwayat
-- tidak bisa diubah retroaktif.
-- --------------------------------------------------------------
create table booking_status_history (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references bookings(id),
  status           text not null,
  changed_by       uuid not null references auth.users(id),
  changed_by_name  text not null, -- snapshot nama, pola sama seperti booking_items.price_at_booking
  created_at       timestamptz not null default now()
);

alter table booking_status_history enable row level security;

create policy "members_select_booking_status_history"
  on booking_status_history for select
  using (
    booking_id in (select id from bookings where is_member_of(business_id))
  );

create policy "members_insert_booking_status_history"
  on booking_status_history for insert
  with check (
    booking_id in (select id from bookings where is_member_of(business_id))
    and changed_by = auth.uid()
  );

-- --------------------------------------------------------------
-- items — jejak siapa membuat/mengubah/menonaktifkan
-- --------------------------------------------------------------
alter table items
  add column if not exists created_by uuid references auth.users(id) default auth.uid(),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz,
  add column if not exists deactivated_by uuid references auth.users(id);

-- Trigger, bukan mengandalkan kode aplikasi selalu ingat mengisi kolom
-- ini — items ditulis langsung dari frontend (bukan lewat backend kita),
-- jadi ini jaring pengaman supaya jalur tulis baru di masa depan tidak
-- bisa lupa mengisinya.
create or replace function set_items_updated_audit()
returns trigger
language plpgsql
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  -- deactivated_at baru saja diisi (transisi null -> ada nilai) -> catat
  -- siapa yang menonaktifkan. Reaktivasi (balik ke null) sengaja tidak
  -- menyentuh kolom ini, biar tetap ada jejak siapa yang PERNAH nonaktifkan.
  if new.deactivated_at is not null and old.deactivated_at is null then
    new.deactivated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger items_set_updated_audit
  before update on items
  for each row
  execute function set_items_updated_audit();
