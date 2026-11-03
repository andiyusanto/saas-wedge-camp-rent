import { useEffect, useState } from 'react';
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
import { AuthScreen } from './components/AuthScreen';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { InviteConfirmScreen } from './components/RedeemInviteScreen';
import { ItemsScreen } from './components/ItemsScreen';
import { CalendarScreen } from './components/CalendarScreen';
import { NewBookingModal } from './components/NewBookingModal';
import { TrackingScreen } from './components/TrackingScreen';
import { TeamScreen } from './components/TeamScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { GuideScreen } from './components/GuideScreen';
import { OnlineStoreScreen } from './components/OnlineStoreScreen';
import { EtalaseOnlineScreen } from './components/EtalaseOnlineScreen';
import { Navbar } from './components/Navbar';
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
  const [tab, setTab] = useState<Tab>('kalender');
  const [refreshSignal, setRefreshSignal] = useState(0);
  // Badge tab + banner Kalender (rencana 2.4 bagian B+C) — instance
  // terpisah dari yang dipakai TrackingScreen sendiri (poll ringan
  // masing-masing, bukan realtime, lihat useBookingRequests.ts) supaya
  // badge/banner tetap jalan walau belum pernah membuka tab Transaksi
  // Aktif sama sekali.
  const { pendingCount: pendingRequestCount } = useBookingRequests(business?.id ?? null);
  const { subscription } = useSubscription(business?.id ?? null);
  const { isAdmin: isAppAdmin } = useIsAppAdmin(session);
  const isDemoAccount = isDemoAccountEmail(session?.user.email);

  // Jaring pengaman kalau karyawan sempat berada di tab owner-only (mis.
  // baru saja diturunkan dari owner ke karyawan oleh pemilik lain) — Navbar
  // sendiri sudah menyembunyikan tab-nya, ini cuma jaga-jaga isi <main>.
  useEffect(() => {
    if (
      (tab === 'tim' || tab === 'riwayat' || tab === 'etalase-online' || tab === 'toko-online' || tab === 'langganan') &&
      role !== null &&
      role !== 'owner'
    ) {
      setTab('kalender');
    }
    // Admin bisa diturunkan dari app_admins sewaktu-waktu — kalau sedang
    // di tab Alat Admin dan statusnya sudah dipastikan bukan admin,
    // jangan diam-diam ditinggal di tab yang isinya sudah tidak relevan.
    if (tab === 'admin' && !isAppAdmin) {
      setTab('kalender');
    }
  }, [tab, role, isAppAdmin]);

  const [isNewBookingOpen, setIsNewBookingOpen] = useState(false);
  const [preselectedItemId, setPreselectedItemId] = useState<string | null>(null);
  const [preselectedStartDate, setPreselectedStartDate] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState<string | null>(readInviteCode);
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

  if (!session) return <AuthScreen inviteCode={inviteCode} />;

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
    return <OnboardingScreen onCreated={refreshBusiness} />;
  }

  function openNewBooking(itemId?: string, startDate?: string) {
    setPreselectedItemId(itemId ?? null);
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
        onLogout={() => supabase?.auth.signOut()}
        pendingRequestCount={pendingRequestCount}
        writable={subscription?.writable ?? true}
        isAppAdmin={isAppAdmin}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-4">
        {!isDemoAccount && (
          <SubscriptionBanner subscription={subscription} isOwner={role === 'owner'} businessName={business.name} />
        )}
        {tab === 'kalender' && (
          <CalendarScreen
            key={`cal-${refreshSignal}`}
            session={session}
            onSelectBookItem={openNewBooking}
            pendingRequestCount={pendingRequestCount}
            onViewPendingRequests={() => setTab('tracking')}
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
          />
        )}
        {tab === 'alat' && <ItemsScreen businessId={business.id} session={session} role={role} writable={subscription?.writable ?? true} />}
        {tab === 'tim' && role === 'owner' && (
          <TeamScreen session={session} businessId={business.id} business={business} onSaveBusiness={updateBusiness} writable={subscription?.writable ?? true} />
        )}
        {tab === 'riwayat' && role === 'owner' && <HistoryScreen businessId={business.id} />}
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
        {tab === 'admin' && isAppAdmin && <AdminScreen />}
        {tab === 'langganan' && role === 'owner' && (
          <LanggananScreen
            businessId={business.id}
            businessName={business.name}
            businessCreatedAt={business.created_at}
            subscription={subscription}
            isDemoAccount={isDemoAccount}
          />
        )}
      </main>

      {isNewBookingOpen && (
        <NewBookingModal
          isOpen={isNewBookingOpen}
          onClose={() => setIsNewBookingOpen(false)}
          session={session}
          business={business}
          preselectedItemId={preselectedItemId}
          preselectedStartDate={preselectedStartDate}
          onSaved={() => {
            setIsNewBookingOpen(false);
            setRefreshSignal((n) => n + 1);
          }}
          requestPrefill={null}
          writable={subscription?.writable ?? true}
        />
      )}

      <footer className="bg-[#1E3429] border-t border-[#3A5C4A] text-[#DBD5C1] text-xs py-4 px-4 text-center">
        <p className="font-semibold text-[#FBFAF4]">
          Sewalog — SaaS Operational Tools UKM Rental Camping Malang Raya
        </p>
        <p className="text-[11px] text-[#DBD5C1]/70 mt-0.5">
          Aturan denda keterlambatan vs kerusakan dipisah eksplisit • Isolasi data multi-tenant • Malang, Jawa Timur
        </p>
      </footer>
    </div>
  );
}

export default App;
