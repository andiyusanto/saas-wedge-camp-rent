// Label status referral (brief 24 Nov 2026) -- diekstrak jadi modul murni
// (bukan didefinisikan langsung di LanggananScreen.tsx) supaya bisa
// diuji tanpa mengimpor komponen React/hooks Supabase.
export const REFERRAL_STATUS_LABEL: Record<string, string> = {
  terdaftar: 'Sudah daftar',
  siap_diklaim: 'Bonus siap diklaim',
  diklaim: 'Sudah diklaim',
  // 'melewati_batas' SENGAJA tidak punya label sendiri (keputusan Andi
  // 24 Nov 2026: batas 10/tahun dihapus, istilah ini tidak boleh tampil
  // di mana pun lagi) -- fallback ke 'terdaftar' kalau somehow masih
  // ada baris lama dengan status ini (tidak ada data yang memakainya).
  melewati_batas: 'Sudah daftar',
};
