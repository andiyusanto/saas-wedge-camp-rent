// Navigasi lintas-tab ke section Panduan tertentu (mis. dari kartu Notifikasi
// di tab Transaksi Aktif ke g-notifikasi) -- tab Panduan di-unmount saat tab
// lain aktif, jadi section-nya belum ada di DOM sampai GuideScreen dirender.
// sessionStorage dipakai supaya tetap benar kalau tab di-set lewat App.tsx
// lalu GuideScreen baru mount sesaat kemudian; GuideScreen yang membaca dan
// menghapusnya sekali saat mount.
//
// sessionStorage bisa throw (Safari private mode, storage diblokir, dsb) --
// review koordinator (2026-11-11): kalau throw di efek mount GuideScreen, tab
// Panduan bisa crash; kalau throw di tombol "Lihat panduan", kliknya mati.
// Semua akses dibungkus try/catch, gagal diam-diam -- pindah tab tetap
// jalan, cuma scroll-nya yang tidak terjadi.
const KEY = 'sewalog:pending-guide-scroll';

export function requestGuideScroll(sectionId: string) {
  try {
    sessionStorage.setItem(KEY, sectionId);
  } catch {
    // diam-diam gagal -- setTab tetap jalan dari pemanggil, cuma tanpa scroll
  }
}

// Baca TANPA menghapus -- dipakai di efek mount GuideScreen supaya aman
// terhadap React StrictMode (dev) yang menjalankan efek dua kali: kalau baca
// sekaligus hapus di sini, invoke pertama akan menghabiskan nilainya sebelum
// invoke kedua (yang sungguhan jalan sampai akhir) sempat membacanya.
export function peekPendingGuideScroll(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingGuideScroll() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // tidak ada yang perlu dilakukan -- peekPendingGuideScroll juga akan gagal diam-diam
  }
}
