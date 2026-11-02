-- ============================================================
-- Migration 049 — Cara hitung durasi sewa jadi pengaturan per rental
-- ============================================================
-- Keputusan Andi 2 Nov 2026 (knowladge/marketing-plan-2026-q4.md bagian
-- 9, baris "2 Nov") — menggantikan keputusan 31 Okt "tidak diubah".
-- "Per malam" (ambil Sabtu, kembali Minggu = 1 hari) jadi DEFAULT untuk
-- SEMUA rental (lama & baru), bukan cuma pilihan — banyak rental
-- (Tunggul, Bilbo) sudah pakai skema ini, dan skema lama (hari kalender
-- inklusif) tidak konsisten dengan batas telat yang sudah 24 jam dari
-- jam ambil.

-- --------------------------------------------------------------
-- 1. businesses.rental_day_mode — setting LIVE, owner-only ubah
-- --------------------------------------------------------------
-- RLS: tidak perlu policy baru — "owner_update_own_business" (migration
-- 018) sudah row-level, otomatis mencakup kolom baru ini. Semua member
-- tetap bisa SELECT (policy select businesses sudah ada sejak awal).
alter table businesses
  add column if not exists rental_day_mode text not null default 'per_malam'
    constraint rental_day_mode_valid check (rental_day_mode in ('per_malam', 'per_hari_kalender'));

-- --------------------------------------------------------------
-- 2. bookings.rental_day_mode — SNAPSHOT saat transaksi dibuat
-- --------------------------------------------------------------
-- NULLABLE sengaja — baris lama (sebelum migration ini) tidak pernah
-- diisi ulang (null = "dibuat sebelum fitur ini ada"), ditafsirkan app
-- sebagai 'per_hari_kalender' (perilaku lama, PERSIS seperti sebelum
-- ada pengaturan ini — transaksi lama tidak pernah dihitung ulang).
-- Transaksi BARU selalu diisi eksplisit oleh backend (POST /bookings)
-- dari businesses.rental_day_mode SAAT ITU — begitu vendor ganti
-- pengaturannya nanti, transaksi yang sudah dibuat sebelumnya tidak
-- ikut berubah (nota, struk WA, denda telat tetap pakai mode yang
-- berlaku waktu transaksi itu dibuat).
alter table bookings
  add column if not exists rental_day_mode text
    constraint bookings_rental_day_mode_valid check (rental_day_mode is null or rental_day_mode in ('per_malam', 'per_hari_kalender'));

-- --------------------------------------------------------------
-- 3. get_public_ordering_page — expose rental_day_mode
-- --------------------------------------------------------------
-- Form Pesanan Online (etalase.ts client script) butuh tahu mode ini
-- untuk: (a) batas minimum tanggal kembali (ambil+1 hari kalau per
-- malam), (b) hitung perkiraan harga yang SAMA PERSIS dengan yang akan
-- dihitung ulang server (bookingRequests.ts) saat submit.
--
-- Diffed dari migration 048 (versi terakhir) — nambah join ke
-- businesses (sebelumnya cuma baca public_pages), field lain tidak
-- berubah.
create or replace function get_public_ordering_page(p_slug text)
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
    'business_id', pp.business_id,
    'pay_transfer_enabled', pp.pay_transfer_enabled,
    'pay_qris_enabled', pp.pay_qris_enabled,
    'pay_cash_enabled', pp.pay_cash_enabled,
    'confirmation_deadline_hours', pp.confirmation_deadline_hours,
    'writable', business_is_writable(pp.business_id),
    'terms_content', rtv.content,
    'terms_version_id', pp.current_terms_version_id,
    'rental_day_mode', b.rental_day_mode
  )
  into result
  from public_pages pp
  join businesses b on b.id = pp.business_id
  left join rental_terms_versions rtv on rtv.id = pp.current_terms_version_id
  where pp.slug = p_slug
    and pp.published = true
    and pp.accept_online_orders = true;

  return result;
end;
$$;

revoke all on function get_public_ordering_page(text) from public, authenticated;
grant execute on function get_public_ordering_page(text) to anon;

-- --------------------------------------------------------------
-- 4. create_booking_request — tolak ambil=kembali hari sama kalau per_malam
-- --------------------------------------------------------------
-- Defense in depth, pola sama seperti validasi lain di fungsi ini —
-- backend (bookingRequests.ts) akan menolak lebih dulu dengan pesan
-- ramah, ini jaring pengaman server-side kalau ada jalur lain yang
-- memanggil RPC ini langsung. Diffed dari migration 047 (versi
-- terakhir) — satu blok IF baru ditambahkan, tidak ada yang dihapus.
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
  biz record;
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

  -- Cara hitung durasi sewa (migration 049) — kalau per malam, ambil dan
  -- kembali tidak boleh di hari yang sama (sama seperti Bilbo). Defense
  -- in depth — backend (bookingRequests.ts) menolak lebih dulu dengan
  -- pesan ramah, ini jaring pengaman server-side.
  select * into biz from businesses where id = p_business_id;
  if biz.rental_day_mode = 'per_malam' and p_start_date = p_end_date then
    raise exception 'create_booking_request: ambil dan kembali tidak boleh di hari yang sama';
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

select pg_notify('pgrst', 'reload schema');
