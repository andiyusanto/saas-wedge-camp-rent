-- ============================================================
-- Migration 075 — Hapus batas 10 bonus referral/tahun (keputusan Andi
-- 24 Nov 2026, diteruskan via koordinator)
-- ============================================================
-- Alasan: bonus pengajak baru keluar SETELAH rental yang diajak
-- benar-benar membayar langganan pertamanya -- karena itu, akal-akalan
-- (membuat banyak business palsu untuk ambil bonus) sudah tidak
-- menguntungkan TANPA perlu batas tahunan juga (perlindungan yang
-- TETAP ada: wajib bayar dulu, tidak boleh mengajak diri sendiri,
-- kode cuma bisa dipakai saat daftar -- ketiganya TIDAK diubah oleh
-- migration ini).
--
-- Diff dari migration 074: HANYA apply_referral_signup_bonus() yang
-- berubah (hapus hitungan claimable_count/bonus_year 10 batas, status
-- SELALU 'siap_diklaim'). Signature, revoke (TIDAK ada grant ke role
-- mana pun -- cuma dipanggil dari dalam record_subscription_payment()),
-- dan cara pemanggilannya dari record_subscription_payment() TIDAK
-- berubah sama sekali.
--
-- Nilai 'melewati_batas' DIBIARKAN di CHECK constraint kolom
-- referrals.status (migration 074) -- tidak dipakai lagi mulai
-- sekarang, tapi tidak ada data yang pernah memakainya (fitur ini baru
-- live, belum ada rental yang diajak sungguhan), jadi tidak perlu
-- migration terpisah untuk membuang nilai itu dari constraint. Kolom
-- bonus_year TETAP ada (masih diisi, cuma tidak lagi dipakai untuk
-- membatasi apa pun) -- berguna untuk laporan/riwayat "berapa bonus per
-- tahun kalender" nanti kalau diperlukan, tanpa makna pembatas.
create or replace function apply_referral_signup_bonus(p_referred_business_id uuid, p_new_active_until date)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_row referrals;
  result date;
begin
  select * into ref_row from referrals where referred_business_id = p_referred_business_id and status = 'terdaftar';
  if ref_row is null then
    return p_new_active_until; -- bukan business hasil ajakan, atau sudah diproses sebelumnya
  end if;

  -- +30 hari OTOMATIS untuk yang DIAJAK -- selalu.
  result := p_new_active_until + 30;

  -- Status SELALU siap_diklaim -- batas 10/tahun DIHAPUS (keputusan
  -- Andi 24 Nov 2026). bonus_year tetap dicatat (tahun kalender WIB
  -- saat bonus menjadi siap_diklaim) murni untuk riwayat/pelaporan,
  -- BUKAN lagi untuk membatasi apa pun.
  update referrals
  set status = 'siap_diklaim', first_payment_at = now(), bonus_year = extract(year from (now() at time zone 'Asia/Jakarta'))
  where id = ref_row.id;

  return result;
end;
$$;

-- Review koordinator (migration 074, poin 3, TIDAK berubah): fungsi ini
-- HANYA boleh dipanggil dari DALAM record_subscription_payment() --
-- TIDAK ADA grant ke role mana pun, termasuk authenticated.
revoke all on function apply_referral_signup_bonus(uuid, date) from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
