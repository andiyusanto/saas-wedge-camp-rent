-- ============================================================
-- Migration 078 — Bulk-apply harga paket ke alat (Skema Sewa Kamu)
-- research/brief-pilih-skema-sewa-2026-12.md, 24 Nov 2026
-- ============================================================
-- DRAFT -- kirim untuk review koordinator SEBELUM dijalankan Andi.
--
-- Brief ini SENGAJA "tanpa migration" untuk kartu Skema Sewa (semua
-- field businesses sudah ada), TAPI "Terapkan harga paket ke semua
-- alat" menulis BANYAK baris `items` sekaligus -- koreksi koordinator
-- poin 6 eksplisit minta ini atomik (satu RPC/batch), supaya kalau ada
-- yang gagal tidak diam-diam setengah jadi. Plain REST (banyak
-- `.update()` terpisah lewat supabase-js) tidak bisa menjamin itu, jadi
-- SATU RPC baru ini adalah pengecualian migration yang dijelaskan,
-- bukan pelanggaran "tanpa migration".
create or replace function apply_package_pricing_to_items(
  p_business_id uuid,
  p_updates jsonb -- [{item_id, price_per_day, day2_rate, day3_rate, day4_rate, day5_rate, extra_day_rate}]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count int;
  distinct_count int;
  updated_count int;
  invalid_count int;
begin
  if not is_member_of(p_business_id) then
    raise exception 'apply_package_pricing_to_items: tidak berhak';
  end if;
  if not business_is_writable(p_business_id) then
    raise exception 'apply_package_pricing_to_items: akun hanya-baca';
  end if;

  select count(*) into expected_count from jsonb_array_elements(p_updates);
  if expected_count = 0 then
    return;
  end if;

  -- Item_id duplikat di payload (koreksi koordinator poin 1) -- tanpa
  -- cek ini, duplikat akhirnya tetap ketahuan lewat selisih
  -- expected_count vs updated_count di bawah, TAPI pesannya menyesatkan
  -- ("tidak ditemukan/nonaktif") padahal akar masalahnya beda sama
  -- sekali -- dicek terpisah di sini supaya pesan error selalu akurat.
  select count(distinct x.item_id) into distinct_count
    from jsonb_to_recordset(p_updates) as x(item_id uuid);
  if distinct_count <> expected_count then
    raise exception 'apply_package_pricing_to_items: ada item_id ganda di payload -- tidak ada yang disimpan';
  end if;

  -- Validasi nilai (defense in depth, poin 2 -- RPC bisa dipanggil
  -- langsung tanpa lewat UI yang sudah memvalidasi): price_per_day
  -- wajib ada dan > 0 (harga paket tidak masuk akal nol/negatif),
  -- tarif lain boleh null (diwarisi tingkat sebelumnya, pola existing)
  -- tapi kalau diisi tidak boleh negatif.
  select count(*) into invalid_count
    from jsonb_to_recordset(p_updates) as x(
      price_per_day numeric, day2_rate numeric, day3_rate numeric,
      day4_rate numeric, day5_rate numeric, extra_day_rate numeric
    )
    where x.price_per_day is null or x.price_per_day <= 0
       or coalesce(x.day2_rate, 0) < 0
       or coalesce(x.day3_rate, 0) < 0
       or coalesce(x.day4_rate, 0) < 0
       or coalesce(x.day5_rate, 0) < 0
       or coalesce(x.extra_day_rate, 0) < 0;
  if invalid_count > 0 then
    raise exception 'apply_package_pricing_to_items: % baris punya nilai harga tidak valid (price_per_day wajib > 0, tarif lain tidak boleh negatif) -- tidak ada yang disimpan', invalid_count;
  end if;

  -- Satu UPDATE/FROM = satu pernyataan SQL = atomik (semua baris
  -- berubah atau tidak sama sekali kalau ada error di tengah). Item
  -- yang bukan milik business ini atau sudah dinonaktifkan TIDAK
  -- match (where klausa), terhitung lewat RETURNING di bawah --
  -- dibandingkan terhadap expected_count supaya kegagalan SEBAGIAN
  -- (bukan konstrain SQL, tapi "item ini ternyata tidak valid") tetap
  -- membuat SELURUH transaksi batal, bukan diam-diam setengah jadi.
  with upd as (
    update items i set
      price_per_day = x.price_per_day,
      day2_rate = x.day2_rate,
      day3_rate = x.day3_rate,
      day4_rate = x.day4_rate,
      day5_rate = x.day5_rate,
      extra_day_rate = x.extra_day_rate
    from jsonb_to_recordset(p_updates) as x(
      item_id uuid, price_per_day numeric, day2_rate numeric, day3_rate numeric,
      day4_rate numeric, day5_rate numeric, extra_day_rate numeric
    )
    where i.id = x.item_id and i.business_id = p_business_id and i.deactivated_at is null
    returning i.id
  )
  select count(*) into updated_count from upd;

  if updated_count <> expected_count then
    raise exception 'apply_package_pricing_to_items: % dari % alat gagal diperbarui (tidak ditemukan, bukan milik usaha ini, atau sudah nonaktif) -- tidak ada yang disimpan',
      (expected_count - updated_count), expected_count;
  end if;
end;
$$;

revoke all on function apply_package_pricing_to_items(uuid, jsonb) from public, anon;
grant execute on function apply_package_pricing_to_items(uuid, jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
