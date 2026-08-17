-- ============================================================
-- Migration 016 — Preview nama usaha dari kode undangan (sebelum login)
-- ============================================================
-- Layar login/daftar yang dibuka lewat link undangan (?invite=...) perlu
-- menampilkan nama usaha yang mengundang SEBELUM user login — di titik itu
-- belum ada JWT user sama sekali, jadi tidak bisa lewat RLS
-- is_member_of()/is_owner_of() seperti biasa (keduanya butuh auth.uid()).
--
-- business_invites SELECT sudah publik (using true, lihat migration 007),
-- tapi businesses SELECT member-only — jadi nama usahanya sendiri tidak
-- bisa diambil langsung. Function ini SECURITY DEFINER, sengaja dibatasi
-- ketat: cuma mengembalikan nama usaha + role kalau kode PERSIS cocok
-- dengan undangan yang belum dipakai & belum kedaluwarsa — tidak pernah
-- membocorkan daftar/isi business_invites atau businesses secara umum.

create or replace function get_invite_preview(p_code text)
returns table (business_name text, role text)
language sql
security definer
set search_path = public
stable
as $$
  select b.name, bi.role
  from business_invites bi
  join businesses b on b.id = bi.business_id
  where bi.code = p_code
    and bi.used_at is null
    and bi.expires_at > now();
$$;

grant execute on function get_invite_preview(text) to anon, authenticated;
