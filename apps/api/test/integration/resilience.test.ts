import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { syncReminders } from '../../src/services/reminders.js';
import {
  dispatchDueReminders,
  dispatcherHealth,
  startDispatcher,
} from '../../src/services/dispatcher.js';
import { MockProvider } from '../../src/messaging/mock.js';

const prisma = createTestClient();

afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDb(prisma);
  dispatcherHealth.lastSuccessAt = null;
  dispatcherHealth.lastError = null;
  dispatcherHealth.consecutiveErrors = 0;
});

async function createDueReminder() {
  const base = await seedBase(prisma);
  const startsAt = new Date(Date.now() + 47 * 60 * 60 * 1000);
  const appointment = await prisma.appointment.create({
    data: {
      clinicId: base.clinic.id,
      patientId: base.patient.id,
      startsAt,
      durationMin: 30,
      visitType: 'Controllo',
    },
  });
  await syncReminders(prisma, appointment, new Date(startsAt.getTime() - 49 * 60 * 60 * 1000));
  return { ...base, appointment };
}

/**
 * Simula il database irraggiungibile: le prime `failures` chiamate a
 * $transaction esplodono come farebbe una connessione caduta, poi il client
 * torna quello vero (database "riacceso").
 */
function flakyClient(real: PrismaClient, failures: number): PrismaClient {
  let remaining = failures;
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === '$transaction' && remaining > 0) {
        remaining--;
        return async () => {
          throw new Error("Can't reach database server at localhost:5434");
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaClient;
}

describe('resilienza del poller al riavvio del database', () => {
  it('un giro fallito lascia il promemoria in coda e non invia nulla', async () => {
    const { appointment } = await createDueReminder();
    const provider = new MockProvider();

    await expect(
      dispatchDueReminders(flakyClient(prisma, 1), () => provider),
    ).rejects.toThrow(/reach database/);

    expect(provider.outbox).toHaveLength(0);
    const r48 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    });
    expect(r48.status).toBe('pending'); // ancora da mandare, niente perso
  });

  it('quando il database torna, il promemoria parte UNA volta sola', async () => {
    await createDueReminder();
    const provider = new MockProvider();

    // database giù per due giri, poi torna
    const flaky = flakyClient(prisma, 2);
    await expect(dispatchDueReminders(flaky, () => provider)).rejects.toThrow();
    await expect(dispatchDueReminders(flaky, () => provider)).rejects.toThrow();

    const sent = await dispatchDueReminders(flaky, () => provider);
    const again = await dispatchDueReminders(flaky, () => provider);

    expect(sent).toBe(1);
    expect(again).toBe(0);
    expect(provider.outbox).toHaveLength(1); // nessun doppione dopo la riconnessione
  });

  it('il poller sopravvive al giro fallito e riprende da solo', async () => {
    await createDueReminder();
    const provider = new MockProvider();
    const stop = startDispatcher(flakyClient(prisma, 1), () => provider, 60);

    try {
      // attende qualche giro: il primo fallisce, i successivi funzionano
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(provider.outbox).toHaveLength(1);
      expect(dispatcherHealth.lastSuccessAt).not.toBeNull();
      expect(dispatcherHealth.consecutiveErrors).toBe(0); // errore assorbito
    } finally {
      stop();
    }
  });
});
