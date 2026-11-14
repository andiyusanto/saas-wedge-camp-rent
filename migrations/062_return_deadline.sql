-- ============================================================
-- Migration 062 -- Batas jam kembali tetap
-- ============================================================
-- Brief disetujui Andi 14 Nov 2026: research/brief-batas-jam-kembali-2026-11.md
-- (wawancara TikTok+IG, pola terbanyak kedua setelah cara hitung hari:
-- "maks 22.00", "maks 24.00", "sesuai jam tutup", "besoknya maks 12
-- siang"). Pengaturan per rental di Kelola Usaha, dekat Toleransi telat:
-- null (default) = ikuti jam ambil, PERSIS perilaku sebelum fitur ini
-- ada. Diisi -> due = end_date (+1 hari kalau opsi "hari berikutnya")
-- pada jam itu, di zona rental (businesses.timezone, migration 053).
-- Toleransi telat (jam) TETAP berlaku di atas due ini TANPA PERUBAHAN
-- (lib/penalty.ts: computeLateBlocks/computeLateFee/computeTieredLateFee
-- SAMA SEKALI tidak disentuh -- cuma titik awal `dueAt` yang bergeser).
--
-- Definisi 00:00/24:00 (disetujui koordinator -c1): "00:00" SELALU
-- dibaca sebagai end_date+1 pukul 00:00, TERLEPAS dari nilai
-- return_deadline_next_day yang tersimpan -- tidak pernah dobel-tambah
-- jadi +2. "24:00" tidak pernah disimpan literal -- frontend
-- menormalkannya jadi "00:00" + mengunci toggle "hari berikutnya"
-- (tercentang, disabled) sebelum dikirim, satu representasi kanonik.
-- Lihat computeDueAt() di backend/src/lib/penalty.ts untuk penegakan.

alter table businesses add column if not exists return_deadline_time text;
alter table businesses drop constraint if exists businesses_return_deadline_time_format;
alter table businesses add constraint businesses_return_deadline_time_format
  check (return_deadline_time is null or return_deadline_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table businesses add column if not exists return_deadline_next_day boolean not null default false;

-- Snapshot (pola persis rental_day_mode migration 049 / min_rental_days
-- migration 054) -- diisi dari businesses.return_deadline_time/
-- return_deadline_next_day SAAT POST /bookings, supaya transaksi yang
-- sudah dibuat tidak pernah ikut berubah kalau vendor ganti pengaturan
-- ini belakangan. null = ikuti jam ambil (baris lama DAN booking baru
-- dari business yang belum mengisi pengaturan ini -- tidak berubah).
alter table bookings add column if not exists return_deadline_time text;
alter table bookings add column if not exists return_deadline_next_day boolean;

-- --------------------------------------------------------------
-- get_public_page -- tambah 2 field, field lain + grant TIDAK berubah
-- --------------------------------------------------------------
-- Review -c1 poin 3: dipanggil ANON (halaman Etalase publik) -- field
-- lama dipertahankan PERSIS sama seperti migration 053, cuma menambah
-- return_deadline_time/return_deadline_next_day dari businesses (live
-- setting, bukan snapshot -- ini halaman publik vendor, bukan transaksi
-- spesifik, jadi kebijakan UMUM yang relevan).
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
    'district_name', d.name,
    'timezone', b.timezone,
    'operating_hours', pp.operating_hours,
    'public_phone', pp.public_phone,
    'writable', business_is_writable(pp.business_id),
    'terms_content', rtv.content,
    'terms_version_id', pp.current_terms_version_id,
    'return_deadline_time', b.return_deadline_time,
    'return_deadline_next_day', b.return_deadline_next_day,
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
  left join districts d on d.id = pp.district_id
  left join rental_terms_versions rtv on rtv.id = pp.current_terms_version_id
  where pp.slug = p_slug
    and pp.published = true;

  return result;
end;
$$;

grant execute on function get_public_page(text) to anon, authenticated;

-- --------------------------------------------------------------
-- get_booking_request_status -- tambah 2 field, field lain + grant
-- TIDAK berubah
-- --------------------------------------------------------------
-- Review -c1 poin 3: juga dipanggil ANON (halaman status pesanan
-- pelanggan). booking_requests BELUM jadi transaksi (belum ada snapshot
-- untuk ditampilkan) -- pakai businesses.return_deadline_time/
-- return_deadline_next_day LIVE, sama seperti get_public_page.
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
    'order_code', upper(left(br.id::text, 6)),
    'customer_name', br.customer_name,
    'start_date', br.start_date,
    'end_date', br.end_date,
    'estimated_price', br.estimated_price,
    'payment_method', br.payment_method,
    'dp_amount', br.dp_amount,
    'rejection_reason', br.rejection_reason,
    'expires_at', br.expires_at,
    'business_name', b.name,
    'timezone', b.timezone,
    'logo_url', b.logo_url,
    'public_phone', pp.public_phone,
    'slug', pp.slug,
    'order_admin_phone_1', coalesce(pp.order_admin_phone_1, pp.public_phone),
    'order_admin_phone_2', pp.order_admin_phone_2,
    'order_admin_phone_3', pp.order_admin_phone_3,
    'confirmation_message', pp.confirmation_message,
    'accepted_terms_content', rtv.content,
    'payment_snapshot', case when br.status = 'dikonfirmasi' then br.payment_snapshot else null end,
    'return_deadline_time', b.return_deadline_time,
    'return_deadline_next_day', b.return_deadline_next_day,
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
