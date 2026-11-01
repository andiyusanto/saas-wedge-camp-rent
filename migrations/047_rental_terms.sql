-- ============================================================
-- Migration 047 — Syarat & Ketentuan sewa milik rental
-- ============================================================
-- Keputusan Andi 31 Okt 2026 (research/etalase-online-ordering-plan-
-- 2026-10.md bagian 5, baru ditambahkan) — diadaptasi dari Bilbo (teks
-- bebas + centang wajib di checkout), dengan perbaikan: persetujuan
-- pelanggan disimpan sebagai BUKTI (pointer ke versi, bukan salinan teks
-- per pesanan — keputusan eksplisit Andi untuk menghemat ruang, beda
-- dari booking_request_items yang memang menyalin data item).
--
-- create_booking_request/get_public_page (keduanya terakhir disentuh
-- migration 044) dan get_booking_request_status (terakhir migration 046)
-- di-diff dari versi TERAKHIR masing-masing di file-file itu, bukan versi
-- originalnya — field lama tidak ada yang dihapus.

-- --------------------------------------------------------------
-- 1. rental_terms_versions — append-only, satu baris per PERUBAHAN teks
-- --------------------------------------------------------------
-- Tidak ada policy update/delete sama sekali (pola sama seperti
-- marketplace_consents, migration 032-an area) — satu-satunya jalur
-- tulis adalah RPC set_rental_terms di bawah (SECURITY DEFINER), yang
-- juga menegakkan "versi baru cuma dibuat kalau teks BENAR-BENAR
-- berubah" (dibandingkan ke versi current saja, bukan ke seluruh
-- histori — revert persis ke teks lama tetap dianggap versi baru,
-- sengaja sederhana).
create table if not exists rental_terms_versions (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  content     text not null check (char_length(content) <= 8000 and char_length(content) >= 1),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

alter table rental_terms_versions enable row level security;

drop policy if exists "owner_select_own_rental_terms_versions" on rental_terms_versions;
create policy "owner_select_own_rental_terms_versions"
  on rental_terms_versions for select
  using (is_owner_of(business_id));

-- --------------------------------------------------------------
-- 2. Pointer kolom — public_pages (versi berlaku) & booking_requests
--    (versi yang disetujui pelanggan saat pesan)
-- --------------------------------------------------------------
alter table public_pages
  add column if not exists current_terms_version_id uuid references rental_terms_versions(id);

alter table booking_requests
  add column if not exists terms_version_id uuid references rental_terms_versions(id),
  add column if not exists terms_accepted_at timestamptz;

-- --------------------------------------------------------------
-- 2b. Trigger — cegah public_pages menunjuk versi milik business LAIN
-- --------------------------------------------------------------
-- Review -c1: FK current_terms_version_id->rental_terms_versions(id) cuma
-- memastikan id-nya ADA, tidak memastikan baris itu MILIK business yang
-- sama. set_rental_terms() sendiri selalu benar (SECURITY DEFINER, isi
-- business_id dari parameter yang sudah dicek is_owner_of), tapi policy
-- update public_pages yang sudah ada (is_owner_of, migration 019) masih
-- izinkan owner UPDATE kolom ini langsung lewat client biasa (bukan cuma
-- lewat RPC) ke uuid ASAL VALID MANAPUN — termasuk versi syarat milik
-- business lain, yang kalau tidak dicegah akan membuat toko A menampilkan
-- (dan pelanggannya "menyetujui") teks Syarat & Ketentuan toko B.
create or replace function check_public_pages_terms_version_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.current_terms_version_id is not null and not exists (
    select 1 from rental_terms_versions rtv
    where rtv.id = new.current_terms_version_id
      and rtv.business_id = new.business_id
  ) then
    raise exception 'public_pages: current_terms_version_id harus menunjuk versi syarat milik business ini sendiri';
  end if;
  return new;
end;
$$;

drop trigger if exists public_pages_check_terms_version_ownership on public_pages;
create trigger public_pages_check_terms_version_ownership
  before insert or update on public_pages
  for each row
  execute function check_public_pages_terms_version_ownership();

-- --------------------------------------------------------------
-- 3. set_rental_terms — satu-satunya jalur tulis ke rental_terms_versions
-- --------------------------------------------------------------
-- Owner-only (is_owner_of, bukan is_member_of — pola sama seperti update
-- public_pages lainnya). TIDAK dicek business_is_writable() — mengedit
-- Syarat & Ketentuan bukan salah satu aksi yang dikunci read-only
-- (migration 044 cuma mengunci items/customers/bookings/booking_items +
-- undangan karyawan, pola yang sama berlaku di sini: pengaturan Etalase/
-- Pesanan Online lainnya juga tidak pernah dikunci).
--
-- p_content kosong/null berarti "hapus syarat" (current_terms_version_id
-- balik ke null) — TIDAK membuat baris versi baru buat ini, karena
-- "tidak ada syarat" bukan sebuah versi teks.
create or replace function set_rental_terms(p_business_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed text;
  current_content text;
  new_id uuid;
begin
  if not is_owner_of(p_business_id) then
    raise exception 'set_rental_terms: tidak berhak';
  end if;

  trimmed := nullif(trim(coalesce(p_content, '')), '');

  if trimmed is null then
    update public_pages set current_terms_version_id = null where business_id = p_business_id;
    return null;
  end if;

  if char_length(trimmed) > 8000 then
    raise exception 'set_rental_terms: maksimal 8000 karakter';
  end if;

  select rtv.content into current_content
  from public_pages pp
  join rental_terms_versions rtv on rtv.id = pp.current_terms_version_id
  where pp.business_id = p_business_id;

  -- Teks sama persis dengan versi current — tidak perlu baris baru.
  if current_content is not null and current_content = trimmed then
    return (select current_terms_version_id from public_pages where business_id = p_business_id);
  end if;

  insert into rental_terms_versions (business_id, content, created_by)
  values (p_business_id, trimmed, auth.uid())
  returning id into new_id;

  update public_pages set current_terms_version_id = new_id where business_id = p_business_id;

  if not found then
    raise exception 'set_rental_terms: business % belum punya baris public_pages (simpan Etalase Online dulu)', p_business_id;
  end if;

  return new_id;
end;
$$;

revoke all on function set_rental_terms(uuid, text) from public, anon;
grant execute on function set_rental_terms(uuid, text) to authenticated;

-- --------------------------------------------------------------
-- 4. create_booking_request — wajib setuju syarat kalau toko punya syarat
-- --------------------------------------------------------------
-- Tambah parameter p_terms_version_id UUID (default null) di AKHIR
-- daftar parameter (urutan parameter lain tidak berubah).
--
-- Review -c1: pendekatan boolean+lookup-server (draf awal) TERNYATA
-- TIDAK mencegah persetujuan basi — cuma MENDIAMKANNYA. Skenario: klien
-- buka form saat versi A berlaku, vendor simpan versi B, pelanggan
-- centang (setelah baca A) → server mencatatnya menyetujui B, yang
-- tidak pernah dia baca. Itu justru yang harus dicegah fitur ini — bukti
-- persetujuan jadi tidak valid. Diperbaiki: klien WAJIB mengirim id
-- versi yang dia lihat SAAT itu (dari get_public_page.terms_version_id,
-- bagian 5 di bawah) — server menolak kalau tidak sama persis dengan
-- current_terms_version_id SAAT INSERT (bukan saat form dibuka), bukan
-- cuma percaya boolean centang. Baru kalau sama, versi yang divalidasi
-- itu yang disimpan.
--
-- Signature lama (12 parameter, tanpa p_terms_version_id) DIHAPUS eksplisit
-- supaya tidak ada dua overload nyasar hidup berdampingan (satu yang
-- lupa ditutup aksesnya akan jadi jalan pintas melewati pengecekan
-- syarat ini).
drop function if exists create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb);

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
  p_items jsonb,
  p_terms_version_id uuid default null
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

  -- Review -c1 poin 5: defense in depth — business hanya-baca tidak
  -- boleh menerima pesanan online baru sama sekali ("Pesanan online
  -- baru: Mati"), independen dari apakah frontend sudah menyembunyikan
  -- tombolnya atau belum.
  if not business_is_writable(p_business_id) then
    raise exception 'create_booking_request: toko ini sedang tidak menerima pesanan baru';
  end if;

  -- Syarat & Ketentuan (migration 047) — kalau toko ini punya syarat
  -- aktif (current_terms_version_id not null), versi yang dikirim klien
  -- WAJIB SAMA PERSIS dengan versi current SAAT INSERT ini (bukan cuma
  -- boolean "sudah centang") — kalau beda (vendor sempat ubah syaratnya
  -- sesudah klien buka form, SEBELUM klien submit), tolak dengan pesan
  -- khusus supaya backend bisa menyuruh klien muat ulang teks terbaru &
  -- centang ulang, bukan diam-diam mencatat persetujuan ke versi yang
  -- tidak pernah mereka baca. Toko tanpa syarat (null) tidak terpengaruh
  -- sama sekali — tidak ada kewajiban baru buat vendor yang belum pernah
  -- isi syarat.
  if page.current_terms_version_id is not null
     and p_terms_version_id is distinct from page.current_terms_version_id then
    raise exception 'create_booking_request: syarat telah diperbarui';
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
    estimated_price, payment_method, dp_amount, expires_at,
    terms_version_id, terms_accepted_at
  ) values (
    p_business_id, p_customer_name, p_customer_phone, p_note, p_start_date, p_end_date,
    p_estimated_price, p_payment_method, p_dp_amount, p_expires_at,
    page.current_terms_version_id,
    case when page.current_terms_version_id is not null then now() else null end
  )
  returning id into new_id;

  insert into booking_request_items (booking_request_id, item_id, quantity)
  select new_id, (elem->>'item_id')::uuid, (elem->>'quantity')::int
  from jsonb_array_elements(p_items) as elem;

  return new_id;
end;
$$;

revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb, uuid) from public;
revoke all on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb, uuid) from authenticated;
grant execute on function create_booking_request(text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb, uuid) to anon;

-- --------------------------------------------------------------
-- 5. get_public_page — tambah teks syarat berlaku (kalau ada)
-- --------------------------------------------------------------
-- Tampil di Etalase TERLEPAS dari status Pesanan Online (keputusan
-- Andi) — makanya diambil di sini (get_public_page, selalu dipanggil
-- untuk katalog), bukan cuma di get_public_ordering_page.
create or replace function get_public_page(p_slug text)
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
    'business_name', b.name,
    'logo_url', b.logo_url,
    'description', pp.description,
    'address', pp.address,
    'regency_name', r.name,
    'operating_hours', pp.operating_hours,
    'public_phone', pp.public_phone,
    'writable', business_is_writable(pp.business_id),
    'terms_content', rtv.content,
    -- Tidak sensitif (cuma uuid internal) — dibutuhkan klien untuk
    -- dikirim balik persis sebagai p_terms_version_id saat submit, biar
    -- server bisa menolak kalau sudah tidak current lagi (lihat bagian 4).
    'terms_version_id', pp.current_terms_version_id,
    'items', (
      select coalesce(json_agg(
        json_build_object(
          'id', i.id,
          'name', i.name,
          'category', i.category,
          'price_per_day', i.price_per_day,
          'day2_rate', i.day2_rate,
          'day3_rate', i.day3_rate,
          'day4_rate', i.day4_rate,
          'day5_rate', i.day5_rate,
          'extra_day_rate', i.extra_day_rate,
          'image_url', i.image_url,
          'variant', i.variant,
          'size', i.size,
          'color', i.color
        )
        order by i.name
      ), '[]'::json)
      from items i
      where i.business_id = pp.business_id
        and i.deactivated_at is null
    )
  )
  into result
  from public_pages pp
  join businesses b on b.id = pp.business_id
  left join regencies r on r.id = pp.regency_id
  left join rental_terms_versions rtv on rtv.id = pp.current_terms_version_id
  where pp.slug = p_slug
    and pp.published = true;

  return result;
end;
$$;

grant execute on function get_public_page(text) to anon, authenticated;

-- --------------------------------------------------------------
-- 6. get_booking_request_status — tambah teks syarat yang DISETUJUI
-- --------------------------------------------------------------
-- Baca dari booking_requests.terms_version_id (versi yang disetujui SAAT
-- ITU, bisa beda dari current_terms_version_id toko kalau vendor sudah
-- ubah syaratnya lagi sesudahnya) — bukan dari public_pages, supaya
-- halaman status selalu menunjukkan persis apa yang pelanggan setujui
-- dulu, bukan versi terbaru yang mungkin sudah berbeda.
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
    'expires_at', br.expires_at,
    'business_name', b.name,
    'logo_url', b.logo_url,
    'public_phone', pp.public_phone,
    'slug', pp.slug,
    'confirmation_message', pp.confirmation_message,
    'accepted_terms_content', rtv.content,
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
  left join rental_terms_versions rtv on rtv.id = br.terms_version_id
  where br.confirmation_token = p_token;

  return result; -- null kalau token tidak ada — caller balikin 404
end;
$$;

revoke all on function get_booking_request_status(uuid) from public;
revoke all on function get_booking_request_status(uuid) from authenticated;
grant execute on function get_booking_request_status(uuid) to anon;

select pg_notify('pgrst', 'reload schema');

-- --------------------------------------------------------------
-- 7. Verifikasi keras — pastikan overload lama create_booking_request
--    (12 parameter, tanpa p_terms_version_id) benar-benar sudah tidak ada
-- --------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'create_booking_request'
      and pg_get_function_identity_arguments(oid) = 'text, uuid, text, text, text, date, date, numeric, text, numeric, timestamptz, jsonb'
  ) then
    raise exception 'migration 047: overload create_booking_request lama (12 parameter) masih ada — drop function di atas tidak menangkap signature yang sebenarnya live';
  end if;
end $$;
