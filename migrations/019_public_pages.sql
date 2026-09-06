-- ============================================================
-- Migration 019 — Etalase Online (halaman publik read-only per vendor)
-- ============================================================
-- Tabel BARU, sengaja TERPISAH dari business_profiles (bukan reuse) —
-- keputusan diambil karena business_profiles (skema-final.sql bagian 3)
-- didesain khusus untuk opt-in Rimbasewa (marketplace multi-vendor fase
-- nanti, CLAUDE.md bagian 7): "cuma terisi kalau vendor eksplisit opt-in
-- ke marketplace nanti". Etalase Online itu consent yang beda sama
-- sekali secara makna — "vendor mau halaman info publik miliknya sendiri
-- (murni etalase, bukan marketplace)" — bukan "vendor setuju masuk
-- marketplace Rimbasewa". Naruh kolom `published` di business_profiles
-- akan mencampur dua konsep consent itu dan bikin marketplace_consents
-- (riwayat append-only opt-in Rimbasewa) rancu maknanya kalau suatu saat
-- vendor sudah punya Etalase Online tapi belum/tidak pernah opt-in
-- Rimbasewa, atau sebaliknya. Tabel terpisah menjaga business_profiles
-- dan marketplace_consents tetap murni untuk Rimbasewa nanti.
create table public_pages (
  business_id      uuid primary key references businesses(id),
  published        boolean not null default false,
  slug             text unique,
  description      text,
  address          text,
  regency_id       uuid references regencies(id),
  operating_hours  text,
  public_phone     text,
  updated_at       timestamptz not null default now()
);

alter table public_pages enable row level security;

-- Baca/tulis dari sisi tab "Etalase Online" (owner-only di UI) — sama
-- persis pola businesses (migration 018): SELECT dan UPDATE dibatasi
-- owner_id lewat is_owner_of(), bukan is_member_of(), karena tab ini
-- eksplisit owner-only.
create policy "owner_select_own_public_page"
  on public_pages for select
  using (is_owner_of(business_id));

create policy "owner_insert_own_public_page"
  on public_pages for insert
  with check (is_owner_of(business_id));

create policy "owner_update_own_public_page"
  on public_pages for update
  using (is_owner_of(business_id))
  with check (is_owner_of(business_id));

-- SENGAJA tidak ada policy select untuk anon/publik di sini, dan SENGAJA
-- tidak ada policy delete sama sekali. Baca publik halaman /toko/{slug}
-- TIDAK lewat query tabel langsung dengan anon key (lihat larangan
-- eksplisit di komentar createAnonClient(), backend/src/lib/
-- supabaseClient.ts: "jangan query tabel langsung lewat klien ini") —
-- tapi lewat function get_public_page() di bawah, SECURITY DEFINER yang
-- membangun sendiri daftar kolom amannya dan MEMFILTER published = true
-- di dalam function-nya sendiri. Ini pola yang sama dengan
-- get_invite_preview() (migration 016), dan menjawab constraint di
-- prompt fitur ini bahwa RLS Postgres tidak bisa membatasi per-kolom:
-- proteksi kolom di sini terjadi di satu titik terpusat (daftar kolom
-- hardcode di json_build_object di bawah), bukan bergantung ke RLS
-- row-level ATAUPUN ke disiplin tiap endpoint memilih kolom yang benar.
-- `total_units` TIDAK PERNAH disebut di function ini sama sekali.
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

  return result; -- null kalau slug tidak ada / belum published — caller (routes/etalase.ts) balikin 404
end;
$$;

grant execute on function get_public_page(text) to anon, authenticated;
