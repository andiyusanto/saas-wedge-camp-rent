// Ingat tab terakhir dibuka lintas refresh (brief disetujui Andi 12 Nov
// 2026) -- sessionStorage, BUKAN localStorage: tab/jendela baru atau
// dibuka dari ikon layar utama sengaja tetap mulai dari Kalender, cuma
// refresh di tab/jendela yang SAMA yang mempertahankan menu terakhir.
// Dihapus saat logout (lihat useAuth.ts) supaya login ulang (termasuk
// user lain di device yang sama) juga mulai dari Kalender.
//
// Pola sama guideNavigation.ts: semua akses sessionStorage dibungkus
// try/catch (Safari private mode, storage diblokir, dsb) -- gagal diam-
// diam, jatuh ke 'kalender'.
import type { Tab } from '../components/Navbar';

const KEY = 'sewalog:active-tab';

const VALID_TABS: readonly Tab[] = [
  'kalender',
  'tracking',
  'alat',
  'tim',
  'riwayat',
  'etalase-online',
  'toko-online',
  'panduan',
  'admin',
  'langganan',
];

export function saveActiveTab(tab: Tab) {
  try {
    sessionStorage.setItem(KEY, tab);
  } catch {
    // tidak fatal -- cuma berarti refresh berikutnya jatuh balik ke Kalender
  }
}

export function loadActiveTab(): Tab | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw && (VALID_TABS as readonly string[]).includes(raw)) return raw as Tab;
    return null;
  } catch {
    return null;
  }
}

export function clearActiveTab() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // tidak ada yang perlu dilakukan -- loadActiveTab juga akan gagal diam-diam
  }
}
