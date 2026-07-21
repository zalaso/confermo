import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  INBOUND_KIND_LABELS,
  VISIT_TYPE_MAX_LENGTH,
  type AppointmentDto,
  type ClinicDto,
  type CsvImportReport,
  type InboundMessageDto,
  type PatientDto,
} from '@confermo/shared';
import { patch, post } from '../api';
import { usePolling } from '../hooks';
import { ErrorNotice, Modal, PhoneMockup, ReminderPills, Skeleton, StatusBadge } from '../components';

type Filter = 'oggi' | 'settimana' | 'futuri' | 'passati';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function queryFor(filter: Filter): string {
  const today = new Date();
  switch (filter) {
    case 'oggi':
      return `?from=${isoDate(today)}&to=${isoDate(today)}`;
    case 'settimana': {
      const end = new Date(today.getTime() + 7 * 86400_000);
      return `?from=${isoDate(today)}&to=${isoDate(end)}`;
    }
    case 'futuri':
      return `?from=${isoDate(today)}`;
    case 'passati': {
      const yesterday = new Date(today.getTime() - 86400_000);
      return `?to=${isoDate(yesterday)}`;
    }
  }
}

export function Agenda({ clinic }: { clinic: ClinicDto }) {
  const [filter, setFilter] = useState<Filter>('settimana');
  const [showNew, setShowNew] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [phoneFor, setPhoneFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, error, loading, refetch } = usePolling<AppointmentDto[]>(`/appointments${queryFor(filter)}`);

  const groups = useMemo(() => {
    const byDay = new Map<string, AppointmentDto[]>();
    for (const a of data ?? []) {
      const list = byDay.get(a.localDate) ?? [];
      list.push(a);
      byDay.set(a.localDate, list);
    }
    return [...byDay.entries()];
  }, [data]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setActionError(null);
    setBusyId(id);
    try {
      await fn();
      await refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = (a: AppointmentDto, status: string) =>
    act(a.id, () => patch(`/appointments/${a.id}`, { status }));

  return (
    <div>
      <div className="page-head">
        <div className="filters">
          {(
            [
              ['oggi', 'Oggi'],
              ['settimana', 'Prossimi 7 giorni'],
              ['futuri', 'Tutti i futuri'],
              ['passati', 'Passati'],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={`chip ${filter === id ? 'active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setShowCsv(true)}>
            ⬆ Importa CSV
          </button>
          <button className="btn primary" onClick={() => setShowNew(true)}>
            + Nuovo appuntamento
          </button>
        </div>
      </div>

      {actionError && <ErrorNotice message={actionError} />}

      <InboundAttentionBanner />

      {loading && !data && <Skeleton rows={3} />}

      {error && !data && <ErrorNotice message={error} onRetry={() => void refetch()} />}

      {data && groups.length === 0 && (
        <p className="muted empty">Nessun appuntamento in questo periodo.</p>
      )}

      {groups.map(([day, appointments]) => (
        <section key={day} className="day-group">
          <h2 className="day-title">{formatDayTitle(day)}</h2>
          {appointments.map((a) => {
            const isPast = new Date(a.startsAt) < new Date();
            const active = a.status === 'scheduled' || a.status === 'confirmed';
            const busy = busyId === a.id;
            const canPreview =
              clinic.demoMode && a.patient.privacyConsentAt !== null && a.patient.optedOutAt === null;
            return (
              <article key={a.id} className={`card appointment status-border-${a.status}`}>
                <div className="appt-main">
                  <div className="appt-time">{a.localTime}</div>
                  <div className="appt-info">
                    <div className="appt-name">
                      {a.patient.firstName} {a.patient.lastName}
                      {a.patient.optedOutAt !== null ? (
                        <span className="pill pill-error" title="Ha chiesto di non ricevere messaggi">
                          non vuole messaggi
                        </span>
                      ) : (
                        a.patient.privacyConsentAt === null && (
                          <span
                            className="pill pill-error"
                            title="Senza consenso privacy non vengono inviati messaggi"
                          >
                            senza consenso
                          </span>
                        )
                      )}
                    </div>
                    <div className="appt-detail muted">
                      {a.visitType} · {a.durationMin} min · {a.patient.phone}
                    </div>
                    <ReminderPills reminders={a.reminders} />
                  </div>
                  <div className="appt-side">
                    <StatusBadge status={a.status} />
                    <div className="appt-actions">
                      {canPreview && (
                        <button className="btn small demo-action" onClick={() => setPhoneFor(a.id)}>
                          📱 Messaggio
                        </button>
                      )}
                      {active && !isPast && (
                        <button
                          className="btn small danger-outline"
                          disabled={busy}
                          onClick={() => setStatus(a, 'cancelled')}
                        >
                          Disdici
                        </button>
                      )}
                      {active && isPast && (
                        <>
                          <button className="btn small ok" disabled={busy} onClick={() => setStatus(a, 'completed')}>
                            Venuto
                          </button>
                          <button className="btn small danger" disabled={busy} onClick={() => setStatus(a, 'no_show')}>
                            Non venuto
                          </button>
                        </>
                      )}
                      {a.status === 'cancelled' && !isPast && (
                        <button className="btn small" disabled={busy} onClick={() => setStatus(a, 'scheduled')}>
                          Riattiva
                        </button>
                      )}
                      {a.status === 'no_show' && (
                        <button className="btn small ghost" disabled={busy} onClick={() => setStatus(a, 'completed')}>
                          Correggi: venuto
                        </button>
                      )}
                      {a.status === 'completed' && (
                        <button className="btn small ghost" disabled={busy} onClick={() => setStatus(a, 'no_show')}>
                          Correggi: non venuto
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ))}

      {phoneFor && (
        <PhoneMockup
          appointmentId={phoneFor}
          onClose={() => setPhoneFor(null)}
          onChanged={() => void refetch()}
        />
      )}

      {showNew && (
        <NewAppointmentModal
          clinic={clinic}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void refetch();
          }}
        />
      )}
      {showCsv && (
        <CsvImportModal onClose={() => setShowCsv(false)} onImported={() => void refetch()} />
      )}
    </div>
  );
}

/** Messaggi WhatsApp in ingresso che richiedono la segreteria (testo libero, disdette). */
function InboundAttentionBanner() {
  const { data, refetch } = usePolling<InboundMessageDto[]>('/inbound?onlyAttention=true', 15_000);
  if (!data || data.length === 0) return null;
  return (
    <div className="card attention-banner">
      <h2 className="section-title">📥 Messaggi da gestire ({data.length})</h2>
      {data.map((m) => (
        <div key={m.id} className="attention-row">
          <div className="attention-info">
            <strong>{m.patientName ?? m.fromMasked}</strong>{' '}
            <span className="pill pill-warn">{INBOUND_KIND_LABELS[m.kind]}</span>
            {m.body && <div className="attention-body">«{m.body}»</div>}
            <div className="muted small-note">{new Date(m.createdAt).toLocaleString('it-IT')}</div>
          </div>
          <button
            className="btn small"
            onClick={async () => {
              await post(`/inbound/${m.id}/handled`);
              await refetch();
            }}
          >
            ✓ Gestito
          </button>
        </div>
      ))}
    </div>
  );
}

function formatDayTitle(localDate: string): string {
  const [d, m, y] = localDate.split('/');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const formatted = date.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return (isToday ? 'Oggi — ' : '') + formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function NewAppointmentModal({
  clinic,
  onClose,
  onCreated,
}: {
  clinic: ClinicDto;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: patients } = usePolling<PatientDto[]>('/patients', 60_000);
  const [patientId, setPatientId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [durationMin, setDurationMin] = useState(30);
  const [visitType, setVisitType] = useState(clinic.appointmentTypes[0] ?? 'Controllo');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/appointments', { patientId, date, time, durationMin, visitType });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Nuovo appuntamento" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Paziente
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)} required>
            <option value="">— Scegli il paziente —</option>
            {(patients ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.lastName} {p.firstName} · {p.phone}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Giorno
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Ora
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </label>
        </div>
        <div className="form-row">
          <label>
            Durata
            <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} minuti
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo di appuntamento
            <input
              value={visitType}
              onChange={(e) => setVisitType(e.target.value)}
              list="tipi-appuntamento"
              maxLength={VISIT_TYPE_MAX_LENGTH}
              required
            />
            <datalist id="tipi-appuntamento">
              {clinic.appointmentTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
        </div>
        <p className="privacy-note">
          🔒 Usa etichette generiche (es. «Controllo»). Non inserire diagnosi, patologie o altre
          informazioni cliniche: questo campo non è un dato sanitario e non deve diventarlo.
        </p>
        <p className="muted small-note">Se manca il paziente, crealo prima dalla pagina «Pazienti».</p>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? 'Salvataggio…' : 'Salva appuntamento'}
        </button>
      </form>
    </Modal>
  );
}

function CsvImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<CsvImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const csv = await file.text();
      const r = await post<CsvImportReport>('/appointments/import-csv', { csv });
      setReport(r);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Importa appuntamenti da CSV" onClose={onClose}>
      <p className="muted">
        Il file deve avere queste colonne (prima riga):
        <br />
        <code>nome;cognome;telefono;data;ora;durata_minuti;tipo_visita;consenso_privacy</code>
        <br />
        Esempio riga: <code>Mario;Rossi;333 1234567;21/07/2026;15:30;30;Controllo;si</code>
      </p>
      <p className="privacy-note">
        🔒 Nella colonna <code>tipo_visita</code> usa etichette generiche: niente diagnosi o informazioni
        cliniche. Testi più lunghi di {VISIT_TYPE_MAX_LENGTH} caratteri vengono accorciati.
      </p>
      <form className="form" onSubmit={submit}>
        <input type="file" accept=".csv,text/csv" ref={fileRef} required />
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? 'Importazione…' : 'Importa'}
        </button>
      </form>
      {report && (
        <div className="import-report">
          <p>
            ✅ {report.createdAppointments} appuntamenti importati
            {report.createdPatients > 0 && <> · {report.createdPatients} nuovi pazienti</>}
          </p>
          {report.errors.length > 0 && (
            <div>
              <p className="error-text">{report.errors.length} righe con problemi:</p>
              <ul className="error-list">
                {report.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>
                    Riga {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
