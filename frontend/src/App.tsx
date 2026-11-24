import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LogOut } from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { useAuth } from './hooks/useAuth';
import { useBusiness } from './hooks/useBusiness';
import { useBookingRequests } from './hooks/useBookingRequests';
import { useSubscription } from './hooks/useSubscription';
import { useIsAppAdmin } from './hooks/useIsAppAdmin';
import { SubscriptionBanner } from './components/SubscriptionBanner';
import { AdminScreen } from './components/AdminScreen';
import { LanggananScreen } from './components/LanggananScreen';
import { isDemoAccountEmail } from './utils/demo';
import { requestGuideScroll } from './lib/guideNavigation';
import { loadActiveTab, saveActiveTab } from './lib/tabStorage';
import { AuthScreen } from './components/AuthScreen';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { InviteConfirmScreen } from './components/RedeemInviteScreen';
import { ItemsScreen } from './components/ItemsScreen';
import { CalendarScreen } from './components/CalendarScreen';
import { NewBookingModal } from './components/NewBookingModal';
import { DraftListModal } from './components/DraftListModal';
import { listBookingDrafts, clearAllBookingDraftsOnLogout } from './hooks/useBookingDrafts';
import { TrackingScreen } from './components/TrackingScreen';
import type { StatusFilter } from './components/TrackingScreen';
import { TeamScreen } from './components/TeamScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { CustomersScreen } from './components/CustomersScreen';
import { GuideScreen } from './components/GuideScreen';
import { OnlineStoreScreen } from './components/OnlineStoreScreen';
import { EtalaseOnlineScreen } from './components/EtalaseOnlineScreen';
import { Navbar, SHOW_TOKO_ONLINE_TAB } from './components/Navbar';
import type { Tab } from './components/Navbar';

// Bug nyata ditemukan 2 Nov 2026 (lihat RedeemInviteScreen.tsx untuk
// alur lengkapnya): kode undangan SEBELUMNYA cuma dibaca dari
// `window.location.search` sekali saat App mount — itu hilang begitu
// user klik link konfirmasi EMAIL dari Supabase (reload halaman penuh,
// URL baru tidak lagi punya `?invite=...`), jadi redemption tidak pernah
// jalan dan user yang sudah diundang malah jatuh ke OnboardingScreen
// (bikin business baru sendiri, bukan join yang diundang). Diperbaiki
// dua lapis: (1) kode disimpan ke localStorage begitu PERTAMA kali
// terlihat di URL, dibaca balik sebagai fallback kalau URL sudah tidak
// punya `?invite=` lagi (menutupi reload lewat link email); (2)
// AuthForm.tsx mengirim `emailRedirectTo` yang membawa `?invite=...` di
// URL redirect-nya sendiri (lihat komentar di sana) — dua-duanya
// independen, salah satu gagal yang lain tetap menutupi.
const INVITE_STORAGE_KEY = 'sewalog_pending_invite';
// Review -c1: device bisa dipakai gantian (mis. HP/tablet kasir toko) —
// kode yang "nyangkut" di localStorage TANPA batas waktu berisiko
// ke-redeem ke akun orang lain yang login belakangan di device yang
// sama. 24 jam cukup untuk nutupi jeda wajar sampai email konfirmasi
// diklik, tapi tidak nyangkut selamanya. Kedaluwarsa ASLI undangannya
// sendiri (business_invites.expires_at) tetap jadi penjaga utama di
// server (get_invite_preview/redeem RPC) — ini cuma lapisan klien,
// mana yang lebih dulu tercapai.
const INVITE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readInviteCode(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('invite');
  if (fromUrl) {
    try {
      localStorage.setItem(INVITE_STORAGE_KEY, JSON.stringify({ code: fromUrl, storedAt: Date.now() }));
    } catch {
      // Private browsing/storage diblokir — tidak fatal, cuma berarti
      // fallback lintas-reload ini tidak akan menutupi kasusnya kalau
      // terjadi. emailRedirectTo (lapis kedua) tetap jalan independen.
    }
    return fromUrl;
  }
  try {
    const raw = localStorage.getItem(INVITE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code: string; storedAt: number };
    if (Date.now() - parsed.storedAt > INVITE_MAX_AGE_MS) {
      localStorage.removeItem(INVITE_STORAGE_KEY);
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

// Prasyarat tombol "Daftar Gratis" di landing (brief 17 Nov 2026) --
// `?daftar=1` membuka AuthScreen langsung dalam mode 'daftar', dibaca
// SEKALI saat mount (pola sama readInviteCode(), tanpa persist localStorage
// karena ini cuma hint mode awal, bukan kredensial yang perlu bertahan
// lintas reload/email-redirect). `?invite=` tetap menang kalau dua-duanya
// ada (dicek di AuthScreen.tsx: inviteCode || forceDaftar -> 'daftar').
function readForceDaftar(): boolean {
  return new URLSearchParams(window.location.search).get('daftar') === '1';
}

// Kode ajakan (brief 24 Nov 2026, Ajak Rental Lain) -- parameter `ref`
// dari link `https://sewalog.com/?daftar=1&ref=KODE` disimpan sementara
// (localStorage, try/catch) supaya BERTAHAN dari landing sampai form
// daftar diisi (bisa beberapa klik/reload di antaranya, mis. baca
// halaman lain dulu) -- pola SAMA readInviteCode() di atas (TTL 24 jam,
// alasan sama: device bisa dipakai gantian). Dipakai mengisi otomatis
// field "Kode ajakan (opsional)" di OnboardingScreen.tsx, TETAP bisa
// diubah manual oleh pendaftar.
const REFERRAL_STORAGE_KEY = 'sewalog_pending_referral';
const REFERRAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readReferralCode(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('ref');
  if (fromUrl) {
    try {
      localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify({ code: fromUrl, storedAt: Date.now() }));
    } catch {
      // Private browsing/storage diblokir -- tidak fatal, field kode
      // ajakan cuma tidak terisi otomatis, tetap bisa diketik manual.
    }
    return fromUrl;
  }
  try {
    const raw = localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code: string; storedAt: number };
    if (Date.now() - parsed.storedAt > REFERRAL_MAX_AGE_MS) {
      localStorage.removeItem(REFERRAL_STORAGE_KEY);
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

// Parameter sumber pendaftaran (mis. "landing-hero") -- disimpan ke metadata
// signup Supabase (options.data.signup_source) buat metrik, BUKAN data
// pribadi. Whitelist pendek: huruf/angka/strip/underscore saja, maks 40
// karakter -- nilai yang tidak lolos diabaikan (null), tidak pernah
// dikirim mentah tanpa validasi.
const SIGNUP_SOURCE_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
function readSignupSource(): string | null {
  const value = new URLSearchParams(window.location.search).get('src');
  if (value && SIGNUP_SOURCE_PATTERN.test(value)) return value;
  return null;
}

function clearInviteCode() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState({}, '', url.toString());
  try {
    localStorage.removeItem(INVITE_STORAGE_KEY);
  } catch {
    // tidak fatal, lihat catatan di readInviteCode().
  }
}

// Bug nyata ditemukan Andi 3 Nov 2026: akun admin (app_admins, migration
// 044) yang SENGAJA tidak punya business (mis. sewalogdotcomcorp@gmail.com,
// akun admin murni buat pakai Alat Admin, bukan vendor) jatuh ke
// OnboardingScreen seperti akun biasa tanpa business — tab Alat Admin
// sendiri cuma ada di Navbar, yang cuma dirender setelah punya business,
// jadi admin begini tidak akan PERNAH bisa mencapainya. Layar ini
// SENGAJA bukan app penuh (tanpa Navbar/tab lain — tidak ada business
// untuk ditampilkan) — cuma header Sewalog minimal + AdminScreen + tombol
// keluar. TIDAK membuat business otomatis untuk akun admin (instruksi
// Andi) — kalau admin ini KEBETULAN juga owner business sendiri, dia
// tetap jatuh ke app biasa dengan tab Alat Admin seperti sebelumnya
// (lihat guard `!business` di App() di bawah, cuma berlaku kalau business
// benar-benar null).
function AdminOnlyView({ session, onLogout }: { session: Session; onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-[#F1EEE2] text-[#26302B] flex flex-col">
      <header className="sticky top-0 z-30 bg-[#2B4739] text-white shadow-md border-b border-[#1E3429]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-[#F1EEE2] flex items-center justify-center p-1.5 shadow-sm border border-[#DBD5C1] shrink-0">
                <img src="/logo.svg" alt="" className="w-full h-full" />
              </div>
              <div className="min-w-0">
                <span className="text-xl font-bold tracking-tight text-[#F1EEE2]">Sewalog</span>
                <p className="text-xs text-[#E6E1D2]/80 font-medium truncate">Akun Admin</p>
              </div>
            </div>
            {/* Review 3 Nov 2026: Andi melaporkan logo/tombol keluar
                terpotong di 390px — wrapper di sini SEBELUMNYA tidak
                punya shrink-0, beda dari grup tombol kanan Navbar.tsx
                (lihat "flex items-center gap-2 shrink-0" di sana) yang
                jadi acuan pola header ini. Tanpa shrink-0, flex-shrink
                default (1) bisa memampatkan tombol begitu kolom kiri
                (yang sekarang flex-1, SENGAJA mengambil sisa ruang
                supaya tombol ini tidak perlu ikut berebut ruang sama
                sekali) melebihi lebar tersedia. */}
            <div className="flex items-center shrink-0">
              <button
                onClick={onLogout}
                title="Keluar"
                className="p-2 rounded-xl bg-[#1E3429] hover:bg-[#15251D] border border-[#3A5C4A] text-[#DBD5C1] transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <AdminScreen session={session} />
      </main>
    </div>
  );
}

function App() {
  const { session, loading: authLoading, isPasswordRecovery, clearPasswordRecovery } = useAuth();
  const {
    business,
    role,
    loading: businessLoading,
    error: businessError,
    refresh: refreshBusiness,
    updateBusiness,
  } = useBusiness(session);
  // Ingat tab terakhir dibuka lintas refresh (brief disetujui Andi 12 Nov
  // 2026, lihat lib/tabStorage.ts) -- lazy initializer supaya cuma dibaca
  // sekali saat mount, bukan tiap render. Tab/jendela baru atau login ulang
  // sengaja tidak mewarisi ini (sessionStorage per-tab + dihapus saat logout,
  // lihat useAuth.ts), jatuh balik ke 'kalender'.
  const [tab, setTab] = useState<Tab>(() => loadActiveTab() ?? 'kalender');
  // Label "Telat, N unit terkunci..." di Kalender (koordinator 17 Nov
  // 2026) -- dibaca SEKALI saat TrackingScreen mount (lihat initialFilter
  // di sana), lalu dibersihkan begitu pengguna MENINGGALKAN tab Transaksi
  // Aktif (efek di bawah), supaya menekan tab menu itu secara manual
  // nanti tetap kembali ke filter default "Semua".
  const [trackingInitialFilter, setTrackingInitialFilter] = useState<StatusFilter | null>(null);
  useEffect(() => {
    if (tab !== 'tracking') setTrackingInitialFilter(null);
  }, [tab]);
  const [refreshSignal, setRefreshSignal] = useState(0);
  // Badge tab + banner Kalender (rencana 2.4 bagian B+C) — instance
  // terpisah dari yang dipakai TrackingScreen sendiri (poll ringan
  // masing-masing, bukan realtime, lihat useBookingRequests.ts) supaya
  // badge/banner tetap jalan walau belum pernah membuka tab Transaksi
  // Aktif sama sekali.
  const { pendingCount: pendingRequestCount } = useBookingRequests(business?.id ?? null);
  const { subscription, loading: subscriptionLoading } = useSubscription(business?.id ?? null);
  const { isAdmin: isAppAdmin, loading: isAppAdminLoading } = useIsAppAdmin(session);
  const isDemoAccount = isDemoAccountEmail(session?.user.email);

  // Jaring pengaman kalau karyawan sempat berada di tab owner-only (mis.
  // baru saja diturunkan dari owner ke karyawan oleh pemilik lain, atau tab
  // tersimpan dari lib/tabStorage.ts milik role/business sebelumnya) — Navbar
  // sendiri sudah menyembunyikan tab-nya, ini cuma jaga-jaga isi <main>.
  // role===null (masih dimuat, lihat useBusiness.ts) sengaja TIDAK memicu
  // reset -- mencegah tab tersimpan yang sah (mis. 'riwayat' milik owner)
  // sempat "kelihatan" di-reset ke Kalender sekejap pas mount, sebelum role
  // sungguhan sempat termuat.
  useEffect(() => {
    if (
      (tab === 'tim' || tab === 'riwayat' || tab === 'etalase-online' || tab === 'toko-online' || tab === 'langganan') &&
      role !== null &&
      role !== 'owner'
    ) {
      setTab('kalender');
      return;
    }
    // Tab Toko Online disembunyikan lewat SHOW_TOKO_ONLINE_TAB (Navbar.tsx)
    // independen dari role -- tab tersimpan dari sebelum flag ini dimatikan
    // (atau sesi dev lama) tidak boleh tetap terbuka.
    if (tab === 'toko-online' && !SHOW_TOKO_ONLINE_TAB) {
      setTab('kalender');
      return;
    }
    // Admin bisa diturunkan dari app_admins sewaktu-waktu — kalau sedang
    // di tab Alat Admin dan statusnya sudah DIPASTIKAN bukan admin (tunggu
    // isAppAdminLoading selesai dulu -- isAppAdmin mulai sebagai false
    // selama loading, lihat useIsAppAdmin.ts, jadi tanpa menunggu ini admin
    // yang refresh di tab 'admin' akan sempat terlempar ke Kalender).
    if (tab === 'admin' && !isAppAdminLoading && !isAppAdmin) {
      setTab('kalender');
    }
  }, [tab, role, isAppAdmin, isAppAdminLoading]);

  // Simpan tab aktif supaya refresh di tab/jendela yang sama membuka menu
  // yang sama lagi (bukan selalu kembali ke Kalender) -- lihat lib/tabStorage.ts.
  useEffect(() => {
    saveActiveTab(tab);
  }, [tab]);

  // Klik notifikasi push (sw.js) — service worker tidak bisa langsung
  // mengubah state React, jadi mengirim postMessage ke tab yang sedang
  // fokus, yang didengarkan di sini.
  useEffect(() => {
    function handleSwMessage(event: MessageEvent) {
      if (event.data?.type === 'sewalog-push-click' && event.data.tab === 'tracking') {
        setTab('tracking');
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
  }, []);

  // Daftarkan service worker sejak awal untuk SEMUA user (bukan cuma yang
  // sempat buka tab Transaksi Aktif, lihat usePushNotifications.ts) --
  // beforeinstallprompt (tombol "Pasang Aplikasi", Navbar.tsx) butuh SW
  // terdaftar untuk dianggap installable oleh browser. register() idempoten,
  // tidak konflik dengan registrasi di usePushNotifications.ts. sw.js sendiri
  // TIDAK diubah -- tetap cuma handler push/notificationclick, tanpa fetch/cache.
  useEffect(() => {
    navigator.serviceWorker?.register('/sw.js').catch(() => {});
  }, []);

  // Bug "JWT expired" (laporan Andi 24 Nov 2026) -- di HP/PWA yang lama di
  // background (tab disembunyikan >1 jam), timer auto-refresh supabase-js
  // berhenti sendiri untuk menghemat baterai. Pola resmi supabase-js untuk
  // app mobile/PWA: stopAutoRefresh() saat tab tersembunyi, startAutoRefresh()
  // lagi begitu terlihat -- supaya token sudah segar SAAT app dibuka
  // kembali, bukan baru ketahuan basi setelah fetch pertama gagal (yang
  // sekarang juga sudah ditangani lewat retry di apiFetch(), lib/api.ts,
  // tapi mencegah lebih baik daripada selalu mengandalkan retry).
  useEffect(() => {
    if (!supabase) return;
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') supabase?.auth.startAutoRefresh();
      else supabase?.auth.stopAutoRefresh();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const [isNewBookingOpen, setIsNewBookingOpen] = useState(false);
  const [preselectedItemId, setPreselectedItemId] = useState<string | null>(null);
  const [preselectedBundleId, setPreselectedBundleId] = useState<string | null>(null);
  const [preselectedStartDate, setPreselectedStartDate] = useState<string | null>(null);
  // Draf Transaksi / Keranjang (brief 23 Nov 2026) -- resumeDraftId cuma
  // diisi lewat tombol "Lanjutkan" di DraftListModal, SELALU dikosongkan
  // lagi saat modal ditutup (lihat onClose NewBookingModal di bawah)
  // supaya "Catat Transaksi" biasa berikutnya tidak diam-diam melanjutkan
  // draf lama. draftListVersion cuma dipakai memaksa badge "Draf (N)" di
  // Navbar membaca ulang localStorage setelah draf berubah (disimpan di
  // perangkat, bukan state React -- tidak otomatis trigger render).
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [isDraftListOpen, setIsDraftListOpen] = useState(false);
  // Badge "Draf (N)" di Navbar dihitung inline dari localStorage tiap
  // render App.tsx (listBookingDrafts, bukan state React) -- tick ini
  // cuma dipakai supaya hapus satu/semua draf DI DALAM DraftListModal
  // (state-nya sendiri, tidak otomatis memicu render App.tsx) ikut
  // memaksa App.tsx render ulang sekali lagi, jadi badge langsung
  // ter-update tanpa harus menutup modal daftar draf dulu.
  const [draftListTick, setDraftListTick] = useState(0);
  // business bisa masih null di titik ini (guard `if (!business)` ada DI
  // BAWAH, setelah hook-hook ini -- tidak boleh dipindah karena aturan
  // hooks). Dihitung POLOS (bukan useMemo) tiap render -- draftListTick
  // sendiri tidak dibaca di ekspresinya, cuma dipakai SEBAGAI state yang
  // di-bump supaya App.tsx render ulang (memaksa baca localStorage
  // terbaru) setelah hapus draf di dalam DraftListModal yang modalnya
  // sendiri tidak memicu render App.tsx.
  void draftListTick;
  const draftCount = business ? listBookingDrafts(business.id).length : 0;

  const [inviteCode, setInviteCode] = useState<string | null>(readInviteCode);
  const [referralCode] = useState<string | null>(readReferralCode);
  const [forceDaftar] = useState<boolean>(readForceDaftar);
  const [signupSource] = useState<string | null>(readSignupSource);
  // Ditampilkan/tidak ditampilkan lagi untuk SESI INI setelah pengguna
  // menjawab konfirmasi ("Gabung"/"Bukan saya") — beda dari inviteCode
  // yang disimpan lintas-reload, flag ini sengaja TIDAK persisten.
  const [inviteDismissed, setInviteDismissed] = useState(false);

  if (authLoading) return null;

  // Supabase kasih sesi sementara begitu link reset password di email
  // diklik — sengaja disela di sini SEBELUM cek !session, karena sesi itu
  // teknisnya valid dan kalau tidak disela user langsung masuk ke app
  // dengan sesi recovery tanpa sempat ganti password.
  if (isPasswordRecovery) return <ResetPasswordScreen onDone={clearPasswordRecovery} />;

  if (!session) return <AuthScreen inviteCode={inviteCode} forceDaftar={forceDaftar} signupSource={signupSource} />;

  // Review -c1: konfirmasi undangan WAJIB tampil begini pun akun ini
  // SUDAH punya business sendiri — device bisa dipakai gantian (lihat
  // catatan INVITE_MAX_AGE_MS di atas), jadi kode yang nyangkut dari
  // sesi SEBELUMNYA (mis. owner lupa logout, lalu staf lain login di HP
  // yang sama) tidak boleh diam-diam diabaikan ATAU diam-diam di-redeem
  // — harus selalu ditanya eksplisit, dicek SEBELUM gate `!business` di
  // bawah (bukan cuma untuk akun yang belum punya business).
  if (inviteCode && !inviteDismissed) {
    return (
      <InviteConfirmScreen
        session={session}
        code={inviteCode}
        onJoined={() => {
          clearInviteCode();
          setInviteCode(null);
          refreshBusiness();
        }}
        onDismiss={() => {
          clearInviteCode();
          setInviteCode(null);
          setInviteDismissed(true);
        }}
      />
    );
  }

  // Cuma blank total di load awal (belum ada data business sama sekali) —
  // refresh() dipanggil ulang setelah update (mis. simpan Info Usaha) juga
  // sempat men-set loading=true, dan kalau gate ini tidak dikecualikan pas
  // business sudah ada, seluruh app (termasuk form yang lagi diisi) blank
  // sekejap tiap kali refresh, bukan cuma di load awal.
  if (businessLoading && !business) return null;

  // Jangan jatuh ke OnboardingScreen di sini (lihat useBusiness.ts) —
  // error sungguhan (mis. akun ini ternyata anggota lebih dari satu
  // business) harus kelihatan sebagai error, bukan diam-diam ditawari
  // "bikin business baru" yang justru bisa menambah business ketiga
  // tanpa sadar. Penanganan minimal, bukan fitur pindah-bisnis.
  if (businessError) {
    // Pesan teknis dari Postgres/PostgREST (mis. "multiple rows returned")
    // disimpan di console buat dukungan/debug, tapi TIDAK ditampilkan
    // mentah-mentah ke vendor — bukan non-technical-friendly (CLAUDE.md
    // bagian 3).
    console.error('Gagal memuat business:', businessError);
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-[#F1EEE2]">
        <div className="w-full max-w-sm bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-sm p-6 text-center">
          <h2 className="text-lg font-bold text-[#A8412E]">Gagal Memuat Usaha</h2>
          <p className="text-xs text-[#6E6853] mt-2">
            Ada masalah saat memuat data usahamu. Coba muat ulang halaman ini.
          </p>
          <p className="text-xs text-[#6E6853] mt-2">
            Hubungi dukungan Sewalog kalau pesan ini terus muncul setelah dicoba lagi.
          </p>
          <button
            onClick={() => refreshBusiness()}
            className="w-full mt-4 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-sm transition active:scale-95"
          >
            Coba Lagi
          </button>
        </div>
      </main>
    );
  }

  if (!business) {
    // Tunggu status admin selesai dicek dulu sebelum memutuskan — tanpa
    // ini, admin tanpa business akan sempat kelihatan OnboardingScreen
    // sekejap lalu "lompat" ke AdminOnlyView begitu RPC is_app_admin()
    // selesai (race dua loading independen, lihat useIsAppAdmin.ts).
    if (isAppAdminLoading) return null;
    if (isAppAdmin) {
      return <AdminOnlyView session={session} onLogout={() => { clearAllBookingDraftsOnLogout(); supabase?.auth.signOut(); }} />;
    }
    return <OnboardingScreen referralCode={referralCode} onCreated={refreshBusiness} />;
  }

  // Brief 14 Nov 2026 (CLS SubscriptionBanner, Cloudflare Web Analytics)
  // — SubscriptionBanner di <main> di bawah return null selama
  // `subscription` masih null (lihat SubscriptionBanner.tsx), lalu
  // tiba-tiba render tinggi penuh begitu fetch-nya (useSubscription,
  // selalu SETELAH business.id ada, jadi sequential bukan paralel)
  // selesai — kalau statusnya butuh banner, itu geser semua konten tab
  // di bawahnya (CLS). Ditutup dengan gate yang sama persis polanya
  // dengan `businessLoading && !business` di atas (blank cuma di load
  // AWAL sekali, bukan tiap refresh — `subscriptionLoading` dari
  // useSubscription.ts SECARA ALAMI cuma `true` sekali di awal per
  // businessId, tidak ada `refresh()` subscription yang dipanggil dari
  // tempat lain). `business` di titik ini SUDAH DIPASTIKAN non-null
  // (sudah lewat gate `!business` di atas), jadi tidak perlu diulang di
  // sini. `!subscription` sebagai syarat tambahan (bukan cuma
  // `subscriptionLoading`) supaya kalau businessId berubah lagi nanti
  // (jarang, tapi tidak mustahil) dan subscription LAMA masih ada
  // sementara yang baru sedang dimuat, app tidak blank ulang — cukup
  // tampilkan data lama sebentar sampai yang baru siap.
  if (subscriptionLoading && !subscription) return null;

  function openNewBooking(itemId?: string, startDate?: string) {
    setPreselectedItemId(itemId ?? null);
    setPreselectedBundleId(null);
    setPreselectedStartDate(startDate ?? null);
    setIsNewBookingOpen(true);
  }

  // Kalender Ketersediaan, grup "Paket" (17 Nov 2026) -- jalur TERPISAH
  // dari openNewBooking() di atas, sama pola, beda state yang diisi.
  function openNewBookingBundle(bundleId: string, startDate?: string) {
    setPreselectedItemId(null);
    setPreselectedBundleId(bundleId);
    setPreselectedStartDate(startDate ?? null);
    setIsNewBookingOpen(true);
  }

  return (
    <div className="min-h-screen bg-[#F1EEE2] text-[#26302B] flex flex-col">
      <Navbar
        activeTab={tab}
        setActiveTab={setTab}
        onOpenNewBooking={() => openNewBooking()}
        businessName={business.name}
        role={role}
        onLogout={() => { clearAllBookingDraftsOnLogout(); supabase?.auth.signOut(); }}
        pendingRequestCount={pendingRequestCount}
        draftCount={draftCount}
        onOpenDrafts={() => setIsDraftListOpen(true)}
        writable={subscription?.writable ?? true}
        isAppAdmin={isAppAdmin}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-4">
        {isDemoAccount ? (
          // Temuan wawancara Wasup (24 Nov 2026): sempat memasukkan data
          // pelanggan ASLI ke akun demo publik -- demo ini bisa dilihat
          // DAN direset siapa saja (tombol "Reset data demo" di layar
          // login), jadi banner ini SELALU terlihat (bukan cuma sekali
          // dismiss) selama memakai akun demo.
          <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg px-3 py-2 flex flex-wrap items-center gap-1.5">
            <span>
              Akun demo bisa dilihat & di-reset siapa saja — jangan isi data pelanggan asli.
            </span>
            <button
              type="button"
              onClick={async () => {
                await supabase?.auth.signOut();
                window.location.href = '/?daftar=1';
              }}
              className="underline font-bold"
            >
              Daftar gratis untuk akun sendiri →
            </button>
          </p>
        ) : (
          <SubscriptionBanner subscription={subscription} isOwner={role === 'owner'} businessName={business.name} />
        )}
        {tab === 'kalender' && (
          <CalendarScreen
            key={`cal-${refreshSignal}`}
            session={session}
            businessId={business.id}
            onSelectBookItem={openNewBooking}
            onSelectBookBundle={openNewBookingBundle}
            pendingRequestCount={pendingRequestCount}
            onViewPendingRequests={() => setTab('tracking')}
            onViewOverdue={() => {
              setTrackingInitialFilter('overdue');
              setTab('tracking');
            }}
            onNavigateToGuide={(sectionId) => {
              requestGuideScroll(sectionId);
              setTab('panduan');
            }}
            writable={subscription?.writable ?? true}
          />
        )}
        {tab === 'tracking' && (
          <TrackingScreen
            key={`trk-${refreshSignal}`}
            session={session}
            business={business}
            businessName={business.name}
            businessAddress={business.address}
            businessLogoUrl={business.logo_url}
            writable={subscription?.writable ?? true}
            initialFilter={trackingInitialFilter ?? undefined}
            onNavigateToGuide={(sectionId) => {
              requestGuideScroll(sectionId);
              setTab('panduan');
            }}
          />
        )}
        {tab === 'alat' && <ItemsScreen businessId={business.id} session={session} role={role} writable={subscription?.writable ?? true} />}
        {tab === 'pelanggan' && (
          <CustomersScreen
            session={session}
            businessId={business.id}
            role={role}
            businessName={business.name}
            businessAddress={business.address}
            businessLogoUrl={business.logo_url}
          />
        )}
        {tab === 'tim' && role === 'owner' && (
          <TeamScreen session={session} businessId={business.id} business={business} onSaveBusiness={updateBusiness} writable={subscription?.writable ?? true} />
        )}
        {tab === 'riwayat' && role === 'owner' && (
          <HistoryScreen
            businessId={business.id}
            session={session}
            businessName={business.name}
            businessAddress={business.address}
            businessLogoUrl={business.logo_url}
          />
        )}
        {tab === 'etalase-online' && role === 'owner' && (
          <EtalaseOnlineScreen
            session={session}
            businessId={business.id}
            businessName={business.name}
            businessPhone={business.phone}
            businessAddress={business.address}
          />
        )}
        {tab === 'toko-online' && role === 'owner' && <OnlineStoreScreen businessName={business.name} />}
        {tab === 'panduan' && <GuideScreen businessName={business.name} />}
        {tab === 'admin' && isAppAdmin && <AdminScreen session={session} />}
        {tab === 'langganan' && role === 'owner' && (
          <LanggananScreen
            session={session}
            businessId={business.id}
            businessName={business.name}
            businessCreatedAt={business.created_at}
            referralCode={business.referral_code}
            subscription={subscription}
            isDemoAccount={isDemoAccount}
          />
        )}
      </main>

      {isNewBookingOpen && (
        <NewBookingModal
          isOpen={isNewBookingOpen}
          onClose={() => {
            setIsNewBookingOpen(false);
            setResumeDraftId(null);
          }}
          session={session}
          business={business}
          preselectedItemId={preselectedItemId}
          preselectedBundleId={preselectedBundleId}
          preselectedStartDate={preselectedStartDate}
          draftId={resumeDraftId}
          onSaved={() => {
            setIsNewBookingOpen(false);
            setResumeDraftId(null);
            setRefreshSignal((n) => n + 1);
          }}
          requestPrefill={null}
          writable={subscription?.writable ?? true}
        />
      )}

      <DraftListModal
        isOpen={isDraftListOpen}
        onClose={() => setIsDraftListOpen(false)}
        businessId={business.id}
        onResume={(draftId) => {
          setPreselectedItemId(null);
          setPreselectedBundleId(null);
          setPreselectedStartDate(null);
          setResumeDraftId(draftId);
          setIsNewBookingOpen(true);
        }}
        onChanged={() => setDraftListTick((t) => t + 1)}
      />

      <footer className="bg-[#1E3429] border-t border-[#3A5C4A] text-[#DBD5C1] text-xs py-4 px-4 text-center">
        <p className="font-semibold text-[#FBFAF4]">Aplikasi Operasional UKM Rental Camping se-Indonesia</p>
      </footer>
    </div>
  );
}

export default App;
