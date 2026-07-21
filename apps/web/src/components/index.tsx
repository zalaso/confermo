import { useEffect } from 'react';
import { STATUS_LABELS, type AppointmentStatus, type ReminderDto } from '@confermo/shared';

export { PhoneMockup } from './PhoneMockup';
export { ErrorBoundary } from './ErrorBoundary';

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

/** Riassunto leggibile dei promemoria, senza gergo tecnico. */
export function ReminderPills({ reminders }: { reminders: ReminderDto[] }) {
  return (
    <div className="reminder-pills">
      {reminders.map((r) => {
        const label = r.kind === 'reminder_48h' ? '48 ore' : '3 ore';
        let text: string;
        let cls: string;
        if (r.response === 'confirmed') {
          text = `${label}: ha confermato ✓`;
          cls = 'ok';
        } else if (r.response === 'cancel_requested') {
          text = `${label}: chiede di disdire`;
          cls = 'warn';
        } else if (r.status === 'sent') {
          text = `${label}: inviato, in attesa di risposta`;
          cls = 'sent';
        } else if (r.status === 'pending') {
          text = `${label}: verrà inviato`;
          cls = 'future';
        } else if (r.status === 'failed') {
          text = `${label}: invio non riuscito`;
          cls = 'error';
        } else if (r.status === 'failed_template') {
          text = `${label}: modello non approvato`;
          cls = 'error';
        } else if (r.status === 'failed_recipient') {
          text = `${label}: numero non su WhatsApp`;
          cls = 'error';
        } else if (r.status === 'failed_rate_limit') {
          text = `${label}: limite invii superato`;
          cls = 'error';
        } else {
          text = `${label}: non previsto`;
          cls = 'off';
        }
        return (
          <span key={r.id} className={`pill pill-${cls}`} title={`Promemoria ${label}`}>
            {text}
          </span>
        );
      })}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Segnaposto animato mostrato mentre i dati arrivano (rete mobile lenta). */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Caricamento in corso">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card skeleton-card">
          <div className="skeleton-line" style={{ width: '30%' }} />
          <div className="skeleton-line" style={{ width: '70%' }} />
          <div className="skeleton-line" style={{ width: '50%' }} />
        </div>
      ))}
    </div>
  );
}

/** Messaggio di errore leggibile, con possibilità di riprovare. */
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card error-notice">
      <p className="error-text">⚠️ {message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Riprova
        </button>
      )}
    </div>
  );
}
