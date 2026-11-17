-- Lebih dari satu rekening bank untuk Pesanan Online (brief 17 Nov 2026,
-- research/brief-multi-rekening-bank-2026-11.md). DRAFT revisi 2 --
-- belum dijalankan, menunggu "siap dijalankan" dari koordinator.

-- =====================================================================
-- 1. public_pages.bank_accounts jsonb -- array [{bank_name,
--    account_number, account_holder}], maks 5, elemen pertama = utama.
--    Kolom lama (bank_name/bank_account_number/bank_account_holder,
--    migration 037) TIDAK di-drop -- disinkronkan DUA ARAH dari/ke
--    elemen pertama lewat trigger (bagian 2) -- revisi koordinator:
--    frontend LAMA yang masih terbuka di HP vendor selama jeda deploy
--    cuma menulis 3 kolom lama, jadi sinkronnya harus dua arah, bukan
--    cuma array->kolom lama seperti draf pertama (yang akan menimpa
--    editan vendor lewat UI lama secara diam-diam). Drop kolom lama
--    ditunda ke migration terpisah SETELAH kode baru confirmed live.
-- =====================================================================
alter table public_pages add column if not exists bank_accounts jsonb;

-- Validasi TIPE+PANJANG di DB (generic, murah, berlaku untuk SEMUA
-- caller termasuk supabase-js langsung) -- validasi ISI tiap field di
-- Express/UI (pesan error ramah, pola sale_items/bundles: RPC/
-- constraint cuma defense-in-depth murah, bukan tempat utama pesan
-- error). ALTER TABLE ADD CONSTRAINT tidak mendukung IF NOT EXISTS --
-- idempotensi lewat drop if exists sebelum add ulang, pola migration 068.
alter table public_pages drop constraint if exists bank_accounts_is_array;
alter table public_pages add constraint bank_accounts_is_array check (
  bank_accounts is null or (jsonb_typeof(bank_accounts) = 'array' and jsonb_array_length(bank_accounts) <= 5)
);

-- Backfill -- revisi koordinator: minimal bank_account_number terisi
-- (bukan wajib ketiga kolom lengkap seperti draf pertama) -- field lain
-- yang kosong jadi '' (bukan dilewati) supaya SEMUA business dengan
-- pay_transfer_enabled=true dan data historis apa adanya tetap dapat
-- SATU baris bank_accounts yang valid secara bentuk (lolos constraint
-- array di atas), biar constraint "minimal 1 rekening" di bagian 3
-- punya sesuatu untuk divalidasi, TANPA mematikan pay_transfer_enabled
-- vendor diam-diam. `bank_accounts is null` sebagai guard idempotensi.
update public_pages
set bank_accounts = jsonb_build_array(
  jsonb_build_object(
    'bank_name', coalesce(bank_name, ''),
    'account_number', bank_account_number,
    'account_holder', coalesce(bank_account_holder, '')
  )
)
where bank_accounts is null and bank_account_number is not null;

-- "Transfer Bank aktif wajib minimal 1 rekening" -- revisi koordinator:
-- ditambahkan sebagai NOT VALID supaya HANYA berlaku untuk tulisan BARU
-- ke baris ini ke depannya -- ADD CONSTRAINT NOT VALID tidak memvalidasi
-- baris existing sama sekali (migration tidak pernah bisa gagal karena
-- data lama, apa pun kondisinya), beda dari draf pertama yang
-- bergantung pada pengecekan manual lebih dulu. Baris lama yang masih
-- melanggar (pay_transfer_enabled=true tapi bank_accounts kosong --
-- SEHARUSNYA tidak ada lagi setelah backfill di atas, KECUALI
-- bank_account_number-nya sendiri null) TIDAK disentuh/dimatikan diam-
-- diam -- query di bawah ini untuk Andi cek manual setelah migration:
--
--   select business_id, slug, bank_name, bank_account_number
--   from public_pages
--   where pay_transfer_enabled is true
--     and (bank_accounts is null or jsonb_array_length(bank_accounts) < 1);
--
alter table public_pages drop constraint if exists pay_transfer_requires_accounts;
alter table public_pages add constraint pay_transfer_requires_accounts check (
  pay_transfer_enabled is not true or (bank_accounts is not null and jsonb_array_length(bank_accounts) >= 1)
) not valid;

-- =====================================================================
-- 2. Sinkronisasi DUA ARAH kolom lama <-> elemen PERTAMA bank_accounts
--    (trigger, BUKAN kode aplikasi) -- revisi koordinator poin 2:
--    - UPDATE yang mengubah bank_accounts (kode BARU) -> cermin ke 3
--      kolom lama dari elemen pertama, SAMA seperti draf pertama.
--    - UPDATE yang mengubah salah satu dari 3 kolom lama TAPI TIDAK
--      mengubah bank_accounts (kode LAMA/frontend belum update) ->
--      elemen PERTAMA bank_accounts diperbarui dari kolom lama (array
--      dibuat kalau belum ada), SISA elemen (index 1..4) DIBIARKAN UTUH
--      lewat jsonb_set -- supaya rekening ke-2..5 yang sudah diisi
--      lewat UI baru tidak hilang diam-diam kalau vendor sempat buka
--      tab lama di tengah masa transisi.
--    - INSERT: array_changed kalau bank_accounts diisi langsung,
--      selain itu treated sebagai legacy_changed kalau salah satu
--      kolom lama diisi (tidak ada OLD untuk dibandingkan).
--    - log_public_page_payment_change() (bagian 3) tetap AFTER UPDATE
--      (TIDAK diubah timing-nya, sudah begitu sejak migration 037) --
--      BEFORE trigger ini SELALU selesai memutakhirkan NEW sebelum
--      AFTER trigger membaca NEW, jadi urutan sudah otomatis benar
--      tanpa perlu penamaan khusus (revisi koordinator poin 3 --
--      dicek ulang dari source, log TIDAK pernah BEFORE).
-- =====================================================================
create or replace function sync_bank_accounts_legacy_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  array_changed boolean;
  legacy_changed boolean;
begin
  if tg_op = 'INSERT' then
    array_changed := new.bank_accounts is not null;
    legacy_changed := not array_changed
      and (new.bank_name is not null or new.bank_account_number is not null or new.bank_account_holder is not null);
  else
    array_changed := new.bank_accounts is distinct from old.bank_accounts;
    legacy_changed := not array_changed and (
      new.bank_name is distinct from old.bank_name or
      new.bank_account_number is distinct from old.bank_account_number or
      new.bank_account_holder is distinct from old.bank_account_holder
    );
  end if;

  if array_changed then
    if new.bank_accounts is not null and jsonb_array_length(new.bank_accounts) > 0 then
      new.bank_name := new.bank_accounts->0->>'bank_name';
      new.bank_account_number := new.bank_accounts->0->>'account_number';
      new.bank_account_holder := new.bank_accounts->0->>'account_holder';
    else
      new.bank_name := null;
      new.bank_account_number := null;
      new.bank_account_holder := null;
    end if;
  elsif legacy_changed then
    if coalesce(jsonb_array_length(new.bank_accounts), 0) = 0 then
      new.bank_accounts := jsonb_build_array(jsonb_build_object(
        'bank_name', coalesce(new.bank_name, ''),
        'account_number', coalesce(new.bank_account_number, ''),
        'account_holder', coalesce(new.bank_account_holder, '')
      ));
    else
      new.bank_accounts := jsonb_set(new.bank_accounts, '{0}', jsonb_build_object(
        'bank_name', coalesce(new.bank_name, ''),
        'account_number', coalesce(new.bank_account_number, ''),
        'account_holder', coalesce(new.bank_account_holder, '')
      ));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists public_pages_sync_bank_accounts_legacy on public_pages;
create trigger public_pages_sync_bank_accounts_legacy
  before insert or update on public_pages
  for each row
  execute function sync_bank_accounts_legacy_columns();

-- =====================================================================
-- 3. Log perubahan (public_page_payment_changes, migration 037) --
--    tambah bank_accounts ke kondisi deteksi perubahan DAN ke payload
--    old/new -- satu baris jsonb array mencakup tambah/ubah/hapus/
--    urutan berubah DAN kasus "ditulis lewat kolom lama" (poin 2 di
--    atas, karena trigger sync BEFORE sudah menulis new.bank_accounts
--    final sebelum trigger AFTER ini membaca old/new -- old.bank_accounts
--    tetap nilai SEBELUM baris ini diupdate, jadi diff-nya tetap benar).
-- =====================================================================
create or replace function log_public_page_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    old.pay_transfer_enabled is distinct from new.pay_transfer_enabled or
    old.bank_accounts is distinct from new.bank_accounts or
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
        'pay_transfer_enabled', old.pay_transfer_enabled, 'bank_accounts', old.bank_accounts,
        'pay_qris_enabled', old.pay_qris_enabled, 'qris_image_url', old.qris_image_url,
        'pay_cash_enabled', old.pay_cash_enabled, 'dp_mode', old.dp_mode, 'dp_value', old.dp_value
      ),
      jsonb_build_object(
        'pay_transfer_enabled', new.pay_transfer_enabled, 'bank_accounts', new.bank_accounts,
        'pay_qris_enabled', new.pay_qris_enabled, 'qris_image_url', new.qris_image_url,
        'pay_cash_enabled', new.pay_cash_enabled, 'dp_mode', new.dp_mode, 'dp_value', new.dp_value
      )
    );
  end if;
  return new;
end;
$$;
-- Trigger public_pages_log_payment_change (migration 037, AFTER UPDATE
-- -- TIDAK diubah timing-nya) sudah memanggil fungsi ini, create or
-- replace function saja sudah cukup mengganti isinya.

-- =====================================================================
-- 4. confirm_booking_request -- snapshot SEKARANG berisi 'bank_accounts'
--    (array), bukan 3 field flat, kalau transfer aktif. Signature TIDAK
--    berubah. Snapshot LAMA yang SUDAH TERSIMPAN (flat, dari SEBELUM
--    migration ini) TIDAK disentuh/ditulis ulang -- dibekukan selamanya
--    (pola price_at_booking) -- frontend (routes/etalase.ts) WAJIB
--    menangani KEDUA bentuk snapshot untuk kompatibilitas tampilan
--    mundur.
-- =====================================================================
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
  accounts jsonb;
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
    accounts := coalesce(
      page.bank_accounts,
      case when page.bank_name is not null then
        jsonb_build_array(jsonb_build_object('bank_name', page.bank_name, 'account_number', page.bank_account_number, 'account_holder', page.bank_account_holder))
      else '[]'::jsonb end
    );
    -- Revisi koordinator (jeda deploy): sertakan JUGA key lama flat
    -- (bank_name/bank_account_number/bank_account_holder, dari elemen
    -- PERTAMA accounts) di SAMPING bank_accounts -- backend LAMA yang
    -- mungkin masih live sesaat setelah migration 069 dijalankan (kode
    -- barunya belum ikut ter-deploy) membaca snap.bank_name/
    -- snap.bank_account_number buat tampilkan rekening ke pelanggan;
    -- tanpa key lama ini, pesanan yang dikonfirmasi tepat di jeda itu
    -- akan tampil tanpa rekening sama sekali di backend lama. Frontend
    -- BARU (routes/etalase.ts setelah diupdate) memprioritaskan
    -- bank_accounts, key flat ini cuma fallback kompatibilitas mundur.
    snapshot := snapshot || jsonb_build_object(
      'bank_accounts', accounts,
      'bank_name', accounts->0->>'bank_name',
      'bank_account_number', accounts->0->>'account_number',
      'bank_account_holder', accounts->0->>'account_holder'
    );
  end if;
  if page.pay_qris_enabled then
    snapshot := snapshot || jsonb_build_object('qris_image_url', page.qris_image_url);
  end if;
  snapshot := snapshot || jsonb_build_object('pay_cash_enabled', page.pay_cash_enabled, 'confirmed_at', now());

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

-- get_booking_request_status() (migration 037) TIDAK PERLU diubah sama
-- sekali -- cuma mengembalikan br.payment_snapshot verbatim, apa pun
-- bentuknya. get_public_page() (migration 019) JUGA TIDAK disentuh --
-- tidak pernah menyertakan kolom rekening sama sekali.
