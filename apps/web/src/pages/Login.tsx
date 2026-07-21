import { useState, type FormEvent } from 'react';
import { post } from '../api';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { email, password });
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <form className="card login-card" onSubmit={submit}>
        <h1 className="login-title">
          <span className="brand-logo">✓</span> Confermo
        </h1>
        <p className="muted">Accesso riservato allo studio</p>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? 'Accesso in corso…' : 'Entra'}
        </button>
      </form>
    </div>
  );
}
