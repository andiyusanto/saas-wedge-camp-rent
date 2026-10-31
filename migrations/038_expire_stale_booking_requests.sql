-- ============================================================
-- Migration 038 — Kedaluwarsa lazy booking_requests (tahap 2 backend)
-- ============================================================
-- Rencana 2.6: status 'kedaluwarsa' dihitung LAZY, bukan cron. Migration
-- 037 (get_booking_request_status) sudah menampilkannya lazy di SELECT
-- publik tanpa menulis apa pun (function itu 'stable'). Fungsi ini
-- adalah sisi TULIS-nya: dipanggil dari endpoint vendor yang membaca
-- daftar "Pesanan Online" (non-stable, authenticated), supaya baris yang
-- sudah lewat expires_at benar-benar di-flip permanen ke 'kedaluwarsa' di
-- tabel, bukan cuma tampil begitu saja di satu tempat. Scope ke SATU
-- business_id (bukan semua business sekaligus) karena dipanggil per
-- vendor saat vendor itu membuka tab Pesanan Online — is_member_of di
-- dalamnya mencegah dipakai untuk business lain.
create or replace function expire_stale_booking_requests(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_member_of(p_business_id) then
    raise exception 'expire_stale_booking_requests: tidak berhak';
  end if;

  update booking_requests
  set status = 'kedaluwarsa'
  where business_id = p_business_id
    and status = 'menunggu'
    and expires_at <= now();
end;
$$;

revoke all on function expire_stale_booking_requests(uuid) from public, anon;
grant execute on function expire_stale_booking_requests(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
