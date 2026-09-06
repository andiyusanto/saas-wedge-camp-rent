-- ============================================================
-- Migration 020 — Pencarian ketersediaan per tanggal di Etalase Online
-- ============================================================
-- KEPUTUSAN PRODUK YANG SENGAJA MEMBALIK ATURAN migration 019: halaman
-- publik Etalase Online tadinya EKSPLISIT tidak boleh menampilkan data
-- stok ("JANGAN tampilkan kalender ketersediaan real-time atau data stok
-- detail... cukup 'Hubungi kami untuk cek ketersediaan' ke WA" — lihat
-- CLAUDE.md bagian 6 & prompt asli fitur ini). User secara eksplisit
-- diberi tiga opsi (tanpa cek sama sekali / status kasar tersedia-
-- terbatas-penuh / jumlah unit tersisa persis) dan MEMILIH opsi paling
-- terbuka: jumlah unit tersisa persis per tanggal, publik, tanpa login.
-- Ini pembalikan sadar dari sikap "total_units selalu privat" — bukan
-- longgar tanpa disadari. Kalau nanti ingin ditarik lagi jadi status
-- kasar/tanpa exposure, migration ini yang perlu di-drop/diganti.
--
-- Tetap SATU-SATUNYA jalur baca publik lewat SECURITY DEFINER function
-- (pola sama seperti get_public_page, migration 019) — bukan RLS
-- tambahan di items/booking_items/bookings, dan bukan query langsung
-- lewat anon client (lihat larangan di komentar createAnonClient(),
-- backend/src/lib/supabaseClient.ts).
create or replace function get_public_availability(p_slug text, p_date date)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result json;
  v_business_id uuid;
begin
  select pp.business_id into v_business_id
  from public_pages pp
  where pp.slug = p_slug
    and pp.published = true;

  if v_business_id is null then
    return null;
  end if;

  -- Logika blokir SAMA PERSIS dengan usedUnitsOn() (backend/src/lib/
  -- availability.ts): 'aktif' blokir tanpa batas end_date (barang belum
  -- pasti kembali), 'dipesan'/'telat' blokir cuma sampai end_date-nya
  -- (no-show / booking yang sudah ditutup tidak mengunci stok
  -- selamanya). 'selesai' dan 'dibatalkan' sengaja tidak masuk sama
  -- sekali. Kalau usedUnitsOn() berubah, ubah juga query ini.
  select coalesce(json_agg(
    json_build_object(
      'id', i.id,
      'total_units', i.total_units,
      'remaining', i.total_units - coalesce(used.qty, 0)
    )
    order by i.name
  ), '[]'::json)
  into result
  from items i
  left join (
    select bi.item_id, sum(bi.quantity) as qty
    from booking_items bi
    join bookings b on b.id = bi.booking_id
    where b.business_id = v_business_id
      and b.start_date <= p_date
      and (
        b.status = 'aktif'
        or (b.status in ('dipesan', 'telat') and b.end_date >= p_date)
      )
    group by bi.item_id
  ) used on used.item_id = i.id
  where i.business_id = v_business_id
    and i.deactivated_at is null;

  return result;
end;
$$;

grant execute on function get_public_availability(text, date) to anon, authenticated;

-- get_public_page (migration 019) perlu menyertakan `id` per item supaya
-- frontend bisa mencocokkan hasil get_public_availability() ke kartu alat
-- yang benar tanpa bergantung ke urutan array (keduanya kebetulan
-- order by i.name yang sama, tapi mencocokkan by id jauh lebih aman kalau
-- ada nama alat yang kembar).
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
