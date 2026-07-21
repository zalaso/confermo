import { useEffect, useState } from 'react';
import type { ClinicDto } from '@confermo/shared';
import { get, post, UnauthorizedError } from './api';
import { ErrorBoundary, ErrorNotice } from './components';
import { DemoBar } from './DemoBar';
import { Login } from './pages/Login';
import { Agenda } from './pages/Agenda';
import { Pazienti } from './pages/Pazienti';
import { Statistiche } from './pages/Statistiche';
import { Impostazioni } from './pages/Impostazioni';

type Page = 'agenda' | 'pazienti' | 'statistiche' | 'impostazioni';

const PAGES: { id: Page; label: string; short: string }[] = [
  { id: 'agenda', label: '📅 Agenda', short: '📅' },
  { id: 'pazienti', label: '👤 Pazienti', short: '👤' },
  { id: 'statistiche', label: '📊 Statistiche', short: '📊' },
  { id: 'impostazioni', label: '⚙️ Impostazioni', short: '⚙️' },
];

export function App() {
  const [clinic, setClinic] = useState<ClinicDto | null>(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('agenda');

  const loadSession = async () => {
    setLoadError(null);
    try {
      const me = await get<{ clinic: ClinicDto }>('/auth/me');
      setClinic(me.clinic);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setClinic(null);
      } else {
        // errore di rete: non buttare fuori l'utente, offri "Riprova"
        setLoadError(
          err instanceof Error ? err.message : 'Impossibile contattare il server. Controlla la connessione.',
        );
      }
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void loadSession();
  }, []);

  if (checking) return <div className="centered muted">Caricamento…</div>;

  if (loadError && !clinic) {
    return (
      <div className="centered">
        <ErrorNotice message={loadError} onRetry={() => void loadSession()} />
      </div>
    );
  }

  if (!clinic) return <Login onLoggedIn={() => void loadSession()} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">✓</span>
          <span className="brand-name">Confermo</span>
          <span className="clinic-name">{clinic.name}</span>
        </div>
        <nav className="nav">
          {PAGES.map((p) => (
            <button
              key={p.id}
              className={`nav-btn ${page === p.id ? 'active' : ''}`}
              onClick={() => setPage(p.id)}
              aria-current={page === p.id ? 'page' : undefined}
            >
              <span className="nav-label-full">{p.label}</span>
              <span className="nav-label-short" aria-hidden="true">
                {p.short}
              </span>
            </button>
          ))}
          <button
            className="nav-btn logout"
            onClick={async () => {
              await post('/auth/logout');
              setClinic(null);
            }}
          >
            Esci
          </button>
        </nav>
      </header>

      {clinic.demoMode && <DemoBar clinic={clinic} onReset={() => void loadSession()} />}

      <main className="content">
        <ErrorBoundary key={page}>
          {page === 'agenda' && <Agenda clinic={clinic} />}
          {page === 'pazienti' && <Pazienti />}
          {page === 'statistiche' && <Statistiche />}
          {page === 'impostazioni' && <Impostazioni clinic={clinic} onClinicChanged={() => void loadSession()} />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
