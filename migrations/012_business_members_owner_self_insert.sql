-- ============================================================
-- Migration 012 — Owner bisa daftarkan dirinya sendiri tanpa undangan
-- ============================================================
-- Migration 007 cuma menyiapkan satu jalur insert ke business_members:
-- lewat undangan valid (insert_self_via_valid_invite). Itu cukup buat
-- karyawan yang diundang, tapi TIDAK cukup buat pemilik yang baru saja
-- bikin business-nya sendiri lewat alur onboarding — tidak ada undangan
-- sama sekali di kasus itu (dia bikin business dari nol).
--
-- Policy ini mengizinkan seseorang mendaftarkan dirinya sebagai 'owner'
-- HANYA kalau businesses.owner_id memang dia (jadi tidak bisa dipakai
-- buat mengklaim jadi owner business orang lain).

create policy "insert_self_as_owner_of_own_business"
  on business_members for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from businesses
      where businesses.id = business_members.business_id
        and businesses.owner_id = auth.uid()
    )
  );
