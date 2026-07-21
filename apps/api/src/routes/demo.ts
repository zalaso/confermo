import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Clinic } from '@prisma/client';
import { REMINDER_KINDS, type DemoConversationDto, type ReminderKind } from '@confermo/shared';
import { prisma } from '../db.js';
import { getMockProvider, resolveProvider } from '../messaging/index.js';
import { handleInboundEvent } from '../services/inbound.js';
import { dispatchDueReminders, MIN_LEAD_MINUTES } from '../services/dispatcher.js';
import { seedDemoClinic } from '../demo/seed.js';
import { PRESETS, PRESET_NAMES, isPresetName, type PresetName } from '../demo/presets.js';

/** Ricava il preset dalle tipologie salvate sulla clinic (per il reset). */
function inferPreset(clinic: Clinic): PresetName {
  const types = Array.isArray(clinic.appointmentTypes) ? (clinic.appointmentTypes as string[]) : [];
  for (const name of PRESET_NAMES) {
    if (PRESETS[name].appointmentTypes.some((t) => types.includes(t))) return name;
  }
  return 'dentista';
}

/**
 * Rotte della modalità demo. Disponibili SOLO per uno studio con
 * `demo_mode` attivo: in produzione esistono per la clinic dimostrativa e
 * per nessun'altra, quindi non c'è modo di simulare invii su dati veri.
 */
export default async function demoRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const mock = getMockProvider();

  /** Carica la clinic e blocca l'accesso se non è in modalità demo. */
  async function requireDemoClinic(req: FastifyRequest, reply: FastifyReply): Promise<Clinic | null> {
    const clinic = await prisma.clinic.findUnique({ where: { id: req.user.clinicId } });
    if (!clinic?.demoMode) {
      await reply.code(403).send({ error: 'Funzione disponibile solo in modalità demo' });
      return null;
    }
    return clinic;
  }

  /**
   * "Simula invio promemoria": porta a ora il promemoria in coda e fa girare
   * il dispatcher reale. Nessuna scorciatoia — il messaggio viene generato
   * dallo stesso codice che lo manderebbe in produzione.
   */
  app.post(
    '/send-now/:appointmentId',
    {
      schema: {
        params: Type.Object({ appointmentId: Type.String({ format: 'uuid' }) }),
        body: Type.Optional(
          Type.Object({ kind: Type.Optional(Type.Union(REMINDER_KINDS.map((k) => Type.Literal(k)))) }),
        ),
      },
    },
    async (req, reply) => {
      const clinic = await requireDemoClinic(req, reply);
      if (!clinic) return;

      const appointment = await prisma.appointment.findFirst({
        where: { id: req.params.appointmentId, clinicId: clinic.id },
        include: { patient: true, reminders: true },
      });
      if (!appointment) return reply.code(404).send({ error: 'Appuntamento non trovato' });
      if (appointment.patient.privacyConsentAt === null) {
        return reply.code(422).send({
          error: 'Questo paziente non ha dato il consenso: il sistema non gli invia messaggi',
        });
      }
      if (appointment.patient.optedOutAt !== null) {
        return reply.code(422).send({ error: 'Questo paziente ha chiesto di non ricevere messaggi' });
      }

      // il primo promemoria non ancora partito (48h ha la precedenza).
      // Anche uno "skipped" va bene: in demo gli appuntamenti sono spesso
      // a meno di 48 ore, quindi il promemoria non sarebbe mai stato in coda.
      const wanted = req.body?.kind;
      const candidates = REMINDER_KINDS.map((k) => appointment.reminders.find((r) => r.kind === k)).filter(
        (r): r is NonNullable<typeof r> => !!r,
      );
      const target = wanted
        ? candidates.find((r) => r.kind === wanted)
        : candidates.find((r) => r.status === 'pending' || r.status === 'skipped');

      if (!target) {
        return reply.code(422).send({ error: 'Nessun promemoria da inviare per questo appuntamento' });
      }
      if (target.status === 'sent') {
        return reply.code(422).send({ error: 'Questo promemoria è già stato inviato' });
      }

      const now = new Date();
      // stessa guardia dello scheduler: se l'appuntamento è passato (o troppo
      // vicino) il promemoria non partirebbe comunque, meglio dirlo subito
      // invece di mostrare un telefono vuoto durante la presentazione
      if (appointment.startsAt.getTime() - now.getTime() < MIN_LEAD_MINUTES * 60_000) {
        return reply.code(422).send({
          error:
            'Questo appuntamento è troppo vicino (o già passato): il sistema non invia promemoria che arriverebbero in ritardo. Prova con un appuntamento dei prossimi giorni.',
        });
      }

      await prisma.reminder.update({
        where: { id: target.id },
        data: { status: 'pending', scheduledFor: now, nextRetryAt: null },
      });
      // invio comandato a mano: la fascia di silenzio non si applica, altrimenti
      // una presentazione serale mostrerebbe un telefono che resta vuoto
      const sent = await dispatchDueReminders(prisma, resolveProvider, now, { ignoreQuietHours: true });
      return { sent, kind: target.kind as ReminderKind };
    },
  );

  /**
   * Conversazione WhatsApp del paziente, per il mockup del telefono.
   * I messaggi in uscita arrivano dall'outbox del mock: quello che si vede
   * nella cornice è letteralmente ciò che il sistema ha prodotto.
   */
  app.get(
    '/conversation/:appointmentId',
    { schema: { params: Type.Object({ appointmentId: Type.String({ format: 'uuid' }) }) } },
    async (req, reply) => {
      const clinic = await requireDemoClinic(req, reply);
      if (!clinic) return;

      const appointment = await prisma.appointment.findFirst({
        where: { id: req.params.appointmentId, clinicId: clinic.id },
        include: { patient: true, reminders: true },
      });
      if (!appointment) return reply.code(404).send({ error: 'Appuntamento non trovato' });

      const phone = appointment.patient.phone;
      const outgoing = mock.outbox
        .filter((m) => m.to === phone)
        .map((m) => ({
          direction: 'out' as const,
          body: m.body,
          at: m.sentAt,
          // i pulsanti compaiono solo sui promemoria (non sul ringraziamento)
          isTemplate: m.kind !== 'text',
        }));

      const incoming = (
        await prisma.inboundMessage.findMany({
          where: { clinicId: clinic.id, patientId: appointment.patientId },
          orderBy: { createdAt: 'asc' },
        })
      ).map((m) => ({
        direction: 'in' as const,
        body:
          m.kind === 'button_confirm'
            ? 'Confermo'
            : m.kind === 'button_cancel'
              ? 'Devo disdire'
              : (m.body ?? ''),
        at: m.createdAt.toISOString(),
        isTemplate: false,
      }));

      const messages = [...outgoing, ...incoming].sort((a, b) => a.at.localeCompare(b.at));
      const answered = appointment.reminders.some((r) => r.response !== 'none');
      const lastIsTemplate = messages.at(-1)?.direction === 'out' && messages.at(-1)?.isTemplate === true;

      const conversation: DemoConversationDto = {
        clinicName: clinic.name,
        patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
        patientPhone: phone,
        appointmentStatus: appointment.status,
        /** i pulsanti sono cliccabili solo se l'ultimo messaggio è un promemoria senza risposta */
        buttonsActive: lastIsTemplate && !answered,
        messages,
      };
      return conversation;
    },
  );

  /**
   * Click su un pulsante del mockup: percorso identico a quello di una
   * risposta reale via webhook (dedup, finestra 24h, ringraziamento inclusi).
   */
  app.post(
    '/reply',
    {
      schema: {
        body: Type.Object({
          appointmentId: Type.String({ format: 'uuid' }),
          button: Type.Union([Type.Literal('confirm'), Type.Literal('cancel')]),
        }),
      },
    },
    async (req, reply) => {
      const clinic = await requireDemoClinic(req, reply);
      if (!clinic) return;

      const appointment = await prisma.appointment.findFirst({
        where: { id: req.body.appointmentId, clinicId: clinic.id },
        include: { patient: true },
      });
      if (!appointment) return reply.code(404).send({ error: 'Appuntamento non trovato' });

      const outcome = await handleInboundEvent(
        prisma,
        clinic,
        {
          type: 'button',
          providerMessageId: `demo-${randomUUID()}`,
          from: appointment.patient.phone,
          button: req.body.button,
          appointmentId: appointment.id,
        },
        resolveProvider,
      );
      return outcome;
    },
  );

  /** Messaggio di testo libero in ingresso (per mostrare il caso "da gestire"). */
  app.post(
    '/simulate-text',
    {
      schema: {
        body: Type.Object({
          appointmentId: Type.String({ format: 'uuid' }),
          text: Type.String({ minLength: 1, maxLength: 500 }),
        }),
      },
    },
    async (req, reply) => {
      const clinic = await requireDemoClinic(req, reply);
      if (!clinic) return;
      const appointment = await prisma.appointment.findFirst({
        where: { id: req.body.appointmentId, clinicId: clinic.id },
        include: { patient: true },
      });
      if (!appointment) return reply.code(404).send({ error: 'Appuntamento non trovato' });

      return handleInboundEvent(
        prisma,
        clinic,
        {
          type: 'text',
          providerMessageId: `demo-${randomUUID()}`,
          from: appointment.patient.phone,
          body: req.body.text,
        },
        resolveProvider,
      );
    },
  );

  /**
   * Reset: riporta lo studio dimostrativo allo stato iniziale in un secondo,
   * per rifare la demo con il prospect successivo. Clinic e utente restano
   * gli stessi, quindi la sessione aperta non decade.
   */
  app.post(
    '/reset',
    {
      schema: {
        body: Type.Optional(
          Type.Object({
            name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
            preset: Type.Optional(Type.Union(PRESET_NAMES.map((p) => Type.Literal(p)))),
          }),
        ),
      },
    },
    async (req, reply) => {
      const clinic = await requireDemoClinic(req, reply);
      if (!clinic) return;

      const preset = req.body?.preset && isPresetName(req.body.preset) ? req.body.preset : inferPreset(clinic);
      const result = await seedDemoClinic(prisma, {
        clinicId: clinic.id,
        name: req.body?.name?.trim() || clinic.name,
        preset,
        demoMode: true,
      });
      mock.outbox.length = 0; // svuota anche i messaggi finti della demo precedente
      return { ok: true, preset, ...result };
    },
  );

  /** Elenco grezzo dei messaggi finti "inviati" (utile in sviluppo). */
  app.get('/outbox', async (req, reply) => {
    const clinic = await requireDemoClinic(req, reply);
    if (!clinic) return;
    const patients = await prisma.patient.findMany({
      where: { clinicId: clinic.id },
      select: { phone: true },
    });
    const phones = new Set(patients.map((p) => p.phone));
    return mock.outbox.filter((m) => phones.has(m.to)).slice(-50).reverse();
  });
}
