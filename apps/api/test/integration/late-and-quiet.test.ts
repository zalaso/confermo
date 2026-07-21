import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { dispatchDueReminders, MIN_LEAD_MINUTES } from '../../src/services/dispatcher.js';
import { MockProvider } from '../../src/messaging/mock.js';

const prisma = createTestClient();

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

/**
 * Crea un appuntamento con un promemoria già dovuto (scheduledFor nel passato),
 * come dopo un fermo del servizio.
 */
async function createOverdueReminder(opts: {
  startsInMinutes: number;
  scheduledMinutesAgo: number;
  quietHours?: { start: string; end: string };
}) {
  const base = await seedBase(prisma);
  if (opts.quietHours) {
    await prisma.clinic.update({
      where: { id: base.clinic.id },
      data: { quietHoursStart: opts.quietHours.start, quietHoursEnd: opts.quietHours.end },
    });
  }
  const appointment = await prisma.appointment.create({
    data: {
      clinicId: base.clinic.id,
      patientId: base.patient.id,
      startsAt: new Date(Date.now() + opts.startsInMinutes * 60_000),
      durationMin: 30,
      visitType: 'Controllo',
    },
  });
  const reminder = await prisma.reminder.create({
    data: {
      clinicId: base.clinic.id,
      appointmentId: appointment.id,
      kind: 'reminder_48h',
      scheduledFor: new Date(Date.now() - opts.scheduledMinutesAgo * 60_000),
      status: 'pending',
    },
  });
  return { ...base, appointment, reminder };
}

describe('guardia sui promemoria in ritardo (dopo un fermo del servizio)', () => {
  it('un promemoria per un appuntamento GIÀ INIZIATO non parte', async () => {
    const { reminder } = await createOverdueReminder({
      startsInMinutes: -60, // l'appuntamento è iniziato un'ora fa
      scheduledMinutesAgo: 3000,
      quietHours: { start: '00:00', end: '00:00' }, // silenzio disattivato
    });
    const provider = new MockProvider();

    const sent = await dispatchDueReminders(prisma, () => provider);

    expect(sent).toBe(0);
    expect(provider.outbox).toHaveLength(0);
    const after = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(after.status).toBe('skipped');
    const event = await prisma.eventLog.findFirstOrThrow({ where: { type: 'reminder_skipped' } });
    expect(event.payload).toMatchObject({ reason: 'too_late' });
  });

  it('un promemoria che arriverebbe a ridosso dell’appuntamento non parte', async () => {
    await createOverdueReminder({
      startsInMinutes: MIN_LEAD_MINUTES - 5, // troppo tardi per essere utile
      scheduledMinutesAgo: 120,
      quietHours: { start: '00:00', end: '00:00' },
    });
    const provider = new MockProvider();
    expect(await dispatchDueReminders(prisma, () => provider)).toBe(0);
    expect(provider.outbox).toHaveLength(0);
  });

  it('un promemoria in ritardo ma ancora utile PARTE', async () => {
    // il servizio è stato fermo qualche ora, l'appuntamento è domani:
    // il messaggio ha ancora senso e va inviato
    await createOverdueReminder({
      startsInMinutes: 24 * 60,
      scheduledMinutesAgo: 300,
      quietHours: { start: '00:00', end: '00:00' },
    });
    const provider = new MockProvider();
    expect(await dispatchDueReminders(prisma, () => provider)).toBe(1);
    expect(provider.outbox).toHaveLength(1);
  });
});

describe('fascia di silenzio nello scheduler', () => {
  it('dentro la fascia il promemoria viene RINVIATO, non perso né inviato', async () => {
    // fascia che copre l'intera giornata tranne un minuto: qualunque sia
    // l'ora in cui girano i test, siamo dentro il silenzio
    const { reminder, appointment } = await createOverdueReminder({
      startsInMinutes: 48 * 60,
      scheduledMinutesAgo: 30,
      quietHours: { start: '00:01', end: '00:00' },
    });
    const provider = new MockProvider();

    const sent = await dispatchDueReminders(prisma, () => provider);

    expect(sent).toBe(0);
    expect(provider.outbox).toHaveLength(0);
    const after = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(after.status).toBe('pending'); // ancora in coda
    expect(after.scheduledFor.getTime()).toBeGreaterThan(Date.now()); // spostato avanti
    const event = await prisma.eventLog.findFirstOrThrow({
      where: { type: 'reminder_postponed', appointmentId: appointment.id },
    });
    expect(event.payload).toMatchObject({ reason: 'quiet_hours' });
  });

  it('fuori dalla fascia il promemoria parte normalmente', async () => {
    await createOverdueReminder({
      startsInMinutes: 48 * 60,
      scheduledMinutesAgo: 30,
      quietHours: { start: '00:00', end: '00:00' }, // disattivata
    });
    const provider = new MockProvider();
    expect(await dispatchDueReminders(prisma, () => provider)).toBe(1);
  });

  it('il rinvio non provoca doppioni: al giro successivo non riparte', async () => {
    await createOverdueReminder({
      startsInMinutes: 48 * 60,
      scheduledMinutesAgo: 30,
      quietHours: { start: '00:01', end: '00:00' },
    });
    const provider = new MockProvider();
    await dispatchDueReminders(prisma, () => provider);
    await dispatchDueReminders(prisma, () => provider);
    await dispatchDueReminders(prisma, () => provider);
    expect(provider.outbox).toHaveLength(0);
  });
});
