import type { PrismaClient } from '@prisma/client';
import type { ReminderKind } from '@confermo/shared';
import { formatLocal, nextTimeOutsideQuietHours } from '../lib/time.js';
import { renderTemplate } from '../lib/template.js';
import { logEvent } from '../lib/events.js';
import { maskPhone } from '../lib/phone.js';
import { buildButtonPayloads } from '../messaging/templates.js';
import { SendError, type MessagingProvider, type OutgoingMessage } from '../messaging/provider.js';
import type { ProviderResolver } from '../messaging/index.js';

interface SendJob {
  msg: OutgoingMessage;
  clinicId: string;
  provider: MessagingProvider;
  attempts: number; // già incrementato per questo tentativo
}

/** Max tentativi per rate limit; backoff 2, 4, 8, 16 minuti. */
const MAX_ATTEMPTS = 5;
const backoffMs = (attempts: number) => 2 * 60_000 * 2 ** (attempts - 1);

/**
 * Anticipo minimo perché un promemoria abbia ancora senso.
 *
 * Serve dopo un fermo del servizio: alla ripartenza il poller trova tutto
 * l'arretrato con `scheduled_for` passato e lo manderebbe in blocco. Un
 * «le ricordiamo il suo appuntamento» che arriva a visita già iniziata (o
 * finita) è peggio del non averlo mandato: fa perdere credibilità allo studio.
 */
export const MIN_LEAD_MINUTES = 30;

/**
 * Un giro del dispatcher: reclama i reminder dovuti e li invia con il
 * provider della clinic di appartenenza (WhatsApp reale o mock).
 *
 * Idempotenza (requisito non negoziabile):
 * - claim in transazione con FOR UPDATE SKIP LOCKED;
 * - la riga è marcata `sent` PRIMA della chiamata al provider (at-most-once);
 * - UNIQUE(appointment_id, kind) impedisce righe duplicate a monte.
 *
 * Retry: SOLO per rate limit la riga torna `pending` con next_retry_at
 * (il provider ha rifiutato: nulla è partito, l'at-most-once regge).
 * Template non approvato / numero non su WhatsApp falliscono subito.
 */
export async function dispatchDueReminders(
  prisma: PrismaClient,
  resolve: ProviderResolver,
  now = new Date(),
  opts: { ignoreQuietHours?: boolean } = {},
): Promise<number> {
  // Le colonne DateTime di Prisma sono timestamp SENZA timezone (orario UTC
  // "naive"): il parametro va convertito esplicitamente a UTC naive, altrimenti
  // Postgres promuove la colonna a timestamptz col fuso del SERVER e il
  // confronto slitta di ore.
  const nowUtc = now.toISOString();
  const jobs = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM reminder
      WHERE status = 'pending'
        AND scheduled_for <= (${nowUtc}::timestamptz AT TIME ZONE 'UTC')
        AND (next_retry_at IS NULL OR next_retry_at <= (${nowUtc}::timestamptz AT TIME ZONE 'UTC'))
      ORDER BY scheduled_for
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return [] as SendJob[];

    const reminders = await tx.reminder.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: { appointment: { include: { patient: true, clinic: true } } },
    });

    const templates = await tx.messageTemplate.findMany({
      where: { clinicId: { in: [...new Set(reminders.map((r) => r.clinicId))] } },
    });
    const templateFor = (clinicId: string, kind: string) =>
      templates.find((t) => t.clinicId === clinicId && t.kind === kind)?.body ?? '';

    const toSend: SendJob[] = [];
    for (const r of reminders) {
      const { appointment } = r;
      const { patient, clinic } = appointment;

      // Motivi per NON inviare: appuntamento non più attivo, niente consenso
      // privacy, paziente opted-out (STOP), promemoria ormai inutile, canale
      // non configurato.
      const inactive = appointment.status !== 'scheduled' && appointment.status !== 'confirmed';
      const noConsent = patient.privacyConsentAt === null;
      const optedOut = patient.optedOutAt !== null;
      const tooLate = appointment.startsAt.getTime() - now.getTime() < MIN_LEAD_MINUTES * 60_000;

      let provider: MessagingProvider | null = null;
      let resolveError: string | null = null;
      if (!inactive && !noConsent && !optedOut && !tooLate) {
        try {
          provider = resolve(clinic);
        } catch (err) {
          resolveError = err instanceof Error ? err.message : String(err);
        }
      }

      if (inactive || noConsent || optedOut || tooLate || provider === null) {
        const reason = inactive
          ? 'appointment_inactive'
          : noConsent
            ? 'no_privacy_consent'
            : optedOut
              ? 'opted_out'
              : tooLate
                ? 'too_late'
                : (resolveError ?? 'channel_not_configured');
        await tx.reminder.update({ where: { id: r.id }, data: { status: 'skipped' } });
        await logEvent(tx, {
          clinicId: r.clinicId,
          type: 'reminder_skipped',
          appointmentId: appointment.id,
          patientId: patient.id,
          payload: { kind: r.kind, reason },
        });
        continue;
      }

      // Fascia di silenzio: il promemoria non viene perso, viene rinviato alla
      // prima ora utile. Se lo spostamento lo porta oltre l'appuntamento, sarà
      // la guardia qui sopra a scartarlo al giro successivo.
      // `ignoreQuietHours` serve agli invii comandati a mano (demo, prova):
      // lì è una persona a premere il pulsante, non lo scheduler.
      const postponedTo = opts.ignoreQuietHours
        ? now
        : nextTimeOutsideQuietHours(now, clinic.timezone, clinic.quietHoursStart, clinic.quietHoursEnd);
      if (postponedTo.getTime() !== now.getTime()) {
        await tx.reminder.update({
          where: { id: r.id },
          data: { scheduledFor: postponedTo },
        });
        await logEvent(tx, {
          clinicId: r.clinicId,
          type: 'reminder_postponed',
          appointmentId: appointment.id,
          patientId: patient.id,
          payload: { kind: r.kind, reason: 'quiet_hours', until: postponedTo.toISOString() },
        });
        continue;
      }

      const local = formatLocal(appointment.startsAt, clinic.timezone);
      const variables = {
        paziente: `${patient.firstName} ${patient.lastName}`,
        data: local.date,
        ora: local.time,
        studio: clinic.name,
      };
      const body = renderTemplate(templateFor(r.clinicId, r.kind), variables);
      const attempts = r.attempts + 1;

      await tx.reminder.update({
        where: { id: r.id },
        data: { status: 'sent', sentAt: now, attempts, nextRetryAt: null },
      });
      await logEvent(tx, {
        clinicId: r.clinicId,
        type: 'reminder_sent',
        appointmentId: appointment.id,
        patientId: patient.id,
        payload: { kind: r.kind, provider: provider.name, attempt: attempts },
      });

      toSend.push({
        clinicId: r.clinicId,
        provider,
        attempts,
        msg: {
          to: patient.phone,
          body,
          kind: r.kind as ReminderKind,
          variables,
          buttonPayloads: buildButtonPayloads(appointment.id),
          reminderId: r.id,
          appointmentId: appointment.id,
        },
      });
    }
    return toSend;
  });

  // Invio fuori dalla transazione: le righe sono già marcate `sent`.
  let sent = 0;
  for (const job of jobs) {
    try {
      const res = await job.provider.send(job.msg);
      await prisma.reminder.update({
        where: { id: job.msg.reminderId },
        data: { providerMsgId: res.providerMessageId },
      });
      sent++;
    } catch (err) {
      await handleSendFailure(prisma, job, err, now);
    }
  }
  return sent;
}

async function handleSendFailure(
  prisma: PrismaClient,
  job: SendJob,
  err: unknown,
  now: Date,
): Promise<void> {
  const kind = err instanceof SendError ? err.kind : 'other';
  const detail = err instanceof Error ? err.message : String(err);

  if (kind === 'rate_limit' && job.attempts < MAX_ATTEMPTS) {
    // il provider ha rifiutato: nulla è partito → si può tornare pending
    const nextRetryAt = new Date(now.getTime() + backoffMs(job.attempts));
    await prisma.reminder.update({
      where: { id: job.msg.reminderId },
      data: { status: 'pending', sentAt: null, nextRetryAt },
    });
    await logEvent(prisma, {
      clinicId: job.clinicId,
      type: 'reminder_retry_scheduled',
      appointmentId: job.msg.appointmentId,
      payload: { kind: job.msg.kind, attempt: job.attempts, nextRetryAt: nextRetryAt.toISOString() },
    });
    console.warn(
      `[dispatcher] rate limit per ${maskPhone(job.msg.to)}, retry n.${job.attempts} alle ${nextRetryAt.toISOString()}`,
    );
    return;
  }

  const status =
    kind === 'template'
      ? ('failed_template' as const)
      : kind === 'recipient'
        ? ('failed_recipient' as const)
        : kind === 'rate_limit'
          ? ('failed_rate_limit' as const)
          : ('failed' as const);

  await prisma.reminder.update({
    where: { id: job.msg.reminderId },
    data: { status },
  });
  await logEvent(prisma, {
    clinicId: job.clinicId,
    type: 'reminder_failed',
    appointmentId: job.msg.appointmentId,
    payload: { kind: job.msg.kind, failure: kind, status, error: detail },
  });
  console.error(`[dispatcher] invio fallito (${status}) verso ${maskPhone(job.msg.to)}: ${detail}`);
}

/** Stato del poller, esposto da /api/health. */
export const dispatcherHealth = {
  started: false,
  intervalMs: 60_000,
  lastRunAt: null as Date | null,
  lastSuccessAt: null as Date | null,
  lastError: null as string | null,
  consecutiveErrors: 0,
};

/**
 * Avvia il poller: un giro ogni `intervalMs` (default 60s), senza sovrapposizioni.
 *
 * Resilienza: un giro che fallisce (es. database irraggiungibile) viene
 * loggato e basta — il timer resta attivo e il giro successivo riprende da
 * solo. Non ci sono doppioni perché lo stato di ogni promemoria vive sul DB
 * e il claim è transazionale: se la transazione non è passata, la riga è
 * ancora `pending`; se è passata, è già `sent` e nessuno la riprende.
 */
export function startDispatcher(
  prisma: PrismaClient,
  resolve: ProviderResolver,
  intervalMs = 60_000,
): () => void {
  let running = false;
  dispatcherHealth.started = true;
  dispatcherHealth.intervalMs = intervalMs;

  const tick = async () => {
    if (running) return;
    running = true;
    dispatcherHealth.lastRunAt = new Date();
    try {
      const n = await dispatchDueReminders(prisma, resolve);
      dispatcherHealth.lastSuccessAt = new Date();
      dispatcherHealth.lastError = null;
      dispatcherHealth.consecutiveErrors = 0;
      if (n > 0) console.log(`[dispatcher] inviati ${n} promemoria`);
    } catch (err) {
      dispatcherHealth.consecutiveErrors++;
      dispatcherHealth.lastError = err instanceof Error ? err.message : String(err);
      console.error(
        `[dispatcher] giro fallito (${dispatcherHealth.consecutiveErrors} di fila), riprovo tra ${intervalMs / 1000}s:`,
        dispatcherHealth.lastError,
      );
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, intervalMs);
  void tick();
  return () => {
    clearInterval(handle);
    dispatcherHealth.started = false;
  };
}
