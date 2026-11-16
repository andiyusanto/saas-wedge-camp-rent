-- Pelunasan + Nota Cetak Ulang + Batalkan/Void (brief 17 Nov 2026,
-- research/brief-pelunasan-nota-ulang-void-2026-11.md) -- usulan Campease
-- Outdoor: belum ada cara melunasi DP, pelanggan sering minta cetak ulang
-- nota, dan pertanyaan soal hapus riwayat. DRAFT revisi 2 -- belum
-- dijalankan, menunggu "siap dijalankan" dari koordinator.
--
-- Idempoten (pola migration 061/064/066 -- file ini kemungkinan dijalankan
-- ulang): create table/index if not exists, drop policy/trigger/function
-- if exists sebelum create, add column if not exists.

-- =====================================================================
-- 1. bookings.dp_method -- cara bayar DP awal (opsional, dibaca trigger
--    bagian 4 di bawah). Nullable, rental lama/DP tanpa cara bayar
--    tercatat tetap null.
-- =====================================================================
alter table bookings add column if not exists dp_method text
  check (dp_method is null or dp_method in ('tunai', 'transfer', 'qris'));

-- =====================================================================
-- 2. booking_payments -- append-only (pola booking_reschedules migration
--    055 / booking_item_changes migration 061): TIDAK ADA policy
--    update/delete. Satu-satunya jalur TULIS adalah RPC add_booking_payment
--    (bagian 5) DAN trigger DP awal (bagian 4) -- bukan insert langsung
--    dari Express/supabase-js (pola booking_sale_items migration 066).
-- =====================================================================
create table if not exists booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  business_id uuid not null references businesses(id),
  amount numeric not null,
  method text check (method is null or method in ('tunai', 'transfer', 'qris')),
  kind text not null check (kind in ('dp', 'pelunasan', 'pembayaran', 'koreksi')),
  note text,
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id), -- nullable: baris trigger/backfill tidak selalu punya user asli
  created_by_name text not null,
  created_at timestamptz not null default now(),
  -- 'koreksi' (jalur ralat/refund pembayaran keliru, owner-only, ditegakkan
  -- di RPC) WAJIB negatif; jenis lain WAJIB positif. amount tidak pernah 0.
  constraint booking_payments_amount_sign check (
    (kind = 'koreksi' and amount < 0) or (kind <> 'koreksi' and amount > 0)
  )
);

create index if not exists booking_payments_booking_id_idx on booking_payments (booking_id);
create index if not exists booking_payments_business_id_paid_at_idx on booking_payments (business_id, paid_at);

alter table booking_payments enable row level security;

drop policy if exists members_select_booking_payments on booking_payments;
create policy members_select_booking_payments on booking_payments
  for select using (is_member_of(business_id));

-- SENGAJA tidak ada policy insert/update/delete untuk member -- satu-
-- satunya jalur tulis adalah trigger (bagian 4) dan add_booking_payment()
-- (bagian 5), keduanya SECURITY DEFINER.

-- =====================================================================
-- 3. booking_status_history.reason -- kolom BARU, nullable (baris lama
--    tetap null, bukan backfill). Dipakai utamanya oleh Batalkan/Void
--    (bagian 6) tapi kolomnya generik, boleh dipakai status lain nanti.
-- =====================================================================
alter table booking_status_history add column if not exists reason text;

-- =====================================================================
-- 4. Trigger DP awal -- REVISI dari rencana semula (yang memanggil RPC
--    add_booking_payment kind='dp' SETELAH booking tersimpan -- itu akan
--    menulis dp_paid DUA KALI: sekali dari POST /bookings yang sudah
--    menulis dp_paid langsung, sekali lagi dari RPC yang nambah
--    dp_paid += amount, DAN kalau panggilan RPC itu gagal, riwayat
--    pembayaran bolong tanpa booking-nya ikut gagal). Trigger ini jalan
--    ATOMIK dalam transaksi INSERT bookings yang sama -- tidak pernah
--    mengubah dp_paid (sudah ditulis oleh Express), cuma mencatat
--    riwayatnya ke booking_payments.
-- =====================================================================
create or replace function log_initial_dp_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dp_paid > 0 then
    -- created_by_name literal "Catat Transaksi" -- trigger tidak punya
    -- akses mudah ke nama staf pembuat booking tanpa join customers
    -- (yang justru nama PELANGGAN, bukan staf); auth.uid() di created_by
    -- sudah cukup kalau identitas staf perlu ditelusuri lagi nanti.
    insert into booking_payments (booking_id, business_id, amount, method, kind, created_by, created_by_name)
      values (new.id, new.business_id, new.dp_paid, new.dp_method, 'dp', auth.uid(), 'Catat Transaksi');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_initial_dp_payment on bookings;
create trigger trg_log_initial_dp_payment
  after insert on bookings
  for each row
  execute function log_initial_dp_payment();

-- =====================================================================
-- 5. add_booking_payment -- RPC atomik untuk SEMUA pembayaran SETELAH
--    booking dibuat (pelunasan/pembayaran susulan/koreksi) -- DP awal
--    TIDAK lewat sini, sudah dicatat trigger bagian 4. Validasi sisa
--    tagihan LIVE (termasuk denda yang sudah tercatat saat RPC dipanggil),
--    insert booking_payments, lalu update bookings.dp_paid (cache lama,
--    TETAP dipakai supaya kode yang masih baca dp_paid langsung tidak
--    rusak). TIDAK dicek business_is_writable (keputusan Andi -- pelunasan
--    dianggap "menyelesaikan transaksi berjalan", pola migration 044,
--    sama seperti pickup/return/cancel/restore_sale_item_stock_for_booking).
--    p_is_owner DIHAPUS dari parameter (revisi koordinator -- nilai dari
--    client tidak bermakna sebagai bukti otorisasi) -- role dicek LANGSUNG
--    lewat is_owner_of() di dalam fungsi.
-- =====================================================================
drop function if exists add_booking_payment(uuid, numeric, text, text, text, text, boolean);

create or replace function add_booking_payment(
  p_booking_id uuid,
  p_amount numeric,
  p_method text,
  p_note text,
  p_kind text,
  p_created_by_name text
)
returns table (payment_id uuid, new_dp_paid numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_penalty_total numeric;
  v_due numeric;
  v_payment_id uuid;
begin
  select id, business_id, total_price, dp_paid, status
    into v_booking
    from bookings
    where id = p_booking_id
    for update;

  if v_booking is null then
    raise exception 'add_booking_payment: transaksi tidak ditemukan';
  end if;

  if not is_member_of(v_booking.business_id) then
    raise exception 'add_booking_payment: tidak berhak';
  end if;

  if p_kind not in ('dp', 'pelunasan', 'pembayaran', 'koreksi') then
    raise exception 'add_booking_payment: kind tidak valid';
  end if;

  if p_kind = 'koreksi' then
    -- Ralat/refund pembayaran keliru -- owner-only, alasan WAJIB (dicek
    -- di RPC, bukan cuma Express, karena RPC bisa dipanggil langsung
    -- lewat supabase-js -- pola risiko yang sama seperti RPC lain yang
    -- sudah ada, mis. apply_booking_item_changes migration 061). Boleh
    -- dipakai pada booking 'dibatalkan' juga (refund setelah void).
    if not is_owner_of(v_booking.business_id) then
      raise exception 'add_booking_payment: koreksi cuma untuk pemilik usaha';
    end if;
    if p_note is null or btrim(p_note) = '' then
      raise exception 'add_booking_payment: koreksi wajib diisi alasan';
    end if;
    if p_amount >= 0 then
      raise exception 'add_booking_payment: koreksi harus bernilai negatif';
    end if;
    if v_booking.dp_paid + p_amount < 0 then
      raise exception 'add_booking_payment: koreksi membuat total dibayar negatif (sudah dibayar Rp%)', v_booking.dp_paid;
    end if;
  else
    if v_booking.status = 'dibatalkan' then
      raise exception 'add_booking_payment: transaksi sudah dibatalkan, cuma koreksi/refund yang diizinkan';
    end if;

    if p_amount <= 0 then
      raise exception 'add_booking_payment: nominal harus lebih dari 0';
    end if;

    select coalesce(sum(amount), 0) into v_penalty_total
      from penalties where booking_id = p_booking_id;

    v_due := v_booking.total_price + v_penalty_total - v_booking.dp_paid;

    if p_amount > v_due then
      raise exception 'add_booking_payment: nominal melebihi sisa tagihan (sisa Rp%)', v_due;
    end if;
  end if;

  insert into booking_payments (booking_id, business_id, amount, method, kind, note, created_by, created_by_name)
    values (p_booking_id, v_booking.business_id, p_amount, p_method, p_kind, p_note, auth.uid(), p_created_by_name)
    returning id into v_payment_id;

  update bookings set dp_paid = dp_paid + p_amount where id = p_booking_id;

  return query select v_payment_id, (v_booking.dp_paid + p_amount);
end;
$$;

revoke all on function add_booking_payment(uuid, numeric, text, text, text, text) from public, anon;
grant execute on function add_booking_payment(uuid, numeric, text, text, text, text) to authenticated;

-- =====================================================================
-- 6. Backfill -- booking lama dengan dp_paid > 0 dapat SATU baris
--    booking_payments kind='dp', method=null, note menandai asal migrasi,
--    paid_at = created_at (BUKAN now() -- supaya "Uang diterima" per
--    bulan paid_at di Laporan tidak keliru menumpuk semua histori lama
--    ke bulan migration ini dijalankan). Idempoten lewat NOT EXISTS --
--    booking yang trigger bagian 4 SUDAH tangani (dibuat setelah migration
--    ini live) otomatis dilewati karena baris payment-nya sudah ada.
-- =====================================================================
insert into booking_payments (booking_id, business_id, amount, method, kind, note, paid_at, created_by, created_by_name, created_at)
select b.id, b.business_id, b.dp_paid, null, 'dp',
       'Migrasi otomatis dari dp_paid lama (migration 067)', b.created_at, null,
       'Migrasi otomatis', b.created_at
from bookings b
where b.dp_paid > 0
  and not exists (select 1 from booking_payments bp where bp.booking_id = b.id);

-- =====================================================================
-- 7. Void/Batalkan oleh owner dari status APA PUN (termasuk selesai/telat).
--    TIDAK RPC baru -- logika status+reason ditegakkan di Express
--    (backend/src/routes/trackings.ts, endpoint /cancel yang sudah ada),
--    migration ini CUMA menyediakan kolom reason (bagian 3) dan RLS-nya
--    sendiri tidak berubah (booking_status_history tetap append-only,
--    insert oleh member dengan changed_by = auth.uid(), kolom reason baru
--    ikut tunduk ke policy yang sama tanpa perlu policy terpisah). Dialog
--    Batalkan di frontend menawarkan "Catat pengembalian dana Rp X" lewat
--    add_booking_payment kind='koreksi' yang sudah mengizinkan booking
--    'dibatalkan' (bagian 5) -- bukan RPC/kolom tambahan.
-- =====================================================================
