import { useState } from 'react';
import { supabase } from './lib/supabaseClient';
import { useAuth } from './hooks/useAuth';
import { useBusiness } from './hooks/useBusiness';
import { AuthScreen } from './components/AuthScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { ItemsScreen } from './components/ItemsScreen';
import { CalendarScreen } from './components/CalendarScreen';
import { TransactionScreen } from './components/TransactionScreen';
import { TrackingScreen } from './components/TrackingScreen';
import './App.css';

type Tab = 'kalender' | 'transaksi' | 'tracking' | 'alat';

function App() {
  const { session, loading: authLoading } = useAuth();
  const { business, loading: businessLoading, refresh: refreshBusiness } = useBusiness(session);
  const [tab, setTab] = useState<Tab>('kalender');

  if (authLoading) return null;

  if (!session) return <AuthScreen />;

  if (businessLoading) return null;

  if (!business) return <OnboardingScreen onCreated={refreshBusiness} />;

  return (
    <main className="app-shell">
      <div className="app-shell__brand">
        <img src="/logo.svg" alt="" width="40" height="40" />
        <div>
          <h1>Sewalog</h1>
          <p className="app-shell__subtitle" style={{ marginBottom: 0 }}>
            {business.name}
          </p>
        </div>
      </div>

      <nav className="tab-nav">
        <button
          className={tab === 'kalender' ? 'tab-nav__item tab-nav__item--active' : 'tab-nav__item'}
          onClick={() => setTab('kalender')}
        >
          Kalender
        </button>
        <button
          className={tab === 'transaksi' ? 'tab-nav__item tab-nav__item--active' : 'tab-nav__item'}
          onClick={() => setTab('transaksi')}
        >
          Catat Transaksi
        </button>
        <button
          className={tab === 'tracking' ? 'tab-nav__item tab-nav__item--active' : 'tab-nav__item'}
          onClick={() => setTab('tracking')}
        >
          Jaminan &amp; Denda
        </button>
        <button
          className={tab === 'alat' ? 'tab-nav__item tab-nav__item--active' : 'tab-nav__item'}
          onClick={() => setTab('alat')}
        >
          Kelola Alat
        </button>
        <button className="tab-nav__item tab-nav__logout" onClick={() => supabase?.auth.signOut()}>
          Keluar
        </button>
      </nav>

      {tab === 'kalender' && <CalendarScreen session={session} />}
      {tab === 'transaksi' && <TransactionScreen session={session} businessId={business.id} />}
      {tab === 'tracking' && <TrackingScreen session={session} />}
      {tab === 'alat' && <ItemsScreen businessId={business.id} />}
    </main>
  );
}

export default App;
