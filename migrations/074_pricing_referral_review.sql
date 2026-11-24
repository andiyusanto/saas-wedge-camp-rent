-- ============================================================
-- Migration 074 — 3 tingkat harga + Ajak Rental Lain (referral) +
-- Ulasan Pengguna
-- ============================================================
-- Brief: research/brief-langganan-harga-referral-ulasan-2026-12.md,
-- disetujui Andi 24 Nov 2026 (termasuk keputusan final Pendiri->
-- Perkenalan Opsi B, lihat komentar bagian A). Migration ini HANYA
-- dijalankan Andi setelah koordinator bilang "siap dijalankan" -- belum
-- dijalankan sampai pesan ini dikirim.

-- ================================================================
-- A. Tiga tingkat harga -- REUSE mekanisme Pendiri (migration 060)
-- ================================================================
-- Kolom founder_override/founder_price_until (migration 060) SUDAH
-- PERSIS cocok untuk "Pendiri" di skema baru -- TIDAK diganti nama kolom
-- (hindari migrasi data + breaking existing admin tooling), cuma makna
-- tanggal cutoff & harga yang berubah (murni di subscriptionConfig.ts,
-- lihat bagian frontend di bawah, TIDAK butuh migration). founder_override
-- JUGA dipakai utuh sebagai flag "ikut wawancara" (brief: "flag yang bisa
-- Andi isi manual") -- set_founder_override() sudah persis fungsi itu,
-- TIDAK perlu kolom/RPC baru.
--
-- Keputusan Andi (final, via koordinator 24 Nov 2026) soal Pendiri ->
-- Perkenalan, OPSI B: setelah 12 bulan harga Pendiri (39rb/390rb),
-- Pendiri membayar 49rb/490rb SELAMANYA selama langgangannya TIDAK
-- PERNAH putus. "Putus" = melewati masa tenggang (active_until + 7,
-- business_is_writable()) tanpa pembayaran -- sekali putus, kunci 49rb
-- hilang; kalau berlangganan lagi, harga = tingkat yang berlaku SAAT
-- comeback itu (Perkenalan kalau period_start comeback <= 31 Des 2027
-- dengan kunci 12 bulan BARU dari comeback, selain itu langsung Normal).
--
-- Disimpan sebagai DATA (bukan dihitung ulang dari tanggal tiap kali) --
-- kolom boolean `perkenalan_locked_forever`, diubah HANYA oleh
-- record_subscription_payment() di titik-titik yang jelas (lihat logika
-- di bawah), bisa dikoreksi manual oleh admin lewat RPC
-- set_perkenalan_locked_forever() (dianalogikan dari
-- set_founder_price_until()) kalau perlu audit/koreksi.
alter table subscriptions add column if not exists perkenalan_price_until date;
alter table subscriptions add column if not exists perkenalan_locked_forever boolean not null default false;

create or replace function set_perkenalan_locked_forever(p_business_id uuid, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_app_admin() then
    raise exception 'set_perkenalan_locked_forever: tidak berhak';
  end if;
  if not exists (select 1 from subscriptions where business_id = p_business_id) then
    raise exception 'set_perkenalan_locked_forever: business % belum punya baris subscriptions', p_business_id;
  end if;
  update subscriptions set perkenalan_locked_forever = p_locked, updated_at = now() where business_id = p_business_id;
end;
$$;

revoke all on function set_perkenalan_locked_forever(uuid, boolean) from public, anon;
grant execute on function set_perkenalan_locked_forever(uuid, boolean) to authenticated;

-- record_subscription_payment() di-create-or-replace ulang -- logika
-- period math (period_start/new_active_until inklusif) TIDAK diubah
-- sama sekali, cuma menambah blok harga (Pendiri->Perkenalan->Normal,
-- Opsi B di atas) + pemanggilan bonus referral (bagian B di bawah).
create or replace function record_subscription_payment(
  p_business_id uuid,
  p_amount numeric,
  p_period_days int,
  p_method text,
  p_note text,
  p_proof_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_email text;
  current_active_until date;
  new_active_until date;
  period_start_date date;
  today_wib date;
  sub_row subscriptions;
  biz_created_at timestamptz;
  is_founder_now boolean;
  v_broke boolean; -- 'putus': pembayaran ini terjadi SETELAH masa tenggang lewat
begin
  if not is_app_admin() then
    raise exception 'record_subscription_payment: tidak berhak';
  end if;

  if p_period_days < 1 or p_period_days > 400 then
    raise exception 'record_subscription_payment: p_period_days di luar rentang wajar (1-400)';
  end if;
  if p_amount < 0 then
    raise exception 'record_subscription_payment: p_amount tidak boleh negatif';
  end if;

  select lower(auth.jwt() ->> 'email') into admin_email;

  -- FOR UPDATE -- review koordinator poin 3: kunci baris business ini
  -- untuk seluruh durasi transaksi, supaya dua panggilan paralel untuk
  -- business YANG SAMA tidak bisa keduanya melihat "ini pembayaran
  -- pertama" sebelum salah satunya commit (mencegah bonus referral
  -- dobel kalau admin somehow mencatat 2x hampir bersamaan).
  select * into sub_row from subscriptions where business_id = p_business_id for update;
  if sub_row is null then
    raise exception 'record_subscription_payment: business % belum punya baris subscriptions', p_business_id;
  end if;
  current_active_until := sub_row.active_until;
  today_wib := (now() at time zone 'Asia/Jakarta')::date;

  -- Sama persis ambang business_is_writable() (migration 044/045) --
  -- "putus" artinya pembayaran ini datang SETELAH tenggang 7 hari lewat
  -- (bukan sekadar telat beberapa hari dalam tenggang, yang masih
  -- dianggap kontinu).
  v_broke := today_wib > current_active_until + 7;

  period_start_date := greatest(current_active_until + 1, today_wib);
  new_active_until := period_start_date + p_period_days - 1;

  insert into subscription_payments (
    business_id, amount, period_start, period_end, method, recorded_by_email, note, proof_url
  ) values (
    p_business_id, p_amount, period_start_date, new_active_until, p_method, coalesce(admin_email, 'unknown'), p_note, p_proof_url
  );

  -- founder_price_until (Pendiri) -- TIDAK DIUBAH dari migration 060
  -- (masa Pendiri 39rb itu sendiri tidak terpengaruh oleh putus --
  -- brief cuma bicara soal kunci 49rb hilang kalau putus, bukan status
  -- Pendiri; kasus putus DI TENGAH masa Pendiri yang lalu balik lagi
  -- masih di dalam window-nya sendiri adalah edge case langka yang
  -- sengaja tidak ditangani khusus di sini).
  if sub_row.founder_price_until is null then
    select created_at into biz_created_at from businesses where id = p_business_id;
    is_founder_now := coalesce(sub_row.founder_override, biz_created_at < timestamptz '2027-01-01 00:00:00+07');
    -- NOTE: literal cutoff di sini HARUS disamakan dengan FOUNDER_CUTOFF_ISO
    -- (subscriptionConfig.ts) kalau tanggalnya diubah.
    if is_founder_now then
      update subscriptions
      set founder_price_until = (period_start_date + interval '12 months' - interval '1 day')::date
      where business_id = p_business_id;
      sub_row.founder_price_until := (period_start_date + interval '12 months' - interval '1 day')::date;
    end if;
  end if;

  -- Putus -> kunci 49-selamanya HILANG, dan perkenalan_price_until
  -- di-RESET (null) supaya pembayaran comeback ini dihitung sebagai
  -- "masuk lagi" ke Perkenalan dari TANGGAL COMEBACK (bukan jendela
  -- lama yang sudah tidak relevan) -- lihat blok Perkenalan di bawah.
  if v_broke and sub_row.perkenalan_locked_forever then
    update subscriptions set perkenalan_locked_forever = false, perkenalan_price_until = null
    where business_id = p_business_id;
    sub_row.perkenalan_locked_forever := false;
    sub_row.perkenalan_price_until := null;
  end if;

  -- Pendiri -> 49rb SELAMANYA (Opsi B): begitu period_start pembayaran
  -- ini sudah lewat founder_price_until DAN pembayaran ini KONTINU
  -- (tidak putus sejak pembayaran sebelumnya), kunci 49 selamanya.
  -- Sekali true, baris ini tidak dieksekusi lagi (guard `not
  -- perkenalan_locked_forever`) -- makanya aman dipanggil di tiap
  -- pembayaran berikutnya tanpa efek tambahan.
  --
  -- Review koordinator [BUG]: `perkenalan_price_until is null` WAJIB
  -- jadi syarat tambahan di sini -- tanpa ini, Pendiri yang PUTUS lalu
  -- comeback (blok di atas me-reset perkenalan_price_until jadi null
  -- DAN mengisinya lagi di blok Perkenalan di bawah pada pembayaran
  -- comeback itu SENDIRI) akan langsung dikunci 49-selamanya LAGI pada
  -- pembayaran BERIKUTNYA (yang kontinu) -- padahal mereka seharusnya
  -- masih di jendela Perkenalan 12 bulan dulu, baru Normal setelahnya.
  -- Pendiri yang TIDAK PERNAH putus tidak pernah mengisi
  -- perkenalan_price_until sama sekali (blok Perkenalan di bawah
  -- menjaminnya via guard founder_price_until-nya sendiri), jadi syarat
  -- ini aman membedakan "belum pernah putus" vs "baru saja comeback".
  if not v_broke
     and sub_row.founder_price_until is not null
     and period_start_date > sub_row.founder_price_until
     and sub_row.perkenalan_price_until is null
     and not sub_row.perkenalan_locked_forever then
    update subscriptions set perkenalan_locked_forever = true where business_id = p_business_id;
    sub_row.perkenalan_locked_forever := true;
  end if;

  -- Perkenalan (49rb, terkunci 12 bulan dari period_start) -- buat yang
  -- BUKAN sedang/baru dikunci 49-selamanya (non-Pendiri DARI AWAL, atau
  -- Pendiri yang baru saja putus dan comeback), BUKAN sedang di dalam
  -- window Pendiri aktif, kolomnya masih kosong, dan period_start <=
  -- 31 Des 2027 (batas eligibility Perkenalan, brief bagian A).
  if sub_row.perkenalan_price_until is null
     and not sub_row.perkenalan_locked_forever
     and (sub_row.founder_price_until is null or period_start_date > sub_row.founder_price_until)
     and period_start_date <= date '2027-12-31' then
    update subscriptions
    set perkenalan_price_until = (period_start_date + interval '12 months' - interval '1 day')::date
    where business_id = p_business_id;
  end if;

  -- ================================================================
  -- B. Referral -- +30 hari OTOMATIS untuk business yang diajak, saat
  -- pembayaran PERTAMA mereka berhasil (sub_row dibaca SEBELUM baris
  -- subscriptions di-update, jadi current_active_until di atas adalah
  -- status SEBELUM pembayaran ini -- "pembayaran pertama" diartikan
  -- tidak ada baris subscription_payments LAIN untuk business ini
  -- SEBELUM insert barusan, dicek lewat count = 1 SETELAH insert).
  -- ================================================================
  if (select count(*) from subscription_payments where business_id = p_business_id) = 1 then
    new_active_until := apply_referral_signup_bonus(p_business_id, new_active_until);
  end if;

  update subscriptions
  set active_until = new_active_until, updated_at = now()
  where business_id = p_business_id;
end;
$$;

revoke all on function record_subscription_payment(uuid, numeric, int, text, text, text) from public, anon;
grant execute on function record_subscription_payment(uuid, numeric, int, text, text, text) to authenticated;

-- admin_list_businesses -- tambah perkenalan_price_until/
-- perkenalan_locked_forever (pola sama migration 060 menambah
-- founder_override/founder_price_until) -- Alat Admin (AdminPaymentModal.tsx)
-- butuh kedua kolom ini untuk menghitung tingkat harga yang BENAR
-- (resolvePriceTier()) saat menyarankan nominal "Catat Pembayaran" --
-- tanpa ini, saran nominal untuk business yang sedang di tingkat
-- Perkenalan akan salah dihitung sebagai Pendiri/Normal. Logika
-- pencarian/dedupe/status LAMA tidak diubah sama sekali. DROP dulu --
-- Postgres menolak `create or replace` yang mengubah daftar kolom
-- return table.
drop function if exists admin_list_businesses(text);
create or replace function admin_list_businesses(p_query text default null)
returns table (
  business_id       uuid,
  name               text,
  owner_email        text,
  active_until       date,
  plan               text,
  status             text,
  signed_up_at       timestamptz,
  founder_override   boolean,
  founder_price_until date,
  perkenalan_price_until date,
  perkenalan_locked_forever boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_app_admin() then
    raise exception 'admin_list_businesses: tidak berhak';
  end if;

  return query
  select inner_q.id, inner_q.name, inner_q.owner_email, inner_q.active_until, inner_q.plan, inner_q.status, inner_q.signed_up_at,
         inner_q.founder_override, inner_q.founder_price_until, inner_q.perkenalan_price_until, inner_q.perkenalan_locked_forever
  from (
    select distinct on (b.id)
      b.id,
      b.name,
      u.email::text as owner_email,
      s.active_until,
      s.plan,
      case
        when s.active_until is null then 'aktif'
        when (now() at time zone 'Asia/Jakarta')::date <= s.active_until then 'aktif'
        when (now() at time zone 'Asia/Jakarta')::date <= (s.active_until + 7) then 'tenggang'
        else 'hanya-baca'
      end as status,
      b.created_at as signed_up_at,
      s.founder_override,
      s.founder_price_until,
      s.perkenalan_price_until,
      s.perkenalan_locked_forever
    from businesses b
    join business_members bm on bm.business_id = b.id and bm.role = 'owner'
    join auth.users u on u.id = bm.user_id
    left join subscriptions s on s.business_id = b.id
    where p_query is null or p_query = ''
      or b.name ilike '%' || p_query || '%'
      or u.email ilike '%' || p_query || '%'
    order by b.id, bm.created_at asc
  ) inner_q
  order by inner_q.signed_up_at desc
  limit 50;
end;
$$;

revoke all on function admin_list_businesses(text) from public, anon, authenticated;
grant execute on function admin_list_businesses(text) to authenticated;

-- ================================================================
-- B. Ajak Rental Lain (referral)
-- ================================================================

-- Kode ajakan unik per business -- dari nama (huruf/angka saja, upper,
-- dipotong 5 karakter) + 3 karakter acak dari alfabet TANPA huruf/angka
-- mirip (O/0/I/1/L dibuang, brief eksplisit). case-insensitive secara
-- PENYIMPANAN (selalu disimpan uppercase, dibandingkan via upper() di
-- validasi) -- unique index di kolom apa adanya (sudah uppercase).
alter table businesses add column if not exists referral_code text;
create unique index if not exists businesses_referral_code_unique_idx on businesses (referral_code);

create or replace function generate_referral_code(p_business_name text)
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- tanpa O/0/I/1/L
  base text;
  suffix text;
  candidate text;
  attempt int := 0;
begin
  base := upper(regexp_replace(p_business_name, '[^a-zA-Z0-9]', '', 'g'));
  base := left(base, 5);
  if base = '' then base := 'SEWA'; end if;

  loop
    suffix := '';
    for i in 1..3 loop
      suffix := suffix || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    candidate := base || suffix;
    exit when not exists (select 1 from businesses where referral_code = candidate);
    attempt := attempt + 1;
    if attempt > 20 then
      -- Jaring pengaman -- seharusnya tidak pernah tercapai (ruang kode
      -- besar), tapi jangan infinite loop kalau somehow selalu tabrakan.
      candidate := base || suffix || floor(random() * 9999)::text;
      exit;
    end if;
  end loop;

  return candidate;
end;
$$;

-- Trigger: business baru otomatis dapat kode SAAT INSERT (bukan lazy),
-- backfill terpisah di bawah untuk business lama.
create or replace function set_referral_code_for_new_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.referral_code is null then
    new.referral_code := generate_referral_code(new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_set_referral_code on businesses;
create trigger businesses_set_referral_code
  before insert on businesses
  for each row
  execute function set_referral_code_for_new_business();

-- Backfill business lama yang belum punya kode (idempotent -- cuma
-- mengisi yang NULL, aman dijalankan ulang).
do $$
declare
  r record;
begin
  for r in select id, name from businesses where referral_code is null loop
    update businesses set referral_code = generate_referral_code(r.name) where id = r.id;
  end loop;
end $$;

alter table businesses alter column referral_code set not null;

-- Tabel ajakan -- SATU baris per business yang diajak (bukan per
-- kode/klik), dibuat SAAT business baru itu mendaftar dengan kode valid
-- (lewat register_referral_signup() di bawah, dipanggil authenticated
-- dari frontend OnboardingScreen.tsx SETELAH insert businesses+
-- business_members selesai, BUKAN trigger insert businesses -- business
-- pendaftar butuh sudah punya owner_id sebelum validasi anti-diri-
-- sendiri bisa jalan, dan auth.uid() dipakai di dalam fungsi untuk
-- menentukan business-nya sendiri, lihat komentar fungsinya).
create table if not exists referrals (
  id                    uuid primary key default gen_random_uuid(),
  referrer_business_id  uuid not null references businesses(id),
  referred_business_id  uuid not null references businesses(id) unique, -- satu business cuma bisa diajak SEKALI (brief)
  code_used             text not null,
  status                text not null default 'terdaftar'
                          check (status in ('terdaftar', 'siap_diklaim', 'diklaim', 'melewati_batas')),
  first_payment_at      timestamptz,
  bonus_year            int, -- tahun kalender WIB saat status jadi siap_diklaim (buat hitung batas 10/tahun)
  claimed_at            timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists referrals_referrer_idx on referrals (referrer_business_id);

alter table referrals enable row level security;

-- TIDAK ADA policy insert/update/delete untuk klien manapun -- satu-
-- satunya jalur tulis adalah register_referral_signup()/
-- apply_referral_signup_bonus()/claim_referral_bonus() (security
-- definer). SELECT dibatasi lewat RPC list_my_referrals() (bukan query
-- tabel langsung) supaya kolom yang diexpose soal business yang diajak
-- bisa dibatasi ke NAMA SAJA (brief: "data minimal") -- policy SELECT
-- di sini TETAP ada sebagai lapis kedua (defense in depth, is_owner_of
-- pengajak), tapi frontend selalu lewat RPC, tidak query tabel ini
-- langsung.
drop policy if exists "owner_select_own_referrals" on referrals;
create policy "owner_select_own_referrals"
  on referrals for select
  using (is_owner_of(referrer_business_id));

revoke all on referrals from anon;

-- register_referral_signup -- dipanggil (authenticated, lewat supabase-js
-- client biasa milik user yang baru saja daftar) SETELAH business+owner
-- baru selesai dibuat, dengan kode yang diisi user. Review koordinator
-- poin 2: business "yang diajak" diambil dari auth.uid() (OWNER business
-- si pemanggil sendiri lewat business_members), BUKAN dari parameter --
-- mencegah pemanggil mendaftarkan business LAIN (mis. business lama milik
-- orang lain) sebagai "diajak". Syarat tambahan (cegah kode ditambah
-- belakangan ke business lama): business dibuat < 24 jam lalu, belum
-- punya baris subscription_payments, dan belum pernah punya baris
-- referrals (referred). TIDAK melempar error kalau kode invalid/anti-
-- abuse gagal -- brief: "Kode salah TIDAK menghalangi daftar" -- cukup
-- return boolean, caller (frontend OnboardingScreen.tsx) mengabaikan
-- hasil false secara diam-diam (business tetap berhasil dibuat).
create or replace function register_referral_signup(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  new_business_id uuid;
  new_business_created_at timestamptz;
  referrer_id uuid;
  referrer_owner_email text;
  new_owner_email text;
  referrer_owner_phone text;
  new_owner_phone text;
begin
  select bm.business_id, b.created_at into new_business_id, new_business_created_at
  from business_members bm
  join businesses b on b.id = bm.business_id
  where bm.user_id = auth.uid() and bm.role = 'owner'
  order by bm.created_at desc
  limit 1;

  if new_business_id is null then
    return false;
  end if;
  if new_business_created_at < now() - interval '24 hours' then
    return false; -- cuma untuk pendaftaran BARU, bukan ditambahkan belakangan
  end if;
  if exists (select 1 from subscription_payments where business_id = new_business_id) then
    return false; -- sudah pernah bayar -- bukan lagi "baru daftar"
  end if;
  if exists (select 1 from referrals where referred_business_id = new_business_id) then
    return false; -- sudah pernah diajak sebelumnya
  end if;

  select id into referrer_id from businesses where upper(referral_code) = upper(p_code);
  if referrer_id is null or referrer_id = new_business_id then
    return false;
  end if;

  -- Anti-diri-sendiri: cocokkan email (auth.users, bukan snapshot
  -- business_members.email yang bisa dipalsukan klien) DAN nomor WA
  -- (businesses.phone) owner kedua business.
  select u.email into referrer_owner_email
  from business_members bm join auth.users u on u.id = bm.user_id
  where bm.business_id = referrer_id and bm.role = 'owner' limit 1;
  select email into new_owner_email from auth.users where id = auth.uid();
  select phone into referrer_owner_phone from businesses where id = referrer_id;
  select phone into new_owner_phone from businesses where id = new_business_id;

  if lower(referrer_owner_email) = lower(new_owner_email) then
    return false;
  end if;
  if referrer_owner_phone is not null and referrer_owner_phone = new_owner_phone then
    return false;
  end if;

  insert into referrals (referrer_business_id, referred_business_id, code_used)
  values (referrer_id, new_business_id, upper(p_code));
  return true;
end;
$$;

revoke all on function register_referral_signup(text) from public, anon;
grant execute on function register_referral_signup(text) to authenticated;

-- apply_referral_signup_bonus -- dipanggil DARI DALAM
-- record_subscription_payment() (bagian A di atas), bukan dari klien.
-- Mengembalikan active_until BARU (input + 30 hari kalau business ini
-- hasil ajakan yang belum diproses, apa adanya kalau bukan), DAN efek
-- samping: status referrals -> siap_diklaim DENGAN cek batas 10/tahun
-- PENGAJAK (dihitung dari bonus_year, tahun kalender WIB SAAT INI) --
-- lewat batas -> status melewati_batas (tanpa bonus, tetap tercatat,
-- brief eksplisit).
create or replace function apply_referral_signup_bonus(p_referred_business_id uuid, p_new_active_until date)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_row referrals;
  claimable_count int;
  this_year int;
  result date;
begin
  select * into ref_row from referrals where referred_business_id = p_referred_business_id and status = 'terdaftar';
  if ref_row is null then
    return p_new_active_until; -- bukan business hasil ajakan, atau sudah diproses sebelumnya
  end if;

  this_year := extract(year from (now() at time zone 'Asia/Jakarta'));

  -- +30 hari OTOMATIS untuk yang DIAJAK -- selalu, tidak tergantung
  -- batas tahunan pengajak (batas 10/tahun itu buat BONUS PENGAJAK,
  -- bukan hadiah yang diajak).
  result := p_new_active_until + 30;

  select count(*) into claimable_count
  from referrals
  where referrer_business_id = ref_row.referrer_business_id
    and bonus_year = this_year
    and status in ('siap_diklaim', 'diklaim');

  if claimable_count >= 10 then
    update referrals
    set status = 'melewati_batas', first_payment_at = now(), bonus_year = this_year
    where id = ref_row.id;
  else
    update referrals
    set status = 'siap_diklaim', first_payment_at = now(), bonus_year = this_year
    where id = ref_row.id;
  end if;

  return result;
end;
$$;

-- Review koordinator poin 3: fungsi ini HANYA boleh dipanggil dari
-- DALAM record_subscription_payment() (yang berjalan sebagai role
-- definer/pemilik fungsi -- pola sama used_units_on_sql(), INTERNAL,
-- migration 070) -- TIDAK ADA grant ke role mana pun sama sekali,
-- termasuk authenticated. Postgres sengaja memberi EXECUTE ke PUBLIC
-- secara default untuk function baru (CLAUDE.md bagian 7) -- revoke
-- eksplisit ini WAJIB, bukan opsional.
revoke all on function apply_referral_signup_bonus(uuid, date) from public, anon, authenticated;

-- claim_referral_bonus -- idempoten + atomik (lock baris FOR UPDATE).
-- Klaim kedua pada baris yang SUDAH diklaim adalah NO-OP sukses (bukan
-- error) -- brief: "tekan dua kali = satu kali".
create or replace function claim_referral_bonus(p_referral_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_row referrals;
  current_active date;
begin
  select * into ref_row from referrals where id = p_referral_id for update;
  if ref_row is null then
    raise exception 'claim_referral_bonus: tidak ditemukan';
  end if;
  if not is_owner_of(ref_row.referrer_business_id) then
    raise exception 'claim_referral_bonus: tidak berhak';
  end if;

  if ref_row.status = 'diklaim' then
    return; -- idempoten, no-op
  end if;
  if ref_row.status <> 'siap_diklaim' then
    raise exception 'claim_referral_bonus: status belum siap diklaim';
  end if;

  -- Review koordinator [BUG]: kalau pengajak somehow tidak punya baris
  -- subscriptions (seharusnya tidak pernah terjadi -- trigger
  -- businesses_create_subscription mengisinya saat business dibuat --
  -- tapi jangan diam-diam kehilangan bonus kalau ternyata terjadi),
  -- SELECT di bawah mengembalikan NULL dan UPDATE berikutnya kena 0
  -- baris -- raise exception DULU, SEBELUM status referrals diubah,
  -- supaya baris tetap 'siap_diklaim' dan bisa diklaim ulang setelah
  -- baris subscriptions diperbaiki (bukan hilang begitu saja).
  select active_until into current_active from subscriptions where business_id = ref_row.referrer_business_id for update;
  if not found then
    raise exception 'claim_referral_bonus: business % belum punya baris subscriptions', ref_row.referrer_business_id;
  end if;

  update subscriptions
  set active_until = greatest(current_active, (now() at time zone 'Asia/Jakarta')::date) + 30,
      updated_at = now()
  where business_id = ref_row.referrer_business_id;

  update referrals set status = 'diklaim', claimed_at = now() where id = p_referral_id;
end;
$$;

revoke all on function claim_referral_bonus(uuid) from public, anon;
grant execute on function claim_referral_bonus(uuid) to authenticated;

-- list_my_referrals -- SATU-SATUNYA jalur baca untuk owner, kolom
-- dibatasi eksplisit (nama rental yang diajak SAJA, bukan seluruh baris
-- businesses).
create or replace function list_my_referrals(p_business_id uuid)
returns table (
  id uuid,
  referred_business_name text,
  status text,
  created_at timestamptz,
  first_payment_at timestamptz,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_owner_of(p_business_id) then
    raise exception 'list_my_referrals: tidak berhak';
  end if;

  return query
  select r.id, b.name, r.status, r.created_at, r.first_payment_at, r.claimed_at
  from referrals r
  join businesses b on b.id = r.referred_business_id
  where r.referrer_business_id = p_business_id
  order by r.created_at desc;
end;
$$;

revoke all on function list_my_referrals(uuid) from public, anon;
grant execute on function list_my_referrals(uuid) to authenticated;

-- validate_referral_code -- Review koordinator: BUKAN service-role key
-- (ditolak eksplisit -- kunci itu bypass SELURUH RLS, memperbesar risiko
-- jauh melebihi manfaatnya untuk satu validasi kode). Pakai pola shared-
-- secret yang SUDAH ADA (private_config + create_booking_request,
-- migration 037/065) -- REUSE secret 'booking_request_secret' yang
-- sama (TIDAK bikin baris/env baru), karena ancamannya identik (RPC
-- publik yang perlu dipanggil anon TAPI cuma lewat backend Express,
-- bukan langsung dari browser). Grant ke anon TETAP ada (sama seperti
-- create_booking_request), tapi p_secret yang salah/kosong selalu
-- ditolak di baris pertama function -- siapa pun yang panggil RPC ini
-- langsung lewat publishable key tanpa tahu secretnya dapat exception,
-- bukan hasil. Express memanggil lewat createAnonClient() (sudah ada,
-- lib/supabaseClient.ts) + perIpLimiter (pola bookingRequests.ts) --
-- TIDAK perlu env/klien baru sama sekali.
create or replace function validate_referral_code(p_code text, p_secret text)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  expected_secret text;
begin
  select value into expected_secret from private_config where key = 'booking_request_secret';
  if expected_secret is null or p_secret is distinct from expected_secret then
    raise exception 'validate_referral_code: secret tidak valid';
  end if;

  return (select name from businesses where upper(referral_code) = upper(p_code) limit 1);
end;
$$;

-- Grant ke anon (bukan authenticated) -- pola persis create_booking_request
-- (migration 037): secret di dalam function adalah syarat wajib, bukan
-- grant saja, jadi memanggil anon key tanpa tahu secret akan selalu
-- exception di baris pertama.
revoke all on function validate_referral_code(text, text) from public, authenticated;
grant execute on function validate_referral_code(text, text) to anon;

-- ================================================================
-- C. Ulasan Pengguna
-- ================================================================
create table if not exists business_reviews (
  business_id   uuid primary key references businesses(id),
  review_text   text check (char_length(review_text) <= 1000),
  rating        int check (rating between 1 and 5),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

alter table business_reviews enable row level security;

drop policy if exists "owner_select_own_review" on business_reviews;
create policy "owner_select_own_review"
  on business_reviews for select
  using (is_owner_of(business_id));

drop policy if exists "owner_upsert_own_review" on business_reviews;
create policy "owner_upsert_own_review"
  on business_reviews for insert
  with check (is_owner_of(business_id));

drop policy if exists "owner_update_own_review" on business_reviews;
create policy "owner_update_own_review"
  on business_reviews for update
  using (is_owner_of(business_id))
  with check (is_owner_of(business_id));

revoke all on business_reviews from anon;

-- Izin publikasi -- APPEND-ONLY (pola marketplace_consents, CLAUDE.md
-- bagian 7), SATU baris per perubahan pilihan, "izin TERAKHIR" = baris
-- dengan created_at terbesar per business_id (dipakai di view admin di
-- bawah).
create table if not exists business_review_consents (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id),
  consent_type      text not null check (consent_type in ('named', 'anonymized', 'internal_only')),
  consent_text_version text not null,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create index if not exists business_review_consents_business_idx on business_review_consents (business_id, created_at desc);

alter table business_review_consents enable row level security;

drop policy if exists "owner_select_own_review_consents" on business_review_consents;
create policy "owner_select_own_review_consents"
  on business_review_consents for select
  using (is_owner_of(business_id));

drop policy if exists "owner_insert_own_review_consents" on business_review_consents;
create policy "owner_insert_own_review_consents"
  on business_review_consents for insert
  with check (is_owner_of(business_id));
-- TIDAK ADA policy update/delete -- append-only, sengaja.

revoke all on business_review_consents from anon;

-- View untuk Andi (dibaca lewat Supabase Table Editor/SQL Editor,
-- sebagai role `postgres` -- bukan dipanggil dari aplikasi) -- ulasan +
-- izin TERAKHIR + nama/kota business, satu baris per business yang
-- sudah pernah mengisi ulasan.
--
-- [KRITIS, review koordinator] View di schema public TANPA
-- security_invoker secara default berjalan dengan hak OWNER (membuat
-- VIEW berarti MELEWATI RLS tabel-tabel di baliknya sama sekali, bukan
-- "mewarisi" RLS pemanggil), DAN Supabase memberi SELECT ke anon/
-- authenticated lewat default privileges PostgREST untuk relasi BARU di
-- schema public (pola SAMA seperti EXECUTE function, CLAUDE.md bagian
-- 7) -- tanpa dua baris di bawah, SIAPA PUN (anon lewat REST,
-- /rest/v1/admin_reviews_with_latest_consent) bisa membaca SELURUH
-- ulasan semua rental, TERMASUK yang izinnya "hanya untuk tim Sewalog".
-- `security_invoker = true` membuat view menghormati RLS pemanggil
-- (yang tidak ada baris SELECT untuk anon/authenticated sama sekali di
-- business_reviews/business_review_consents -- hasilnya kosong buat
-- mereka), dan `revoke` di bawah menutup jalur grant default PostgREST.
-- Andi (role `postgres` lewat Table Editor/SQL Editor) BYPASS RLS
-- apa pun dan tidak terpengaruh revoke ini sama sekali.
create or replace view admin_reviews_with_latest_consent
with (security_invoker = true)
as
select
  br.business_id,
  b.name as business_name,
  reg.name as regency_name,
  br.review_text,
  br.rating,
  br.updated_at as review_updated_at,
  latest.consent_type,
  latest.consent_text_version,
  latest.created_at as consent_at
from business_reviews br
join businesses b on b.id = br.business_id
left join regencies reg on reg.id = b.regency_id
left join lateral (
  select consent_type, consent_text_version, created_at
  from business_review_consents c
  where c.business_id = br.business_id
  order by c.created_at desc
  limit 1
) latest on true;

revoke all on admin_reviews_with_latest_consent from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
