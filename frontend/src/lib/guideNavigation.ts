// Navigasi lintas-tab ke section Panduan tertentu (mis. dari kartu Notifikasi
// di tab Transaksi Aktif ke g-notifikasi) -- tab Panduan di-unmount saat tab
// lain aktif, jadi section-nya belum ada di DOM sampai GuideScreen dirender.
// sessionStorage dipakai supaya tetap benar kalau tab di-set lewat App.tsx
// lalu GuideScreen baru mount sesaat kemudian; GuideScreen yang membaca dan
// menghapusnya sekali saat mount.
const KEY = 'sewalog:pending-guide-scroll';

export function requestGuideScroll(sectionId: string) {
  sessionStorage.setItem(KEY, sectionId);
}

// Baca TANPA menghapus -- dipakai di efek mount GuideScreen supaya aman
// terhadap React StrictMode (dev) yang menjalankan efek dua kali: kalau baca
// sekaligus hapus di sini, invoke pertama akan menghabiskan nilainya sebelum
// invoke kedua (yang sungguhan jalan sampai akhir) sempat membacanya.
export function peekPendingGuideScroll(): string | null {
  return sessionStorage.getItem(KEY);
}

export function clearPendingGuideScroll() {
  sessionStorage.removeItem(KEY);
}
