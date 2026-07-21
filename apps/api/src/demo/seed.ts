import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { DEFAULT_QUIET_HOURS, DEFAULT_TEMPLATES, REMINDER_KINDS, TEMPLATE_KINDS } from '@confermo/shared';
import { computeReminderPlan } from '../services/reminders.js';
import { DEMO_PASSWORD, DEMO_PATIENTS, PRESETS, demoPhone, type PresetName } from './presets.js';

export interface SeedOptions {
  /** se presente riusa questa clinic (reset senza invalidare la sessione aperta) */
  clinicId?: string;
  name: string;
  preset: PresetName;
  demoMode?: boolean;
  email?: string;
  password?: string;
  now?: Date;
}

export interface SeedResult {
  clinicId: string;
  clinicName: string;
  email: string;
  futureAppointments: number;
  pastAppointments: number;
}

/** PRNG deterministico: la stessa demo produce sempre gli stessi dati. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Orari di apertura tipici di uno studio: mattina e pomeriggio. */
const MORNING_SLOTS = [9, 9.5, 10, 10.5, 11, 11.5, 12];
const AFTERNOON_SLOTS = [14.5, 15, 15.5, 16, 16.5, 17, 17.5];
const ALL_SLOTS = [...MORNING_SLOTS, ...AFTERNOON_SLOTS];

function slotToDateTime(day: DateTime, slot: number): DateTime {
  return day.startOf('day').plus({ hours: Math.floor(slot), minutes: (slot % 1) * 60 });
}

/**
 * Popola (o ripopola) uno studio dimostrativo.
 *
 * Con `clinicId` la clinic e il suo utente vengono PRESERVATI e si azzerano
 * solo i dati: così il "Reset demo" non sloggia chi sta facendo la
 * presentazione.
 *
 * Le righe sono costruite in memoria e inserite con `createMany` (una manciata
 * di query invece di alcune centinaia): il reset deve durare un attimo, non
 * lasciare il cliente a guardare uno spinner.
 */
export async function seedDemoClinic(prisma: PrismaClient, opts: SeedOptions): Promise<SeedResult> {
  const preset = PRESETS[opts.preset];
  const email = opts.email ?? 'demo@confermo.it';
  const password = opts.password ?? DEMO_PASSWORD;
  const now = opts.now ?? new Date();
  const rnd = makeRandom(42);

  const clinicData = {
    name: opts.name,
    timezone: 'Europe/Rome',
    demoMode: opts.demoMode ?? true,
    appointmentTypes: preset.appointmentTypes,
    // riportate ai valori di partenza: il reset deve restituire uno studio
    // identico a quello appena creato, comprese le impostazioni toccate
    // durante la presentazione precedente
    quietHoursStart: DEFAULT_QUIET_HOURS.start,
    quietHoursEnd: DEFAULT_QUIET_HOURS.end,
  };

  let clinicId: string;
  if (opts.clinicId) {
    // reset: svuota i dati, tieni clinic e utente (la sessione resta valida)
    clinicId = opts.clinicId;
    await prisma.$transaction([
      prisma.patient.deleteMany({ where: { clinicId } }), // cascata su appuntamenti e promemoria
      prisma.inboundMessage.deleteMany({ where: { clinicId } }),
      prisma.eventLog.deleteMany({ where: { clinicId } }),
      prisma.messageTemplate.deleteMany({ where: { clinicId } }),
      prisma.clinic.update({ where: { id: clinicId }, data: clinicData }),
    ]);
  } else {
    const existing = await prisma.clinic.findFirst({ where: { name: opts.name } });
    if (existing) await prisma.clinic.delete({ where: { id: existing.id } });
    const clinic = await prisma.clinic.create({ data: clinicData });
    clinicId = clinic.id;
    await prisma.user.deleteMany({ where: { email: email.toLowerCase() } });
    await prisma.user.create({
      data: { clinicId, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) },
    });
    await prisma.messageTemplate.deleteMany({ where: { clinicId } });
  }

  const zone = 'Europe/Rome';
  const today = DateTime.fromJSDate(now).setZone(zone);

  // --- righe costruite in memoria ---
  const patients: Prisma.PatientCreateManyInput[] = DEMO_PATIENTS.map((p, i) => ({
    id: randomUUID(),
    clinicId,
    firstName: p.firstName,
    lastName: p.lastName,
    phone: demoPhone(i),
    // uno su venti senza consenso: mostra che il sistema non gli scrive
    privacyConsentAt: i === 12 ? null : today.minus({ days: 40 }).toJSDate(),
  }));
  const patientAt = (i: number) => patients[i % patients.length]!;

  const appointments: Prisma.AppointmentCreateManyInput[] = [];
  const reminders: Prisma.ReminderCreateManyInput[] = [];
  const events: Prisma.EventLogCreateManyInput[] = [];

  // --- storico: 2 settimane con esiti realistici (statistiche credibili) ---
  //
  // Gli esiti sono assegnati per QUOTE ESATTE, non a caso: una demo deve
  // mostrare gli stessi numeri ogni volta, e su poche decine di appuntamenti
  // il caso produce scostamenti larghi. Le quote sono tarate sulle metriche
  // che la dashboard calcola davvero — in particolare il tasso di no-show ha
  // come denominatore le sole visite con esito (no_show + completed).
  const historySlots: { day: DateTime; slot: number; k: number }[] = [];
  for (let daysAgo = 14; daysAgo >= 1; daysAgo--) {
    const day = today.minus({ days: daysAgo });
    if (day.weekday === 7) continue; // domenica chiuso
    const perDay = day.weekday === 6 ? 2 : 3; // sabato mezza giornata
    for (let k = 0; k < perDay; k++) {
      historySlots.push({ day, slot: ALL_SLOTS[Math.floor(rnd() * ALL_SLOTS.length)]!, k });
    }
  }

  const total = historySlots.length;
  const noShowCount = Math.round(total * 0.11); // ≈ 12% delle visite con esito
  const cancelledCount = Math.round(total * 0.09);
  const outcomes: ('completed' | 'no_show' | 'cancelled')[] = [
    ...Array<'no_show'>(noShowCount).fill('no_show'),
    ...Array<'cancelled'>(cancelledCount).fill('cancelled'),
    ...Array<'completed'>(total - noShowCount - cancelledCount).fill('completed'),
  ];
  // mescolate con lo stesso PRNG deterministico: le quote restano esatte,
  // cambia solo l'ordine, così i no-show non sono tutti in fondo
  for (let i = outcomes.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [outcomes[i], outcomes[j]] = [outcomes[j]!, outcomes[i]!];
  }

  historySlots.forEach(({ day, slot, k }, index) => {
    const startsAt = slotToDateTime(day, slot);
    const patient = patientAt(index * 3 + k);
    const status = outcomes[index]!;
    const appointmentId = randomUUID();

    appointments.push({
      id: appointmentId,
      clinicId,
      patientId: patient.id!,
      startsAt: startsAt.toUTC().toJSDate(),
      durationMin: preset.durations[k % preset.durations.length]!,
      visitType: preset.appointmentTypes[index % preset.appointmentTypes.length]!,
      status,
    });

    for (const kind of REMINDER_KINDS) {
      const sentAt = startsAt.minus({ hours: kind === 'reminder_48h' ? 48 : 3 });
      if (sentAt.toMillis() > today.toMillis()) continue;
      const hasConsent = patient.privacyConsentAt !== null;

      // Anche le risposte sono deterministiche (quote per indice): chi non
      // conferma è molto più propenso a non presentarsi, che è esattamente
      // il punto di vendita del prodotto.
      let response: 'none' | 'confirmed' | 'cancel_requested' = 'none';
      if (hasConsent) {
        if (status === 'cancelled') {
          if (kind === 'reminder_48h') response = 'cancel_requested';
        } else if (status === 'completed') {
          // 6 su 7 rispondono al primo promemoria, 1 su 2 anche al secondo
          const responds = kind === 'reminder_48h' ? index % 7 !== 0 : index % 2 === 0;
          if (responds) response = 'confirmed';
        } else if (status === 'no_show' && kind === 'reminder_48h' && index % 5 === 0) {
          response = 'confirmed';
        }
      }

      reminders.push({
        id: randomUUID(),
        clinicId,
        appointmentId,
        kind,
        scheduledFor: sentAt.toUTC().toJSDate(),
        status: hasConsent ? 'sent' : 'skipped',
        sentAt: hasConsent ? sentAt.toUTC().toJSDate() : null,
        response,
        respondedAt:
          response === 'none'
            ? null
            : sentAt.plus({ minutes: 5 + ((index * 13) % 90) }).toUTC().toJSDate(),
      });
      if (hasConsent) {
        events.push({
          clinicId,
          type: 'reminder_sent',
          appointmentId,
          patientId: patient.id!,
          payload: { kind, source: 'seed' },
          createdAt: sentAt.toUTC().toJSDate(),
        });
      }
    }
  });

  // --- futuro: oggi + prossimi 7 giorni ---
  let futureCount = 0;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const day = today.plus({ days: dayOffset });
    if (day.weekday === 7) continue;
    const perDay = day.weekday === 6 ? 2 : 3;

    for (let k = 0; k < perDay; k++) {
      const slot = ALL_SLOTS[(futureCount * 2 + k) % ALL_SLOTS.length]!;
      let startsAt = slotToDateTime(day, slot);
      // oggi: solo slot ancora a venire, così la demo ha appuntamenti "vivi"
      if (dayOffset === 0 && startsAt.toMillis() <= today.toMillis()) {
        startsAt = today.plus({ hours: 2 + k }).startOf('hour');
      }

      const patient = patientAt(futureCount * 2 + 1);
      const appointmentId = randomUUID();
      appointments.push({
        id: appointmentId,
        clinicId,
        patientId: patient.id!,
        startsAt: startsAt.toUTC().toJSDate(),
        durationMin: preset.durations[k % preset.durations.length]!,
        visitType: preset.appointmentTypes[futureCount % preset.appointmentTypes.length]!,
        // qualcuno ha già confermato: l'agenda non è tutta "in attesa"
        status: futureCount % 5 === 3 ? 'confirmed' : 'scheduled',
      });

      // stesso calcolo del percorso reale (T-48h / T-3h, saltati se già passati)
      for (const plan of computeReminderPlan(startsAt.toUTC().toJSDate(), now)) {
        reminders.push({
          id: randomUUID(),
          clinicId,
          appointmentId,
          kind: plan.kind,
          scheduledFor: plan.scheduledFor,
          status: plan.status,
        });
      }
      events.push({
        clinicId,
        type: 'appointment_created',
        appointmentId,
        patientId: patient.id!,
        payload: { source: 'seed' },
      });
      futureCount++;
    }
  }

  // --- inserimento in blocco ---
  await prisma.$transaction([
    prisma.messageTemplate.createMany({
      data: TEMPLATE_KINDS.map((kind) => ({ clinicId, kind, body: DEFAULT_TEMPLATES[kind] })),
    }),
    prisma.patient.createMany({ data: patients }),
    prisma.appointment.createMany({ data: appointments }),
    prisma.reminder.createMany({ data: reminders }),
    prisma.eventLog.createMany({ data: events }),
  ]);

  return {
    clinicId,
    clinicName: opts.name,
    email,
    futureAppointments: futureCount,
    pastAppointments: historySlots.length,
  };
}
