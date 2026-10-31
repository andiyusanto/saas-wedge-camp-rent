-- ============================================================
-- Migration 037 — Pesanan Online dari Etalase (booking_requests)
-- ============================================================
-- Rencana lengkap & alasan desain: research/etalase-online-ordering-plan-2026-10.md
-- (bagian 2.2 kenapa tabel terpisah, bukan status baru di bookings; 2.8b
-- cara bayar & DP; keputusan Andi 31 Okt 2026). Review -c1 (31 Okt 2026,
-- dua ronde) — semua catatan ditindaklanjuti, ditandai di komentar.
--
-- booking_requests TIDAK PERNAH dibaca oleh usedUnitsOn()/
-- get_public_availability()/Kalender/KPI Riwayat — stok baru ditahan
-- setelah dikonfirmasi jadi baris bookings baru (ikut MyRental, bukan
-- Bilbo yang menahan stok sejak Pending). Lihat CLAUDE.md bagian 6/7.

-- --------------------------------------------------------------
-- 1. Cara bayar & DP di public_pages (2.8b)
-- --------------------------------------------------------------
alter table public_pages
  add column accept_online_orders boolean not null default false,
  add column confirmation_message text,
  add column pay_transfer_enabled boolean not null default false,
  add column bank_name text,
  add column bank_account_number text,
  add column bank_account_holder text,
  add column pay_qris_enabled boolean not null default false,
  add column qris_image_url text,
  add column pay_cash_enabled boolean not null default false,
  add column dp_mode text not null default 'none' check (dp_mode in ('none', 'percent', 'fixed')),
  add column dp_value numeric,
  add constraint dp_value_matches_mode check (
    (dp_mode = 'none' and dp_value is null) or
    (dp_mode = 'percent' and dp_value > 0 and dp_value <= 100) or
    (dp_mode = 'fixed' and dp_value > 0)
  ),
  -- Review -c1 ronde 2 #4: cegah URL phishing disimpan sebagai "QRIS
  -- resmi" — hanya terima path upload R2 milik app ini sendiri.
  add constraint qris_image_url_is_own_r2 check (
    qris_image_url is null or qris_image_url like 'https://image.sewalog.com/qris/%'
  );

-- Kolom bayar di atas TIDAK BOLEH pernah muncul di get_public_page()
-- (migration 019) — function itu tidak disentuh di sini, daftar
-- kolomnya hardcode dan tidak menyebut kolom baru ini. Satu-satunya
-- jalur baca info bayar publik adalah get_booking_request_status() di
-- bawah, dan HANYA menyertakan payment_snapshot kalau status =
-- 'dikonfirmasi'. WAJIB diverifikasi live via curl tanpa auth.

-- --------------------------------------------------------------
-- 2. Log perubahan info bayar — trigger otomatis, BUKAN insert klien
-- --------------------------------------------------------------
-- Review -c1 ronde 2 #3: insert dari klien bisa dilewatkan/dipalsukan.
-- Trigger AFTER UPDATE menulis baris log sendiri kalau salah satu kolom
-- bayar berubah — append-only dan tidak bergantung pada disiplin caller.
create table public_page_payment_changes (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id),
  changed_by      uuid,
  old_values      jsonb not null,
  new_values      jsonb not null,
  created_at      timestamptz not null default now()
);

alter table public_page_payment_changes enable row level security;

create policy "owner_select_own_payment_changes"
  on public_page_payment_changes for select
  using (is_owner_of(business_id));

-- Sengaja TIDAK ada policy insert/update/delete untuk klien manapun —
-- satu-satunya penulis adalah trigger function di bawah (security
-- definer, jalan dengan hak pemilik trigger, bukan hak pemanggil UPDATE).

create or replace function log_public_page_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    old.pay_transfer_enabled is distinct from new.pay_transfer_enabled or
    old.bank_name is distinct from new.bank_name or
    old.bank_account_number is distinct from new.bank_account_number or
    old.bank_account_holder is distinct from new.bank_account_holder or
    old.pay_qris_enabled is distinct from new.pay_qris_enabled or
    old.qris_image_url is distinct from new.qris_image_url or
    old.pay_cash_enabled is distinct from new.pay_cash_enabled or
    old.dp_mode is distinct from new.dp_mode or
    old.dp_value is distinct from new.dp_value
  ) then
    insert into public_page_payment_changes (business_id, changed_by, old_values, new_values)
    values (
      new.business_id,
      auth.uid(),
      jsonb_build_object(
        'pay_transfer_enabled', old.pay_transfer_enabled, 'bank_name', old.bank_name,
        'bank_account_number', old.bank_account_number, 'bank_account_holder', old.bank_account_holder,
        'pay_qris_enabled', old.pay_qris_enabled, 'qris_image_url', old.qris_image_url,
        'pay_cash_enabled', old.pay_cash_enabled, 'dp_mode', old.dp_mode, 'dp_value', old.dp_value
      ),
      jsonb_build_object(
        'pay_transfer_enabled', new.pay_transfer_enabled, 'bank_name', new.bank_name,
        'bank_account_number', new.bank_account_number, 'bank_account_holder', new.bank_account_holder,
        'pay_qris_enabled', new.pay_qris_enabled, 'qris_image_url', new.qris_image_url,
        'pay_cash_enabled', new.pay_cash_enabled, 'dp_mode', new.dp_mode, 'dp_value', new.dp_value
      )
    );
  end if;
  return new;
end;
$$;

create trigger public_pages_log_payment_change
  after update on public_pages
  for each row
  execute function log_public_page_payment_change();

-- --------------------------------------------------------------
-- 3. Shared secret untuk RPC publik (review -c1 ronde 2 #1, opsi a)
-- --------------------------------------------------------------
-- Tabel privat tanpa policy apa pun dan tanpa grant ke anon/authenticated
-- — RLS on tapi NOL policy berarti TIDAK ADA baris yang bisa dibaca lewat
-- PostgREST oleh siapa pun (termasuk authenticated), hanya bisa dibaca
-- dari DALAM function security definer yang bypass RLS. Secret-nya
-- sendiri disimpan di sini, diisi manual oleh Andi (atau lewat psql satu
-- kali) SETELAH migration ini jalan, lalu env backend BOOKING_REQUEST_SECRET
-- diisi nilai yang sama di Render. Backend mengirim secret ini sebagai
-- parameter RPC saat memanggil create_booking_request — jadi RPC publik
-- cuma bisa dipanggil lewat backend yang tahu secretnya, bukan langsung
-- dari browser pakai anon key.
create table private_config (
  key    text primary key,
  value  text not null
);

alter table private_config enable row level security;
-- TIDAK ADA policy sama sekali di sini — ini sengaja, bukan lupa.

revoke all on private_config from public, anon, authenticated;

-- --------------------------------------------------------------
-- 4. booking_requests + booking_request_items
-- --------------------------------------------------------------
create table booking_requests (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references businesses(id),
  status                text not null default 'menunggu' check (status in ('menunggu', 'dikonfirmasi', 'ditolak', 'kedaluwarsa')),
  confirmation_token    uuid not null default gen_random_uuid() unique,
  customer_name         text not null check (char_length(customer_name) between 1 and 100),
  customer_phone        text not null check (char_length(customer_phone) between 1 and 30),
  note                  text check (note is null or char_length(note) <= 500),
  start_date            date not null,
  end_date              date not null check (end_date >= start_date),
  estimated_price       numeric not null,
  payment_method        text check (payment_method in ('transfer', 'qris', 'cash')),
  dp_amount             numeric,
  -- Snapshot info bayar diisi OLEH confirm_booking_request() DARI
  -- public_pages terkini, bukan dari klien (review -c1 ronde 2 #2) —
  -- halaman status membaca snapshot ini, bukan public_pages langsung,
  -- supaya pesanan yang sudah dikonfirmasi tidak berubah diam-diam kalau
  -- rekening diganti setelahnya.
  payment_snapshot      jsonb,
  rejection_reason      text,
  converted_booking_id  uuid references bookings(id),
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null
);

create index booking_requests_business_status_idx on booking_requests (business_id, status);

-- Review -c1 ronde 4 #1: satu booking tidak boleh dipakai mengonfirmasi
-- dua booking_requests berbeda.
create unique index booking_requests_converted_booking_unique_idx
  on booking_requests (converted_booking_id)
  where converted_booking_id is not null;

create table booking_request_items (
  id                    uuid primary key default gen_random_uuid(),
  booking_request_id    uuid not null references booking_requests(id),
  item_id               uuid not null references items(id),
  quantity              int not null check (quantity > 0 and quantity <= 20)
);

create index booking_request_items_request_idx on booking_request_items (booking_request_id);

alter table booking_requests enable row level security;
alter table booking_request_items enable row level security;

create policy "members_select_own_booking_requests"
  on booking_requests for select
  using (is_member_of(business_id));

create policy "members_select_own_booking_request_items"
  on booking_request_items for select
  using (is_member_of((select business_id from booking_requests where id = booking_request_id)));

-- Review -c1 ronde 2 #2: TIDAK ADA policy update/insert/delete untuk
-- klien manapun di kedua tabel ini. Insert publik lewat
-- create_booking_request() (security definer, dipanggil backend dengan
-- secret). Status hanya berubah lewat confirm_booking_request()/
-- reject_booking_request() (security definer, is_member_of di dalamnya)
-- — klien tidak bisa mengubah kolom apa pun langsung, termasuk
-- payment_snapshot/converted_booking_id/estimated_price, karena fungsi
-- itu sendiri yang menentukan nilainya, bukan menerima dari parameter
-- bebas klien.

-- --------------------------------------------------------------
-- 5. create_booking_request — insert publik, defense in depth penuh
-- --------------------------------------------------------------
-- Review -c1 ronde 2 #1: secret WAJIB cocok, dan SEMUA validasi di bawah
-- tetap dijalankan di dalam function meskipun backend juga sudah
-- memvalidasi sebelum memanggil (defense in depth — function ini adalah
-- lapis pertahanan TERAKHIR terhadap secret yang somehow bocor/dipakai
-- ulang di luar jalur backend yang semestinya).
create or replace function create_booking_request(
  p_secret text,
  p_business_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_start_date date,
  p_end_date date,
  p_estimated_price numeric,
  p_payment_method text,
  p_dp_amount numeric,
  p_expires_at timestamptz,
  p_items jsonb -- [{"item_id": "...", "quantity": n}, ...]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_secret text;
  page record;
  new_id uuid;
  total_qty int;
  bad_item_count int;
  today_wib date;
begin
  select value into expected_secret from private_config where key = 'booking_request_secret';
  if expected_secret is null or p_secret is distinct from expected_secret then
    raise exception 'create_booking_request: secret tidak valid';
  end if;

  select * into page from public_pages where business_id = p_business_id;
  if page is null or page.published is not true or page.accept_online_orders is not true then
    raise exception 'create_booking_request: etalase/pesanan online tidak aktif untuk business ini';
  end if;

  if p_payment_method is null or (
    (p_payment_method = 'transfer' and page.pay_transfer_enabled is not true) or
    (p_payment_method = 'qris' and page.pay_qris_enabled is not true) or
    (p_payment_method = 'cash' and page.pay_cash_enabled is not true)
  ) then
    raise exception 'create_booking_request: cara bayar tidak diaktifkan vendor ini';
  end if;

  today_wib := (now() + interval '7 hours')::date;
  if p_start_date < today_wib then
    raise exception 'create_booking_request: tanggal ambil sudah lewat';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '7 days' then
    raise exception 'create_booking_request: expires_at di luar rentang wajar';
  end if;

  if char_length(p_customer_name) < 1 or char_length(p_customer_name) > 100
     or char_length(p_customer_phone) < 1 or char_length(p_customer_phone) > 30
     or (p_note is not null and char_length(p_note) > 500) then
    raise exception 'create_booking_request: panjang field tidak valid';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'create_booking_request: minimal satu alat';
  end if;

  select coalesce(sum((elem->>'quantity')::int), 0) into total_qty
  from jsonb_array_elements(p_items) as elem;
  if total_qty < 1 or total_qty > 20 then
    raise exception 'create_booking_request: total jumlah alat di luar batas (1-20)';
  end if;

  select count(*) into bad_item_count
  from jsonb_array_elements(p_items) as elem
  where not exists (
    select 1 from items i
    where i.id = (elem->>'item_id')::uuid
      and i.business_id = p_business_id
      and i.deactivated_at is null
  ) or (elem->>'quantity')::int < 1 or (elem->>'quantity')::int > 20;
  if bad_item_count > 0 then
    raise exception 'create_booking_request: ada alat tidak valid/tidak aktif/qty di luar batas';
  end if;

  insert into booking_requests (
    business_id, customer_name, customer_phone, note, start_date, end_date,
    estimated_price, payment_method, dp_amount, expires_at
  ) values (
    p_business_id, p_customer_name, p_customer_phone, p_note, p_start_date, p_end_date,
    p_estimated_price, p_payment_method, p_dp_amount, p_expires_at
  )
  returning id into new_id;

  insert into booking_request_items (booking_request_id, item_id, quantity)
  select new_id, (elem->>'item_id')::uuid, (elem->>'quantity')::int
  from jsonb_array_elements(p_items) as elem;

  return new_id;
end;
$$;

-- Grant ke anon (bukan authenticated) — tapi secret di dalam function
-- adalah syarat wajib, bukan grant saja, jadi memanggil anon key tanpa
-- tahu secret akan selalu exception di baris pertama. Ini sengaja beda
-- dari pola reset_demo_bookings (authenticated-only) karena pelanggan
-- publik tidak login sama sekali.
revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb) from public;
revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb) from authenticated;
grant execute on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb) to anon;

-- --------------------------------------------------------------
-- 6. confirm_booking_request / reject_booking_request — SATU-SATUNYA
--    jalur ubah status, security definer, payment_snapshot diisi DI
--    DALAM function dari public_pages terkini (review -c1 ronde 2 #2)
-- --------------------------------------------------------------
-- Review -c1 ronde 3 #1 [PENTING]: confirm_booking_request SEBELUMNYA
-- bisa dipanggil tanpa booking apa pun dibuat — status jadi
-- 'dikonfirmasi', pelanggan lihat rekening & bisa bayar, tapi stok tidak
-- pernah ditahan (celah: "dikonfirmasi" tidak otomatis berarti stok
-- aman). Diperbaiki: function ini sekarang WAJIB diberi p_booking_id
-- yang SUDAH ADA (dibuat dulu oleh vendor lewat alur Catat
-- Transaksi/POST /bookings yang sudah validasi stok sendiri), dan
-- mengisi status+payment_snapshot+converted_booking_id dalam SATU
-- UPDATE conditional — jadi "dikonfirmasi" di tabel ini SELALU berarti
-- booking sungguhan dengan stok yang sudah ditahan sudah ada.
-- link_converted_booking() dihapus — tidak diperlukan lagi.
--
-- Review -c1 ronde 3 #2: kondisi update juga mensyaratkan
-- `expires_at > now()` — pesanan yang sudah lewat kedaluwarsa (lazy,
-- belum di-flip ke status 'kedaluwarsa' oleh proses apa pun) tidak bisa
-- dikonfirmasi maupun ditolak lagi, cukup 'menunggu' yang belum lewat.
--
-- Review -c1 ronde 3 #3: payment_snapshot cuma menyertakan field cara
-- bayar yang BENAR-BENAR aktif saat itu (bank_* hanya kalau
-- pay_transfer_enabled, qris_image_url hanya kalau pay_qris_enabled),
-- plus dp_amount_computed (dibulatkan ke ribuan terdekat dari
-- estimated_price pesanan ini) — supaya halaman status publik tinggal
-- menampilkan angka, tidak menghitung ulang dp_mode/dp_value sendiri.
create or replace function confirm_booking_request(p_booking_request_id uuid, p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  page record;
  final_booking record;
  dp_amount_computed numeric := 0;
  snapshot jsonb;
  updated_count int;
begin
  select * into req from booking_requests where id = p_booking_request_id;
  if req is null or not is_member_of(req.business_id) then
    raise exception 'confirm_booking_request: pesanan tidak ditemukan atau tidak berhak';
  end if;

  select * into final_booking from bookings where id = p_booking_id and business_id = req.business_id;
  if final_booking is null then
    raise exception 'confirm_booking_request: booking belum dibuat atau bukan milik business yang sama — buat transaksi lewat Catat Transaksi dulu sebelum konfirmasi';
  end if;

  select * into page from public_pages where business_id = req.business_id;

  -- Review -c1 ronde 4 #2: DP dihitung dari bookings.total_price (harga
  -- FINAL yang vendor simpan lewat Catat Transaksi, bisa beda dari
  -- estimated_price yang pelanggan lihat saat submit), bukan dari
  -- estimasi — supaya DP yang ditagihkan cocok dengan transaksi
  -- sungguhan, bukan perkiraan awal yang mungkin sudah usang.
  if page.dp_mode = 'percent' then
    dp_amount_computed := round(final_booking.total_price * page.dp_value / 100 / 1000) * 1000;
  elsif page.dp_mode = 'fixed' then
    dp_amount_computed := page.dp_value;
  end if;

  snapshot := jsonb_build_object(
    'dp_mode', page.dp_mode,
    'dp_amount_computed', dp_amount_computed,
    'total_final', final_booking.total_price
  );
  if page.pay_transfer_enabled then
    snapshot := snapshot || jsonb_build_object(
      'bank_name', page.bank_name, 'bank_account_number', page.bank_account_number,
      'bank_account_holder', page.bank_account_holder
    );
  end if;
  if page.pay_qris_enabled then
    snapshot := snapshot || jsonb_build_object('qris_image_url', page.qris_image_url);
  end if;
  snapshot := snapshot || jsonb_build_object('pay_cash_enabled', page.pay_cash_enabled, 'confirmed_at', now());

  -- Conditional update (race-safe, review -c1 bagian 2.13): cuma
  -- berhasil kalau status masih 'menunggu' DAN belum kedaluwarsa saat
  -- ini, mencegah dua staff konfirmasi bersamaan dari keduanya
  -- "berhasil", dan mencegah konfirmasi pesanan yang sudah lewat batas.
  update booking_requests
  set status = 'dikonfirmasi',
      payment_snapshot = snapshot,
      converted_booking_id = p_booking_id
  where id = p_booking_request_id and status = 'menunggu' and expires_at > now();

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'confirm_booking_request: pesanan ini sudah diproses atau sudah kedaluwarsa';
  end if;
end;
$$;

create or replace function reject_booking_request(p_booking_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  updated_count int;
begin
  select * into req from booking_requests where id = p_booking_request_id;
  if req is null or not is_member_of(req.business_id) then
    raise exception 'reject_booking_request: pesanan tidak ditemukan atau tidak berhak';
  end if;

  update booking_requests
  set status = 'ditolak', rejection_reason = p_reason
  where id = p_booking_request_id and status = 'menunggu' and expires_at > now();

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'reject_booking_request: pesanan ini sudah diproses atau sudah kedaluwarsa';
  end if;
end;
$$;

revoke all on function confirm_booking_request(uuid, uuid) from public, anon;
grant execute on function confirm_booking_request(uuid, uuid) to authenticated;
revoke all on function reject_booking_request(uuid, text) from public, anon;
grant execute on function reject_booking_request(uuid, text) to authenticated;

-- --------------------------------------------------------------
-- 7. get_booking_request_status — baca publik via token
-- --------------------------------------------------------------
-- Review -c1 ronde 3 #2: status 'kedaluwarsa' ditampilkan secara LAZY di
-- sini (dihitung di SELECT, tidak menulis apa pun ke tabel — function
-- ini 'stable', harus tetap read-only) kalau status tersimpan masih
-- 'menunggu' tapi expires_at sudah lewat. Baris di tabel sendiri baru
-- benar-benar di-flip ke 'kedaluwarsa' oleh proses baca daftar vendor
-- (endpoint/tab "Pesanan Online" di backend, non-stable, pada tahap
-- implementasi) — pola lazy yang sama dengan expireStaleOrders() Bilbo
-- (rencana 1.3/2.6), cuma dipecah jadi "tampilkan lazy di sini" vs
-- "tulis lazy di endpoint lain" supaya function publik ini tetap aman
-- dipanggil berulang tanpa efek samping.
create or replace function get_booking_request_status(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result json;
begin
  select json_build_object(
    'status', case when br.status = 'menunggu' and br.expires_at <= now() then 'kedaluwarsa' else br.status end,
    'customer_name', br.customer_name,
    'start_date', br.start_date,
    'end_date', br.end_date,
    'estimated_price', br.estimated_price,
    'payment_method', br.payment_method,
    'dp_amount', br.dp_amount,
    'rejection_reason', br.rejection_reason,
    'business_name', b.name,
    'confirmation_message', pp.confirmation_message,
    'payment_snapshot', case when br.status = 'dikonfirmasi' then br.payment_snapshot else null end,
    'items', (
      select coalesce(json_agg(
        json_build_object('name', i.name, 'quantity', bri.quantity)
      ), '[]'::json)
      from booking_request_items bri
      join items i on i.id = bri.item_id
      where bri.booking_request_id = br.id
    )
  )
  into result
  from booking_requests br
  join businesses b on b.id = br.business_id
  left join public_pages pp on pp.business_id = br.business_id
  where br.confirmation_token = p_token;

  return result; -- null kalau token tidak ada — caller balikin 404
end;
$$;

revoke all on function get_booking_request_status(uuid) from public;
revoke all on function get_booking_request_status(uuid) from authenticated;
grant execute on function get_booking_request_status(uuid) to anon;

-- --------------------------------------------------------------
-- 8. Upload QRIS: nama file acak per upload, folder qris/ terpisah dari
--    items/, divalidasi tipe/ukuran — diterapkan di kode upload backend
--    (lib/r2.ts dipakai lagi) pada tahap implementasi, bukan di sini.
--    Constraint qris_image_url_is_own_r2 di atas memaksa hasil upload
--    itu memang harus lewat R2 app ini sendiri.
-- --------------------------------------------------------------

-- --------------------------------------------------------------
-- 9. reset_demo_bookings (migration 036) diperluas: ikut membersihkan
--    booking_request_items/booking_requests milik business demo.
-- --------------------------------------------------------------
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

-- --------------------------------------------------------------
-- 10. pg_notify reload schema — PostgREST cache functions/kolom baru
-- --------------------------------------------------------------
select pg_notify('pgrst', 'reload schema');
