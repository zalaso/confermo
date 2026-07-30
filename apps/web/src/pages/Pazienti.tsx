import { useState, type FormEvent } from 'react';
import type { PatientDto } from '@confermo/shared';
import { del, patch, post } from '../api';
import { usePolling } from '../hooks';
import { Modal } from '../components';

export function Pazienti() {
  const [search, setSearch] = useState('');
  const { data, refetch } = usePolling<PatientDto[]>(
    `/patients${search ? `?q=${encodeURIComponent(search)}` : ''}`,
    30_000,
  );
  const [editing, setEditing] = useState<PatientDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PatientDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <div className="page-head">
        <input
          className="search"
          placeholder="🔍 Cerca per nome o telefono…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn primary" onClick={() => setEditing('new')}>
          + Nuovo paziente
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Cognome e nome</th>
              <th>Telefono</th>
              <th>Consenso privacy</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((p) => (
              <tr key={p.id}>
                <td className="strong">
                  {p.lastName} {p.firstName}
                </td>
                <td>{p.phone}</td>
                <td>
                  {p.optedOutAt ? (
                    <span className="pill pill-error" title="Il paziente ha scritto STOP: nessun invio">
                      ✋ non vuole messaggi
                    </span>
                  ) : p.privacyConsentAt ? (
                    <span className="pill pill-ok">✓ dato</span>
                  ) : (
                    <span className="pill pill-error">mancante — niente messaggi</span>
                  )}
                </td>
                <td className="row-actions">
                  <button className="btn small" onClick={() => setEditing(p)}>
                    Modifica
                  </button>
                  <button className="btn small danger-outline" onClick={() => setDeleting(p)}>
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
            {(data ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="muted empty">
                  Nessun paziente trovato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <PatientModal
          patient={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}

      {deleting && (
        <Modal title="Eliminare il paziente?" onClose={() => setDeleting(null)}>
          <p>
            Stai per eliminare <strong>{deleting.firstName} {deleting.lastName}</strong> e{' '}
            <strong>tutti i suoi appuntamenti e messaggi</strong>, in modo definitivo
            (cancellazione completa richiesta dal GDPR).
          </p>
          <p className="error-text">Questa operazione non si può annullare.</p>
          <div className="form-row">
            <button className="btn" onClick={() => setDeleting(null)}>
              Annulla
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                setError(null);
                try {
                  await del(`/patients/${deleting.id}`);
                  setDeleting(null);
                  await refetch();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Errore imprevisto');
                  setDeleting(null);
                }
              }}
            >
              Elimina definitivamente
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PatientModal({
  patient,
  onClose,
  onSaved,
}: {
  patient: PatientDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(patient?.firstName ?? '');
  const [lastName, setLastName] = useState(patient?.lastName ?? '');
  const [phone, setPhone] = useState(patient?.phone ?? '');
  const [privacyConsent, setPrivacyConsent] = useState(patient ? patient.privacyConsentAt !== null : false);
  const [optedOut, setOptedOut] = useState(patient?.optedOutAt !== null && patient?.optedOutAt !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { firstName, lastName, phone, privacyConsent };
    try {
      if (patient) await patch(`/patients/${patient.id}`, { ...body, optedOut });
      else await post('/patients', body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={patient ? 'Modifica paziente' : 'Nuovo paziente'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label>
            Nome
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </label>
          <label>
            Cognome
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </label>
        </div>
        <label>
          Telefono cellulare (per WhatsApp)
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="es. 333 1234567"
            required
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={privacyConsent}
            onChange={(e) => setPrivacyConsent(e.target.checked)}
          />
          Il paziente ha firmato il consenso privacy per ricevere promemoria
        </label>

        {patient && (
          <div className={optedOut ? 'optout-box active' : 'optout-box'}>
            <label className="checkbox">
              <input type="checkbox" checked={optedOut} onChange={(e) => setOptedOut(e.target.checked)} />
              <strong>Il paziente non vuole ricevere messaggi</strong>
            </label>
            {patient.optedOutAt !== null && (
              <p className="muted small-note">
                Ha risposto STOP il {new Date(patient.optedOutAt).toLocaleDateString('it-IT')}. Togli la
                spunta solo se ha chiesto espressamente di ricevere di nuovo i promemoria: serve anche il
                consenso privacy qui sopra.
              </p>
            )}
            {patient.optedOutAt === null && (
              <p className="muted small-note">
                Spunta questa casella se il paziente ha chiesto a voce di non ricevere più promemoria.
              </p>
            )}
          </div>
        )}
        <p className="muted small-note">
          Senza consenso il paziente resta in archivio ma non riceve nessun messaggio.
        </p>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? 'Salvataggio…' : 'Salva'}
        </button>
      </form>
    </Modal>
  );
}
