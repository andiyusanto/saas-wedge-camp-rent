import { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient';
import { useAuth } from './hooks/useAuth';
import { useBusiness } from './hooks/useBusiness';
import { AuthScreen } from './components/AuthScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { RedeemInviteScreen } from './components/RedeemInviteScreen';
import { ItemsScreen } from './components/ItemsScreen';
import { CalendarScreen } from './components/CalendarScreen';
import { NewBookingModal } from './components/NewBookingModal';
import { TrackingScreen } from './components/TrackingScreen';
import { TeamScreen } from './components/TeamScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { GuideScreen } from './components/GuideScreen';
import { Navbar } from './components/Navbar';
import type { Tab } from './components/Navbar';

function readInviteCodeFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('invite');
}

function clearInviteCodeFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState({}, '', url.toString());
}

function App() {
  const { session, loading: authLoading } = useAuth();
  const { business, role, loading: businessLoading, refresh: refreshBusiness } = useBusiness(session);
  const [tab, setTab] = useState<Tab>('kalender');
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Jaring pengaman kalau karyawan sempat berada di tab owner-only (mis.
  // baru saja diturunkan dari owner ke karyawan oleh pemilik lain) — Navbar
  // sendiri sudah menyembunyikan tab-nya, ini cuma jaga-jaga isi <main>.
  useEffect(() => {
    if ((tab === 'tim' || tab === 'riwayat') && role !== null && role !== 'owner') {
      setTab('kalender');
    }
  }, [tab, role]);

  const [isNewBookingOpen, setIsNewBookingOpen] = useState(false);
  const [preselectedItemId, setPreselectedItemId] = useState<string | null>(null);
  const [preselectedStartDate, setPreselectedStartDate] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState<string | null>(readInviteCodeFromUrl);
  const [inviteSkipped, setInviteSkipped] = useState(false);

  if (authLoading) return null;

  if (!session) return <AuthScreen inviteCode={inviteCode} />;

  if (businessLoading) return null;

  if (!business) {
    if (inviteCode && !inviteSkipped) {
      return (
        <RedeemInviteScreen
          session={session}
          code={inviteCode}
          onJoined={() => {
            clearInviteCodeFromUrl();
            setInviteCode(null);
            refreshBusiness();
          }}
          onSkip={() => setInviteSkipped(true)}
        />
      );
    }
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
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12">
        {tab === 'kalender' && (
          <CalendarScreen key={`cal-${refreshSignal}`} session={session} onSelectBookItem={openNewBooking} />
        )}
        {tab === 'tracking' && (
          <TrackingScreen key={`trk-${refreshSignal}`} session={session} businessName={business.name} />
        )}
        {tab === 'alat' && <ItemsScreen businessId={business.id} session={session} />}
        {tab === 'tim' && role === 'owner' && <TeamScreen session={session} businessId={business.id} />}
        {tab === 'riwayat' && role === 'owner' && <HistoryScreen businessId={business.id} />}
        {tab === 'panduan' && <GuideScreen businessName={business.name} />}
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
