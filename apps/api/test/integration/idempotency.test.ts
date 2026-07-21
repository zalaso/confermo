import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { syncReminders } from '../../src/services/reminders.js';
import { dispatchDueReminders } from '../../src/services/dispatcher.js';
import { MockProvider } from '../../src/messaging/mock.js';

const prisma = createTestClient();

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

/** Appuntamento con il reminder 48h già scaduto (dovuto ora). */
async function createDueSetup() {
  const base = await seedBase(prisma);
  const startsAt = new Date(Date.now() + 47 * 60 * 60 * 1000); // tra 47 ore
  const appointment = await prisma.appointment.create({
    data: {
      clinicId: base.clinic.id,
      patientId: base.patient.id,
      startsAt,
      durationMin: 30,
      visitType: 'Controllo',
    },
  });
  // materializza come farebbe la creazione reale, ma con "now" nel passato
  // così il 48h risulta pending e già dovuto
  await syncReminders(prisma, appointment, new Date(startsAt.getTime() - 49 * 60 * 60 * 1000));
  return { ...base, appointment };
}

describe('idempotenza degli invii (requisito non negoziabile)', () => {
  it('il reminder dovuto parte una sola volta', async () => {
    await createDueSetup();
    const provider = new MockProvider();
    const sent = await dispatchDueReminders(prisma, () => provider);
    expect(sent).toBe(1);
    expect(provider.outbox).toHaveLength(1);
  });

  it('rieseguire il dispatcher non invia duplicati', async () => {
    await createDueSetup();
    const provider = new MockProvider();
    const first = await dispatchDueReminders(prisma, () => provider);
    const second = await dispatchDueReminders(prisma, () => provider);
    const third = await dispatchDueReminders(prisma, () => provider);
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(third).toBe(0);
    expect(provider.outbox).toHaveLength(1);
  });

  it('due dispatcher CONCORRENTI (es. due processi) inviano in totale una volta sola', async () => {
    await createDueSetup();
    const provider = new MockProvider();
    const results = await Promise.all([
      dispatchDueReminders(prisma, () => provider),
      dispatchDueReminders(prisma, () => provider),
      dispatchDueReminders(prisma, () => provider),
    ]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(provider.outbox).toHaveLength(1);
  });

  it('paziente senza consenso privacy: il reminder viene saltato, non inviato', async () => {
    const { appointment } = await createDueSetup();
    await prisma.patient.update({
      where: { id: appointment.patientId },
      data: { privacyConsentAt: null },
    });
    const provider = new MockProvider();
    const sent = await dispatchDueReminders(prisma, () => provider);
    expect(sent).toBe(0);
    expect(provider.outbox).toHaveLength(0);
    const r48 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    });
    expect(r48.status).toBe('skipped');
  });

  it('appuntamento disdetto dopo la pianificazione: il reminder dovuto viene saltato', async () => {
    const { appointment } = await createDueSetup();
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'cancelled' } });
    const provider = new MockProvider();
    const sent = await dispatchDueReminders(prisma, () => provider);
    expect(sent).toBe(0);
    expect(provider.outbox).toHaveLength(0);
  });

  it('provider che fallisce: la riga finisce failed, mai re-inviata in automatico', async () => {
    await createDueSetup();
    const failing = new MockProvider();
    failing.send = async () => {
      throw new Error('rete giù');
    };
    const sent = await dispatchDueReminders(prisma, () => failing);
    expect(sent).toBe(0);
    const reminders = await prisma.reminder.findMany({ where: { status: 'failed' } });
    expect(reminders).toHaveLength(1);
    // un secondo giro non riprova la riga failed
    const provider = new MockProvider();
    expect(await dispatchDueReminders(prisma, () => provider)).toBe(0);
  });

  it('il testo inviato usa il template con le variabili dello studio', async () => {
    await createDueSetup();
    const provider = new MockProvider();
    await dispatchDueReminders(prisma, () => provider);
    const msg = provider.outbox[0]!;
    expect(msg.to).toBe('+393331112233');
    expect(msg.body).toContain('Mario Rossi');
    expect(msg.body).toContain('Studio Test');
  });
});
