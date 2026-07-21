import { Prisma, type Clinic, type Patient, type PrismaClient } from '@prisma/client';
import { DEFAULT_TEMPLATES } from '@confermo/shared';
import { logEvent } from '../lib/events.js';
import { maskPhone, normalizePhone } from '../lib/phone.js';
import { renderTemplate } from '../lib/template.js';
import type { IncomingEvent } from '../messaging/provider.js';
import type { ProviderResolver } from '../messaging/index.js';
import { handleReply } from './replies.js';

/** Finestra di servizio WhatsApp: 24 ore dall'ultimo messaggio del paziente. */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Parole che contano come opt-out (confronto sul messaggio normalizzato intero). */
const OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'BASTA',
  'CANCELLAMI',
  'DISISCRIVIMI',
  'DISISCRIVITI',
  'ANNULLA ISCRIZIONE',
  'NON SCRIVERMI',
  'NON SCRIVETEMI',
  'UNSUBSCRIBE',
]);

export function isOptOutText(body: string): boolean {
  const normalized = body
    .trim()
    .toUpperCase()
    .replace(/[.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ');
  return OPT_OUT_KEYWORDS.has(normalized);
}

export interface InboundOutcome {
  duplicate: boolean;
  kind: 'button_confirm' | 'button_cancel' | 'text' | 'opt_out' | 'status_failed' | 'ignored';
}

/**
 * Processa un evento del webhook. Idempotente: l'insert su inbound_message
 * (UNIQUE clinic_id + provider_message_id) fa da lucchetto — se l'evento è
 * già stato visto, nessun effetto viene rieseguito.
 */
export async function handleInboundEvent(
  prisma: PrismaClient,
  clinic: Clinic,
  event: IncomingEvent,
  resolve: ProviderResolver,
  now = new Date(),
): Promise<InboundOutcome> {
  // Esito asincrono di un invio: non è un messaggio del paziente.
  if (event.type === 'status_failed') {
    const reminder = await prisma.reminder.findFirst({
      where: { clinicId: clinic.id, providerMsgId: event.providerMessageId, status: 'sent' },
    });
    if (reminder && event.recipientUnreachable) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { status: 'failed_recipient' } });
      await logEvent(prisma, {
        clinicId: clinic.id,
        type: 'reminder_failed',
        appointmentId: reminder.appointmentId,
        payload: { kind: reminder.kind, failure: 'recipient', async: true, error: event.detail },
      });
    }
    return { duplicate: false, kind: 'status_failed' };
  }

  const from = normalizePhone(event.from);
  const patient = from
    ? await prisma.patient.findUnique({
        where: { clinicId_phone: { clinicId: clinic.id, phone: from } },
      })
    : null;

  const kind =
    event.type === 'button'
      ? event.button === 'confirm'
        ? ('button_confirm' as const)
        : ('button_cancel' as const)
      : isOptOutText(event.body)
        ? ('opt_out' as const)
        : ('text' as const);

  // Dedup: chi riesce a inserire la riga "possiede" l'evento.
  try {
    await prisma.inboundMessage.create({
      data: {
        clinicId: clinic.id,
        patientId: patient?.id ?? null,
        providerMessageId: event.providerMessageId,
        kind,
        body: event.type === 'text' && kind === 'text' ? event.body : null,
        fromMasked: maskPhone(event.from),
        // il testo libero e le disdette vanno all'attenzione della segreteria
        needsAttention: kind === 'text' || kind === 'button_cancel',
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { duplicate: true, kind };
    }
    throw err;
  }

  // Qualsiasi messaggio in ingresso apre (o riapre) la finestra 24h.
  if (patient) {
    await prisma.patient.update({
      where: { id: patient.id },
      data: { waWindowOpenedAt: now },
    });
  }

  switch (kind) {
    case 'opt_out': {
      if (patient) {
        await prisma.patient.update({ where: { id: patient.id }, data: { optedOutAt: now } });
        await logEvent(prisma, { clinicId: clinic.id, type: 'patient_opted_out', patientId: patient.id });
        // i promemoria in coda per i suoi appuntamenti vengono saltati
        await prisma.reminder.updateMany({
          where: { status: 'pending', appointment: { patientId: patient.id } },
          data: { status: 'skipped' },
        });
      }
      break;
    }
    case 'button_confirm':
    case 'button_cancel': {
      if (event.type !== 'button') break;
      const outcome = await handleReply(
        prisma,
        { from: from ?? event.from, button: event.button, appointmentId: event.appointmentId },
        now,
      );
      if (outcome.handled && event.button === 'confirm' && patient) {
        await sendThankYou(prisma, clinic, { ...patient, waWindowOpenedAt: now }, resolve, now);
      }
      break;
    }
    case 'text': {
      await logEvent(prisma, {
        clinicId: clinic.id,
        type: 'inbound_text_received',
        patientId: patient?.id ?? null,
      });
      break;
    }
  }

  return { duplicate: false, kind };
}

/**
 * Messaggio di ringraziamento post-conferma ("Grazie, ti aspettiamo!"):
 * messaggio LIBERO di sessione, consentito solo dentro la finestra 24h.
 * Finestra chiusa o canale assente → fail silenzioso ma loggato.
 */
export async function sendThankYou(
  prisma: PrismaClient,
  clinic: Clinic,
  patient: Patient,
  resolve: ProviderResolver,
  now = new Date(),
): Promise<boolean> {
  const windowOpen =
    patient.waWindowOpenedAt !== null &&
    now.getTime() - patient.waWindowOpenedAt.getTime() < WA_WINDOW_MS;
  if (!windowOpen) {
    await logEvent(prisma, {
      clinicId: clinic.id,
      type: 'thankyou_skipped',
      patientId: patient.id,
      payload: { reason: 'window_closed' },
    });
    return false;
  }

  let provider;
  try {
    provider = resolve(clinic);
  } catch {
    provider = null;
  }
  if (!provider) {
    await logEvent(prisma, {
      clinicId: clinic.id,
      type: 'thankyou_skipped',
      patientId: patient.id,
      payload: { reason: 'channel_not_configured' },
    });
    return false;
  }

  const template = await prisma.messageTemplate.findUnique({
    where: { clinicId_kind: { clinicId: clinic.id, kind: 'thank_you' } },
  });
  const body = renderTemplate(template?.body ?? DEFAULT_TEMPLATES.thank_you, {
    paziente: `${patient.firstName} ${patient.lastName}`,
    studio: clinic.name,
  });

  try {
    await provider.sendText(patient.phone, body);
    await logEvent(prisma, { clinicId: clinic.id, type: 'thankyou_sent', patientId: patient.id });
    return true;
  } catch (err) {
    await logEvent(prisma, {
      clinicId: clinic.id,
      type: 'thankyou_failed',
      patientId: patient.id,
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}
