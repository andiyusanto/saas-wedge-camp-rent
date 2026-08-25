-- Edit info usaha (nama, nama pemilik, telepon, toleransi telat) baru bisa
-- dilakukan lewat UI mulai fitur ini — batasi ke owner saja, konsisten
-- dengan pola Kelola Karyawan (migration 014). SELECT tetap terbuka untuk
-- semua anggota (karyawan tetap perlu baca late_tolerance_hours untuk
-- Jaminan & Denda).
drop policy if exists "members_update_own_business" on businesses;
create policy "owner_update_own_business"
  on businesses for update
  using (is_owner_of(id))
  with check (is_owner_of(id));
