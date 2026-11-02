-- ============================================================
-- Migration 050 — Foto penyewa pindah ke bucket R2 privat
-- ============================================================
-- Audit privasi 2 Nov 2026 (diminta Andi lewat -c1): bookings.
-- customer_photo_url (migration 017) menyimpan URL PUBLIK penuh ke
-- bucket R2 yang terhubung custom domain (image.sewalog.com) — siapa
-- pun yang pernah melihat URL itu bisa mengaksesnya SELAMANYA tanpa
-- login (dikonfirmasi lewat curl langsung, HTTP 200 tanpa header auth
-- apa pun). UUID acak di nama file mencegah ENUMERASI (listing bucket
-- juga sudah 404), tapi itu bukan kontrol akses sungguhan.
--
-- Perbaikan: foto baru diunggah ke bucket R2 TERPISAH yang TIDAK
-- terhubung custom domain publik apa pun (sewalog-customer-private,
-- disiapkan Andi), diakses HANYA lewat endpoint backend baru (GET
-- /api/bookings/:id/customer-photo) yang mengecek keanggotaan business
-- lalu menerbitkan presigned URL berumur 5 menit — lihat backend/src/
-- lib/r2.ts dan backend/src/routes/uploads.ts/bookings.ts.
--
-- Kolom BARU (`customer_photo_key`), BUKAN mengubah customer_photo_url
-- yang sudah ada — baris LAMA (foto di bucket publik lama) tetap bisa
-- dibaca apa adanya selama masa transisi (customer_photo_url masih
-- terisi, customer_photo_key masih null untuk baris itu), sampai
-- migrasi foto lama (langkah terpisah, TERPISAH dari migration ini,
-- butuh persetujuan eksplisit Andi sebelum dijalankan — lihat rencana
-- audit) memindahkan isinya dan baru mengosongkan customer_photo_url.
-- Frontend/backend baru menulis ke customer_photo_key untuk upload
-- BARU; customer_photo_url yang sudah ada TIDAK disentuh migration ini
-- sama sekali, cuma kolom baru yang ditambah.
-- Review -c1: TANPA constraint ini, anggota business A yang entah
-- bagaimana tahu key foto milik business B (mis. mantan karyawan yang
-- pernah kerja di B, atau sekadar menebak format "customers/{id}/...")
-- bisa UPDATE customer_photo_key booking miliknya SENDIRI untuk
-- menunjuk ke key business lain lewat RLS yang sudah ada (is_member_of
-- cuma mengecek business_id baris itu sendiri, tidak pernah memvalidasi
-- ISI kolom text bebas seperti ini) — endpoint presign lalu dengan
-- senang hati menandatangani & menyajikan foto business B. Constraint
-- ini memaksa key SELALU berpola "customers/{business_id baris ini}/..."
-- (business_id milik BARIS ITU SENDIRI, bukan business_id sembarang),
-- dan menolak '..' (path traversal keluar prefix bucket). Endpoint
-- presign (routes/bookings.ts) MASIH memvalidasi ulang pola yang sama
-- secara eksplisit sebelum menandatangani — constraint ini jaring
-- pengaman DB, bukan satu-satunya lapis (defense in depth).
alter table bookings
  add column if not exists customer_photo_key text
    constraint customer_photo_key_scoped_to_own_business check (
      customer_photo_key is null
      or (
        customer_photo_key like 'customers/' || business_id::text || '/%'
        and customer_photo_key not like '%..%'
      )
    );

select pg_notify('pgrst', 'reload schema');
