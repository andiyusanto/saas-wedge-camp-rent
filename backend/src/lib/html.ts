// Escape kecil buat nulis HTML mentah lewat template string (routes/etalase.ts)
// — tidak pakai templating engine/React SSR sama sekali, jadi setiap nilai
// dari database (nama usaha, deskripsi, dll — semuanya diketik vendor lewat
// form, bukan hardcode) WAJIB lewat sini dulu sebelum masuk ke output,
// supaya vendor tidak bisa taruh HTML/script di deskripsi/nama alat dan
// bocor jadi XSS ke pengunjung publik halaman /toko/{slug}.
export function escapeHtml(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
