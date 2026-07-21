import { useState } from 'react';
import { STATUS_LABELS, type AppointmentStatus, type MetricsDto } from '@confermo/shared';
import { usePolling } from '../hooks';
import { ErrorNotice, Skeleton } from '../components';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const STATUS_ORDER: AppointmentStatus[] = ['confirmed', 'scheduled', 'completed', 'cancelled', 'no_show'];

export function Statistiche() {
  const today = new Date();
  const [from, setFrom] = useState(isoDate(new Date(today.getTime() - 30 * 86400_000)));
  const [to, setTo] = useState(isoDate(today));

  const { data, error, loading, refetch } = usePolling<MetricsDto>(
    `/metrics?from=${from}&to=${to}`,
    60_000,
  );

  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

  return (
    <div>
      <div className="page-head">
        <div className="filters">
          <label className="inline-label">
            Dal <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="inline-label">
            Al <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      {loading && !data && <Skeleton rows={2} />}
      {error && !data && <ErrorNotice message={error} onRetry={() => void refetch()} />}

      {data && (
        <>
          <div className="stat-grid">
            <div className="card stat">
              <div className="stat-value">{data.totalAppointments}</div>
              <div className="stat-label">Appuntamenti nel periodo</div>
            </div>
            <div className="card stat accent-ok">
              <div className="stat-value">{pct(data.confirmationRate)}</div>
              <div className="stat-label">Hanno confermato al promemoria</div>
              <div className="stat-sub muted">
                {data.remindersConfirmed} conferme su {data.remindersSent} messaggi inviati
              </div>
            </div>
            <div className="card stat accent-danger">
              <div className="stat-value">{pct(data.noShowRate)}</div>
              <div className="stat-label">Non presentati (no-show)</div>
              <div className="stat-sub muted">
                {data.byStatus.no_show} su {data.byStatus.no_show + data.byStatus.completed} visite con esito
              </div>
            </div>
            <div className="card stat">
              <div className="stat-value">
                {data.avgResponseMinutes === null ? '—' : `${Math.round(data.avgResponseMinutes)} min`}
              </div>
              <div className="stat-label">Tempo medio di risposta</div>
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">Dettaglio per stato</h2>
            {STATUS_ORDER.map((s) => {
              const count = data.byStatus[s];
              const width = data.totalAppointments > 0 ? (count / data.totalAppointments) * 100 : 0;
              return (
                <div key={s} className="bar-row">
                  <span className="bar-label">{STATUS_LABELS[s]}</span>
                  <div className="bar-track">
                    <div className={`bar-fill fill-${s}`} style={{ width: `${Math.max(width, 2)}%` }} />
                  </div>
                  <span className="bar-count">{count}</span>
                </div>
              );
            })}
          </div>

          <p className="muted small-note">
            Anche le disdette anticipate sono un risparmio: {data.remindersCancelRequested} appuntamenti
            liberati in tempo per essere riassegnati, invece di restare vuoti.
          </p>
        </>
      )}
    </div>
  );
}
