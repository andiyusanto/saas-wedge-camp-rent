// Deteksi akun demo publik (dicoba pengunjung landing page) — dari EMAIL
// AUTH user yang login (session.user.email, tidak bisa dipalsukan dari
// client), BUKAN kolom business_members.email (snapshot yang bisa
// ditulis sendiri oleh client, lihat catatan spoofability di
// business_is_writable()/migration 044). Pola sama seperti
// reset_demo_bookings (migration 036), yang juga baca auth.jwt() email,
// bukan kolom tabel.
const DEMO_EMAILS = ['demo.pemilik@sewalog.test', 'demo.karyawan@sewalog.test'];

export function isDemoAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return DEMO_EMAILS.includes(email.toLowerCase());
}
