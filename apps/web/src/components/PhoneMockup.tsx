import { useCallback, useEffect, useState } from 'react';
import type { DemoConversationDto } from '@confermo/shared';
import { get, post } from '../api';

/**
 * Il telefono del paziente, mostrato accanto all'agenda durante la demo.
 *
 * Il testo delle bolle NON è ricostruito qui: arriva dall'outbox del
 * MockProvider, cioè è letteralmente il messaggio che il sistema ha prodotto.
 * I pulsanti chiamano lo stesso percorso di una risposta reale via webhook.
 */
export function PhoneMockup({
  appointmentId,
  onClose,
  onChanged,
}: {
  appointmentId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<DemoConversationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [replying, setReplying] = useState<'confirm' | 'cancel' | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await get<DemoConversationDto>(`/demo/conversation/${appointmentId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    }
  }, [appointmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // chiusura con Esc: durante la demo si tiene una mano sola sul dispositivo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sendReminder = async () => {
    setSending(true);
    setError(null);
    try {
      await post(`/demo/send-now/${appointmentId}`, {});
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setSending(false);
    }
  };

  const reply = async (button: 'confirm' | 'cancel') => {
    setReplying(button);
    setError(null);
    try {
      await post('/demo/reply', { appointmentId, button });
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setReplying(null);
    }
  };

  const hasMessages = (data?.messages.length ?? 0) > 0;

  return (
    <div className="phone-backdrop" onClick={onClose}>
      <aside
        className="phone-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Anteprima messaggio sul telefono del paziente"
      >
        <div className="phone-drawer-head">
          <span className="muted small-note">Telefono del paziente (simulazione)</span>
          <button className="btn ghost" onClick={onClose} aria-label="Chiudi anteprima">
            ✕
          </button>
        </div>

        <div className="phone-frame">
          <div className="phone-notch" />
          <div className="wa-header">
            <span className="wa-avatar">{(data?.clinicName ?? '?').charAt(0)}</span>
            <div className="wa-header-text">
              <div className="wa-title">{data?.clinicName ?? '…'}</div>
              <div className="wa-subtitle">WhatsApp Business</div>
            </div>
          </div>

          <div className="wa-body">
            {!hasMessages && (
              <p className="wa-empty">
                Nessun messaggio ancora inviato.
                <br />
                Premi «Invia promemoria adesso» qui sotto.
              </p>
            )}

            {data?.messages.map((m, i) => {
              const isLast = i === data.messages.length - 1;
              const showButtons = m.direction === 'out' && m.isTemplate && isLast && data.buttonsActive;
              return (
                <div key={i} className={`wa-row ${m.direction === 'out' ? 'out' : 'in'}`}>
                  <div className={`wa-bubble ${m.direction === 'out' ? 'bubble-out' : 'bubble-in'}`}>
                    <span className="wa-text">{m.body}</span>
                    <span className="wa-meta">
                      {new Date(m.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                      {m.direction === 'out' && <span className="wa-ticks">✓✓</span>}
                    </span>
                    {showButtons && (
                      <div className="wa-buttons">
                        <button
                          className="wa-button"
                          disabled={replying !== null}
                          onClick={() => reply('confirm')}
                        >
                          {replying === 'confirm' ? 'Invio…' : 'Confermo'}
                        </button>
                        <button
                          className="wa-button"
                          disabled={replying !== null}
                          onClick={() => reply('cancel')}
                        >
                          {replying === 'cancel' ? 'Invio…' : 'Devo disdire'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error && <p className="error-text phone-error">{error}</p>}

        <div className="phone-actions">
          <button className="btn primary big" onClick={sendReminder} disabled={sending}>
            {sending ? 'Invio in corso…' : '📨 Invia promemoria adesso'}
          </button>
          <p className="muted small-note">
            Nessun messaggio reale viene inviato: lo studio è in modalità demo.
          </p>
        </div>
      </aside>
    </div>
  );
}
