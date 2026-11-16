-- Barang Jual (habis pakai), v1 (brief 16 Nov 2026,
-- research/brief-barang-jual-2026-11.md) -- usulan Campease Outdoor:
-- barang yang dijual-belikan (baterai, jas hujan, hand warmer) terpisah
-- dari alat SEWA. Sewalog tetap alat untuk rental, bukan kasir -- v1
-- sengaja ringan: tanpa modal/HPP/laba, tanpa pembelian stok, tanpa
-- barcode, tanpa Etalase.
--
-- Tabel TERPISAH dari items/booking_items (keputusan koordinator 16 Nov
-- 2026) -- supaya usedUnitsOn(), Kalender, get_public_availability,
-- readiness, dan denda per alat TIDAK tersentuh sama sekali (nol risiko
-- regresi ketersediaan alat sewa).
--
-- Idempotensi (pola migration 061/064): seluruh statement di sini aman
-- dijalankan ulang.

create table if not exists sale_items (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id),
  name                text not null,
  image_url           text,
  price               numeric not null check (price >= 0),
  stock               int not null default 0 check (stock >= 0),
  low_stock_threshold int check (low_stock_threshold is null or low_stock_threshold >= 0),
  deactivated_at      timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists sale_items_business_id_idx on sale_items (business_id);

-- booking_sale_items -- baris jual per transaksi, snapshot nama+harga
-- (pola sama booking_items -- struk/Riwayat tidak pernah berubah diam-
-- diam kalau barang jual itu belakangan diedit/dinonaktifkan).
-- stock_restored_at (catatan koordinator poin 3): penanda IDEMPOTEN
-- restore stok saat Batalkan -- null = belum dikembalikan, diisi SEKALI
-- saat restore_sale_item_stock_for_booking() berhasil. Baris TIDAK
-- PERNAH dihapus (pola sama booking_items yang juga tidak dihapus saat
-- dibatalkan) supaya riwayat tetap ada dan restore aman diulang kalau
-- RPC sempat gagal di tengah jalan.
create table if not exists booking_sale_items (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references bookings(id) on delete cascade,
  sale_item_id       uuid references sale_items(id),
  business_id        uuid not null references businesses(id),
  name               text not null,
  price_at_booking   numeric not null,
  quantity           int not null check (quantity >= 1),
  subtotal           numeric not null,
  stock_restored_at  timestamptz
);

create index if not exists booking_sale_items_booking_id_idx on booking_sale_items (booking_id);
create index if not exists booking_sale_items_sale_item_id_idx on booking_sale_items (sale_item_id);

alter table sale_items enable row level security;
alter table booking_sale_items enable row level security;

-- Pola PERSIS items/bundles (migration 044/064): member select, insert/
-- update digerbang business_is_writable, delete member.
drop policy if exists members_select_sale_items on sale_items;
drop policy if exists members_insert_sale_items on sale_items;
drop policy if exists members_update_sale_items on sale_items;
drop policy if exists members_delete_sale_items on sale_items;
create policy members_select_sale_items on sale_items for select using (is_member_of(business_id));
create policy members_insert_sale_items
  on sale_items for insert
  with check (is_member_of(business_id) and business_is_writable(business_id));
create policy members_update_sale_items
  on sale_items for update
  using (is_member_of(business_id))
  with check (is_member_of(business_id) and business_is_writable(business_id));
create policy members_delete_sale_items on sale_items for delete using (is_member_of(business_id));

-- booking_sale_items -- SELECT-ONLY untuk member (catatan koordinator):
-- TIDAK ADA policy insert/update/delete langsung sama sekali -- satu-
-- satunya jalur tulis adalah RPC SECURITY DEFINER di bawah, supaya
-- member tidak bisa melewati pengecekan stok lewat insert langsung
-- lewat supabase-js (beda dari booking_items yang memang di-insert
-- langsung oleh Express karena tidak ada stok yang perlu dijaga).
drop policy if exists members_select_booking_sale_items on booking_sale_items;
create policy members_select_booking_sale_items on booking_sale_items for select using (is_member_of(business_id));

-- ----------------------------------------------------------------
-- 1. add_sale_item_stock -- "+ Tambah stok" di Katalog. Atomik murni
--    (increment commutatif, tidak butuh cek apa pun selain kepemilikan)
--    -- TAPI tetap lewat RPC (bukan update langsung dari klien, catatan
--    koordinator poin 1) karena klien yang menulis "stok_lama + n" bisa
--    menimpa pengurangan BERSAMAAN dari RPC transaksi -- `stock = stock
--    + p_qty` di server menghindari race itu sepenuhnya.
-- ----------------------------------------------------------------
create or replace function add_sale_item_stock(p_sale_item_id uuid, p_qty int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
begin
  select business_id into v_business_id from sale_items where id = p_sale_item_id for update;

  if v_business_id is null then
    raise exception 'add_sale_item_stock: barang tidak ditemukan';
  end if;

  if not is_member_of(v_business_id) then
    raise exception 'add_sale_item_stock: tidak berhak';
  end if;

  if not business_is_writable(v_business_id) then
    raise exception 'add_sale_item_stock: akun ini hanya-baca';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'add_sale_item_stock: jumlah tidak valid';
  end if;

  update sale_items set stock = stock + p_qty where id = p_sale_item_id;
end;
$$;

revoke all on function add_sale_item_stock(uuid, int) from public, anon;
grant execute on function add_sale_item_stock(uuid, int) to authenticated;

-- ----------------------------------------------------------------
-- 2. apply_new_booking_sale_items -- dipanggil POST /bookings SEBAGAI
--    LANGKAH TERAKHIR (setelah booking_items sukses), cuma kalau ada
--    barang jual di transaksi ini. Lock tiap sale_items TERKAIT
--    (for update, diurutkan id supaya tidak deadlock antar transaksi
--    multi-barang bersamaan), cek stok CUKUP UNTUK SEMUA BARIS
--    SEKALIGUS (tolak semua-atau-tidak-sama-sekali), baru kurangi +
--    insert booking_sale_items. business_id snapshot diisi dari
--    booking (bukan dari input, catatan koordinator poin 5).
-- ----------------------------------------------------------------
create or replace function apply_new_booking_sale_items(p_booking_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_insufficient text;
begin
  select id, business_id, status into v_booking from bookings where id = p_booking_id for update;

  if v_booking is null then
    raise exception 'apply_new_booking_sale_items: transaksi tidak ditemukan';
  end if;

  if not is_member_of(v_booking.business_id) then
    raise exception 'apply_new_booking_sale_items: tidak berhak';
  end if;

  if not business_is_writable(v_booking.business_id) then
    raise exception 'apply_new_booking_sale_items: akun ini hanya-baca';
  end if;

  -- Review koordinator 16 Nov 2026: fungsi ini namanya "new" -- cuma
  -- berlaku SEKALI untuk booking yang baru dibuat (dipanggil POST
  -- /bookings sebagai langkah terakhir), bukan untuk ditambah berulang
  -- ke booking yang sama (itu tugas apply_booking_item_and_sale_changes
  -- lewat Ubah Alat, yang punya logika delta sendiri). Juga dibatasi ke
  -- status yang baru dibuat (dipesan/aktif) -- bukan transaksi yang
  -- sudah selesai/dibatalkan.
  if exists (select 1 from booking_sale_items where booking_id = p_booking_id) then
    raise exception 'apply_new_booking_sale_items: transaksi ini sudah punya barang jual, pakai Ubah Alat untuk mengubahnya';
  end if;

  if v_booking.status not in ('dipesan', 'aktif') then
    raise exception 'apply_new_booking_sale_items: transaksi berstatus % tidak bisa ditambah barang jual baru', v_booking.status;
  end if;

  if p_items is null or jsonb_typeof(p_items) != 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'apply_new_booking_sale_items: minimal satu barang';
  end if;

  -- Review koordinator 16 Nov 2026 (serius): sale_item_id DUPLIKAT
  -- dalam satu payload ([{A,3},{A,3}]) membuat cek stok per-baris lolos
  -- (masing-masing dibandingkan ke stok PENUH, bukan totalnya) padahal
  -- totalnya bisa melebihi stok, dan UPDATE...FROM dengan multiple
  -- matching rows cuma menerapkan SATU (hasil tidak terdefinisi/salah),
  -- sementara INSERT tetap membuat 2 baris. Ditolak eksplisit di sini --
  -- Express SEHARUSNYA sudah menjumlahkan (merge) sebelum memanggil RPC
  -- ini, tapi RPC tidak boleh percaya itu (defense in depth).
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct x->>'sale_item_id') from jsonb_array_elements(p_items) as x) then
    raise exception 'apply_new_booking_sale_items: ada sale_item_id duplikat dalam satu permintaan';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(sale_item_id uuid, quantity int)
    left join sale_items si on si.id = x.sale_item_id and si.business_id = v_booking.business_id
    where x.sale_item_id is null
       or x.quantity is null
       or x.quantity < 1
       or si.id is null
       or si.deactivated_at is not null
  ) then
    raise exception 'apply_new_booking_sale_items: ada barang yang tidak valid/bukan milik usaha ini/nonaktif';
  end if;

  -- Lock SEMUA baris sale_items yang relevan dulu (diurutkan id --
  -- deterministik, mencegah deadlock kalau dua transaksi menyentuh set
  -- barang yang sama dalam urutan berbeda), BARU cek stok cukup untuk
  -- semua baris sekaligus. Tolak semua-atau-tidak-sama-sekali.
  perform 1 from sale_items where id in (
    select (x->>'sale_item_id')::uuid from jsonb_array_elements(p_items) as x
  ) order by id for update;

  select string_agg(si.name, ', ')
  into v_insufficient
  from jsonb_to_recordset(p_items) as x(sale_item_id uuid, quantity int)
  join sale_items si on si.id = x.sale_item_id
  where si.stock < x.quantity;

  if v_insufficient is not null then
    raise exception 'apply_new_booking_sale_items: stok tidak cukup untuk: %', v_insufficient;
  end if;

  update sale_items si
  set stock = si.stock - x.quantity
  from jsonb_to_recordset(p_items) as x(sale_item_id uuid, quantity int)
  where si.id = x.sale_item_id;

  insert into booking_sale_items (booking_id, sale_item_id, business_id, name, price_at_booking, quantity, subtotal)
  select
    p_booking_id,
    x.sale_item_id,
    v_booking.business_id,
    si.name,
    si.price,
    x.quantity,
    si.price * x.quantity
  from jsonb_to_recordset(p_items) as x(sale_item_id uuid, quantity int)
  join sale_items si on si.id = x.sale_item_id;
end;
$$;

revoke all on function apply_new_booking_sale_items(uuid, jsonb) from public, anon;
grant execute on function apply_new_booking_sale_items(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------
-- 3. apply_booking_item_and_sale_changes -- Ubah Alat, SATU RPC
--    pembungkus (catatan koordinator poin 2 -- dua RPC terpisah
--    berurutan dari Express TIDAK atomik, kalau satu sukses dan satu
--    gagal, stok/isi/total bisa tidak sinkron). Memanggil
--    apply_booking_item_changes() yang SUDAH ADA (migration 061/064,
--    TIDAK DIUBAH sama sekali) untuk bagian alat sewa, lalu menangani
--    delta stok barang jual, SEMUA dalam satu transaksi (satu
--    pemanggilan fungsi plpgsql = satu transaksi Postgres). total_price
--    ditulis SEKALI oleh apply_booking_item_changes() di dalam --
--    bagian barang jual tidak menulis total_price lagi.
-- ----------------------------------------------------------------
create or replace function apply_booking_item_and_sale_changes(
  p_booking_id uuid,
  p_new_items jsonb,
  p_new_sale_items jsonb,
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
  v_insufficient text;
begin
  -- apply_booking_item_changes() di bawah SUDAH melakukan `select ...
  -- for update` + semua pengecekan member/writable/status untuk baris
  -- bookings ini -- lock yang sama berlaku untuk SELURUH transaksi
  -- (termasuk bagian barang jual di bawah), tidak perlu lock kedua di
  -- sini.
  perform apply_booking_item_changes(p_booking_id, p_new_items, p_new_total_price, p_reason, p_changed_by_name);

  select id, business_id into v_booking from bookings where id = p_booking_id;

  -- p_new_sale_items null/kosong -- artinya business ini tidak punya
  -- barang jual aktif sama sekali ATAU transaksi ini memang tidak/tidak
  -- lagi punya barang jual (semua dikurangi jadi 0) -- cukup kembalikan
  -- SEMUA stok barang jual yang SEBELUMNYA tercatat di booking ini
  -- (delta penuh ke 0), lalu hapus barisnya.
  if p_new_sale_items is null or jsonb_typeof(p_new_sale_items) != 'array' then
    p_new_sale_items := '[]'::jsonb;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_new_sale_items) as x(sale_item_id uuid, quantity int, name text, price_at_booking numeric)
    where x.sale_item_id is null or x.quantity is null or x.quantity < 0
       or (x.quantity > 0 and (x.name is null or x.price_at_booking is null or x.price_at_booking < 0))
  ) then
    raise exception 'apply_booking_item_and_sale_changes: ada barang jual dengan data tidak valid';
  end if;

  -- Review koordinator 16 Nov 2026 (serius): sale_item_id duplikat
  -- dalam p_new_sale_items merusak perhitungan delta (full outer join
  -- di bawah mencocokkan lebih dari satu baris) -- ditolak eksplisit,
  -- pola sama apply_new_booking_sale_items.
  if (select count(*) from jsonb_array_elements(p_new_sale_items)) <>
     (select count(distinct x->>'sale_item_id') from jsonb_array_elements(p_new_sale_items) as x) then
    raise exception 'apply_booking_item_and_sale_changes: ada sale_item_id duplikat dalam satu permintaan';
  end if;

  -- Validasi kepemilikan HANYA untuk barang BARU (belum ada di
  -- booking_sale_items booking ini saat ini) -- barang lama yang
  -- belakangan dinonaktifkan tetap boleh dikurangi/dihapus (catatan
  -- koordinator poin 5, pola sama apply_booking_item_changes untuk
  -- alat sewa).
  if exists (
    select 1
    from jsonb_to_recordset(p_new_sale_items) as x(sale_item_id uuid, quantity int, name text, price_at_booking numeric)
    left join sale_items si on si.id = x.sale_item_id and si.business_id = v_booking.business_id
    left join booking_sale_items bsi_existing on bsi_existing.booking_id = p_booking_id and bsi_existing.sale_item_id = x.sale_item_id
    where x.quantity > 0
      and (
        si.id is null -- tidak ditemukan, atau bukan milik business ini
        or (bsi_existing.sale_item_id is null and si.deactivated_at is not null) -- barang BARU yang nonaktif
      )
  ) then
    raise exception 'apply_booking_item_and_sale_changes: ada barang jual yang tidak valid/bukan milik usaha ini/baru+nonaktif';
  end if;

  -- Delta stok: lock baris sale_items terkait dulu (diurutkan id),
  -- lalu cek stok cukup untuk SEMUA kenaikan permintaan sekaligus.
  perform 1 from sale_items where id in (
    select coalesce(x.sale_item_id, bsi.sale_item_id)
    from jsonb_to_recordset(p_new_sale_items) as x(sale_item_id uuid, quantity int, name text, price_at_booking numeric)
    full outer join booking_sale_items bsi on bsi.sale_item_id = x.sale_item_id and bsi.booking_id = p_booking_id
    where coalesce(x.sale_item_id, bsi.sale_item_id) is not null
  ) order by id for update;

  with deltas as (
    select
      coalesce(x.sale_item_id, bsi.sale_item_id) as sale_item_id,
      coalesce(x.quantity, 0) - coalesce(bsi.quantity, 0) as delta
    from jsonb_to_recordset(p_new_sale_items) as x(sale_item_id uuid, quantity int, name text, price_at_booking numeric)
    full outer join booking_sale_items bsi on bsi.sale_item_id = x.sale_item_id and bsi.booking_id = p_booking_id
  )
  select string_agg(si.name, ', ')
  into v_insufficient
  from deltas d
  join sale_items si on si.id = d.sale_item_id
  where d.delta > 0 and si.stock < d.delta;

  if v_insufficient is not null then
    raise exception 'apply_booking_item_and_sale_changes: stok tidak cukup untuk: %', v_insufficient;
  end if;

  with deltas as (
    select
      coalesce(x.sale_item_id, bsi.sale_item_id) as sale_item_id,
      coalesce(x.quantity, 0) - coalesce(bsi.quantity, 0) as delta
    from jsonb_to_recordset(p_new_sale_items) as x(sale_item_id uuid, quantity int, name text, price_at_booking numeric)
    full outer join booking_sale_items bsi on bsi.sale_item_id = x.sale_item_id and bsi.booking_id = p_booking_id
  )
  update sale_items si
  set stock = si.stock - d.delta
  from deltas d
  where si.id = d.sale_item_id and d.delta != 0;

  delete from booking_sale_items where booking_id = p_booking_id;

  -- name/price_at_booking DIPERCAYA dari payload (dihitung Express-side
  -- lewat mergeSaleItemsForUpdate -- pola SAMA PERSIS
  -- apply_booking_item_changes untuk alat sewa, yang juga mempercayai
  -- price_at_booking dari payload): barang yang SUDAH ADA di booking
  -- mempertahankan snapshot LAMA apa adanya (tidak di-re-snapshot ke
  -- harga katalog sekarang), barang BENAR-BENAR BARU dapat snapshot
  -- harga katalog SAAT INI -- resolusi mana yang dipakai terjadi di
  -- Express, RPC ini cuma menulis apa adanya (BUKAN join ke sale_items
  -- untuk harga, supaya tidak diam-diam menimpa snapshot lama dengan
  -- harga sekarang tiap kali Ubah Alat disimpan).
  insert into booking_sale_items (booking_id, sale_item_id, business_id, name, price_at_booking, quantity, subtotal)
  select
    p_booking_id,
    x.sale_item_id,
    v_booking.business_id,
    x.name,
    x.price_at_booking,
    x.quantity,
    x.price_at_booking * x.quantity
  from jsonb_to_recordset(p_new_sale_items) as x(sale_item_id uuid, quantity int, name text, price_at_booking numeric)
  where x.quantity > 0;
end;
$$;

revoke all on function apply_booking_item_and_sale_changes(uuid, jsonb, jsonb, numeric, text, text) from public, anon;
grant execute on function apply_booking_item_and_sale_changes(uuid, jsonb, jsonb, numeric, text, text) to authenticated;

-- ----------------------------------------------------------------
-- 4. restore_sale_item_stock_for_booking -- dipanggil routes/
--    trackings.ts endpoint Batalkan, TEPAT SETELAH conditional UPDATE
--    status booking yang SUDAH ADA berhasil (updatedRows.length > 0) --
--    proteksi "klik Batalkan dua kali" yang sudah ada otomatis juga
--    mencegah restore dipanggil dua kali DARI SISI CALLER, tapi RPC ini
--    SENDIRI tetap idempoten lewat stock_restored_at (catatan
--    koordinator poin 3) supaya aman diulang kalau sempat gagal di
--    tengah jalan (mis. timeout jaringan setelah status sudah
--    tersimpan) -- retry dari Express aman, tidak akan restore dobel.
--
--    SENGAJA TIDAK mengecek business_is_writable (catatan koordinator
--    poin 3) -- pembatalan TETAP TERBUKA untuk akun hanya-baca (migration
--    044: ambil/kembalikan/batalkan dianggap "menyelesaikan transaksi
--    berjalan", bukan "kerja baru"). Kalau dicek, stok tidak akan pernah
--    kembali untuk akun yang terkunci, yang justru merugikan vendor itu
--    lebih jauh.
-- ----------------------------------------------------------------
create or replace function restore_sale_item_stock_for_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
begin
  select business_id, status into v_booking from bookings where id = p_booking_id for update;

  if v_booking is null then
    raise exception 'restore_sale_item_stock_for_booking: transaksi tidak ditemukan';
  end if;

  if not is_member_of(v_booking.business_id) then
    raise exception 'restore_sale_item_stock_for_booking: tidak berhak';
  end if;

  -- Review koordinator 16 Nov 2026 (serius): tanpa ini, member bisa
  -- memanggil RPC ini langsung (supabase-js) pada booking yang MASIH
  -- AKTIF -- stok bertambah padahal barangnya sudah dibawa pelanggan.
  -- Restore cuma sah untuk booking yang BENAR-BENAR sudah dibatalkan.
  if v_booking.status != 'dibatalkan' then
    raise exception 'restore_sale_item_stock_for_booking: transaksi belum dibatalkan';
  end if;

  perform 1 from sale_items where id in (
    select sale_item_id from booking_sale_items
    where booking_id = p_booking_id and stock_restored_at is null
  ) order by id for update;

  update sale_items si
  set stock = si.stock + bsi.quantity
  from booking_sale_items bsi
  where bsi.booking_id = p_booking_id
    and bsi.stock_restored_at is null
    and si.id = bsi.sale_item_id;

  update booking_sale_items
  set stock_restored_at = now()
  where booking_id = p_booking_id and stock_restored_at is null;
end;
$$;

revoke all on function restore_sale_item_stock_for_booking(uuid) from public, anon;
grant execute on function restore_sale_item_stock_for_booking(uuid) to authenticated;
