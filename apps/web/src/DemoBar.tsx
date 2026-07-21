import { useState } from 'react';
import type { ClinicDto } from '@confermo/shared';
import { post } from './api';

const PRESETS = [
  { id: 'dentista', label: 'Studio dentistico' },
  { id: 'poliambulatorio', label: 'Poliambulatorio' },
  { id: 'fisioterapia', label: 'Fisioterapia' },
];

/**
 * Pannello di controllo della presentazione, visibile solo per uno studio in
 * modalità demo. Serve a preparare la visita successiva in pochi secondi:
 * cambia il nome dello studio che si sta visitando, il tipo di attività e
 * azzera i dati.
 */
export function DemoBar({ clinic, onReset }: { clinic: ClinicDto; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(clinic.name);
  const [preset, setPreset] = useState('dentista');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/demo/reset', { name: name.trim() || clinic.name, preset });
      setOpen(false);
      onReset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="demo-bar">
      <div className="demo-bar-inner">
        <span className="demo-pill">MODALITÀ DEMO</span>
        <span className="demo-bar-text">Nessun messaggio viene inviato davvero.</span>
        <button className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? 'Chiudi' : 'Prepara demo'}
        </button>
      </div>

      {open && (
        <div className="demo-bar-panel">
          <label>
            Nome dello studio da mostrare
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Studio Dentistico Rossi" />
          </label>
          <label>
            Tipo di attività
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="demo-bar-actions">
            <button className="btn primary" onClick={reset} disabled={busy}>
              {busy ? 'Azzeramento…' : '🔄 Azzera e ricarica i dati'}
            </button>
            <span className="muted small-note">
              Ricrea agenda e statistiche da zero. Richiede un paio di secondi.
            </span>
          </div>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </div>
  );
}
