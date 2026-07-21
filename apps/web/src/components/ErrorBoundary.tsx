import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Rete di sicurezza per la demo: qualsiasi errore imprevisto
 * dell'interfaccia mostra un messaggio in italiano invece di una schermata
 * bianca o di uno stack trace davanti al cliente.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Errore non gestito nell’interfaccia:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="centered">
        <div className="card login-card">
          <h1 className="login-title">Qualcosa è andato storto</h1>
          <p className="muted">
            Si è verificato un problema nel mostrare questa pagina. I dati non sono stati persi.
          </p>
          <button className="btn primary big" onClick={() => window.location.reload()}>
            Ricarica la pagina
          </button>
          <button className="btn ghost" onClick={() => this.setState({ error: null })}>
            Torna indietro
          </button>
        </div>
      </div>
    );
  }
}
