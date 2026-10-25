-- ============================================================
-- Migration 035 — Logo usaha (upload sekali, dipakai di Etalase Online,
-- og:image, dan Nota Sewa cetak)
-- ============================================================
-- Nullable, tanpa logo = tampilan sekarang di semua tempat (Etalase,
-- og:image, Nota Sewa) — tidak ada placeholder box yang muncul kalau
-- kosong. Diisi lewat Info Usaha (Kelola Usaha, owner-only).
--
-- RLS: TIDAK perlu policy baru. UPDATE businesses sudah owner-only
-- (policy "owner_update_own_business", migration 018, whole-row) dan
-- SELECT businesses sudah terbuka untuk semua anggota ("members_select_
-- own_business", migration 007) — keduanya otomatis cover kolom baru
-- ini tanpa perubahan. Diverifikasi live setelah migrasi (lihat catatan
-- kerja): UPDATE sebagai karyawan harus gagal, sebagai owner harus
-- sukses, SELECT langsung ke tabel businesses lewat anon key harus
-- gagal/kosong (logo_url cuma boleh terekspos lewat get_public_page()
-- di bawah, yang security definer).
alter table businesses
  add column if not exists logo_url text;

-- get_public_page() (migration 019/020, direplace lagi di migration 034
-- untuk tarif bertingkat): tambah logo_url, signature SAMA PERSIS (json).
-- security definer tetap jadi satu-satunya jalur anon membaca logo_url
-- (RLS businesses sendiri menutup akses langsung, sama seperti
-- business_name/address yang sudah lebih dulu lewat jalur ini). Grant
-- EXECUTE dari migration 020 seharusnya tetap berlaku karena fungsinya
-- tidak di-drop, cuma diganti isinya — WAJIB diverifikasi live lewat
-- curl tanpa login setelah migrasi ini (lihat catatan proyek soal
-- Supabase default privileges, jangan diasumsikan dari file migrasi saja).
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
  where pp.slug = p_slug
    and pp.published = true;

  return result;
end;
$$;
