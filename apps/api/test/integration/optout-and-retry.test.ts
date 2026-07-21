import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { syncReminders } from '../../src/services/reminders.js';
import { dispatchDueReminders } from '../../src/services/dispatcher.js';
import { MockProvider } from '../../src/messaging/mock.js';
import { Dialog360Provider } from '../../src/messaging/dialog360.js';
import { SendError } from '../../src/messaging/provider.js';
import { resolveProvider } from '../../src/messaging/index.js';
import { encryptSecret } from '../../src/lib/crypto.js';

const prisma = createTestClient();

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

async function createDueSetup() {
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

describe('enforcement opt-out nello scheduler', () => {
  it('paziente opted-out: il reminder dovuto viene saltato, mai inviato', async () => {
    const { appointment } = await createDueSetup();
    await prisma.patient.update({
      where: { id: appointment.patientId },
      data: { optedOutAt: new Date() },
    });
    const mock = new MockProvider();
    const sent = await dispatchDueReminders(prisma, () => mock);
    expect(sent).toBe(0);
    expect(mock.outbox).toHaveLength(0);
    const event = await prisma.eventLog.findFirstOrThrow({ where: { type: 'reminder_skipped' } });
    expect(event.payload).toMatchObject({ reason: 'opted_out' });
  });

  it('canale non configurato in produzione (resolver → null): reminder saltato', async () => {
    await createDueSetup();
    const sent = await dispatchDueReminders(prisma, () => null);
    expect(sent).toBe(0);
    const event = await prisma.eventLog.findFirstOrThrow({ where: { type: 'reminder_skipped' } });
    expect(event.payload).toMatchObject({ reason: 'channel_not_configured' });
  });
});

describe('retry con backoff (solo rate limit)', () => {
  function providerFailingWith(kind: 'rate_limit' | 'template' | 'recipient') {
    const p = new MockProvider();
    p.send = async () => {
      throw new SendError(kind, `errore simulato: ${kind}`);
    };
    return p;
  }

  it('rate limit: la riga torna pending con next_retry_at nel futuro', async () => {
    const { appointment } = await createDueSetup();
    const now = new Date();
    const sent = await dispatchDueReminders(prisma, () => providerFailingWith('rate_limit'), now);
    expect(sent).toBe(0);
    const r48 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    });
    expect(r48.status).toBe('pending');
    expect(r48.attempts).toBe(1);
    expect(r48.nextRetryAt!.getTime()).toBeGreaterThan(now.getTime());

    // un giro PRIMA della scadenza del backoff non riprova
    const again = await dispatchDueReminders(prisma, () => providerFailingWith('rate_limit'), now);
    expect(again).toBe(0);
    const unchanged = await prisma.reminder.findUniqueOrThrow({ where: { id: r48.id } });
    expect(unchanged.attempts).toBe(1);

    // un giro DOPO la scadenza riprova (attempts sale a 2)
    const later = new Date(r48.nextRetryAt!.getTime() + 1000);
    await dispatchDueReminders(prisma, () => providerFailingWith('rate_limit'), later);
    const retried = await prisma.reminder.findUniqueOrThrow({ where: { id: r48.id } });
    expect(retried.attempts).toBe(2);
    expect(retried.status).toBe('pending');
  });

  it('dopo 5 tentativi rate limit → failed_rate_limit definitivo', async () => {
    const { appointment } = await createDueSetup();
    let when = new Date();
    for (let i = 0; i < 5; i++) {
      await dispatchDueReminders(prisma, () => providerFailingWith('rate_limit'), when);
      const r = await prisma.reminder.findUniqueOrThrow({
        where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
      });
      when = new Date((r.nextRetryAt ?? when).getTime() + 1000);
    }
    const final = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    });
    expect(final.status).toBe('failed_rate_limit');
    expect(final.attempts).toBe(5);
  });

  it('template non approvato → failed_template, NESSUN retry', async () => {
    const { appointment } = await createDueSetup();
    await dispatchDueReminders(prisma, () => providerFailingWith('template'));
    const r48 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    });
    expect(r48.status).toBe('failed_template');
    // un secondo giro non lo tocca
    expect(await dispatchDueReminders(prisma, () => new MockProvider())).toBe(0);
  });

  it('numero non su WhatsApp → failed_recipient, NESSUN retry', async () => {
    const { appointment } = await createDueSetup();
    await dispatchDueReminders(prisma, () => providerFailingWith('recipient'));
    const r48 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    });
    expect(r48.status).toBe('failed_recipient');
  });
});

describe('selezione provider per-clinic', () => {
  const KEY = randomBytes(32).toString('base64');

  it('clinic con canale attivo e credenziali → Dialog360 con la chiave decifrata', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
    const { clinic } = await seedBase(prisma);
    const withChannel = await prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        whatsappActive: true,
        whatsappPhone: '+39065550100',
        whatsappChannelId: 'chan-1',
        whatsappApiKeyEnc: encryptSecret('la-api-key', clinic.id),
      },
    });
    const provider = resolveProvider(withChannel, { mockFallback: true });
    expect(provider).toBeInstanceOf(Dialog360Provider);
  });

  it('clinic senza canale → mock in dev, null in produzione', async () => {
    const { clinic } = await seedBase(prisma);
    const fresh = await prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
    expect(resolveProvider(fresh, { mockFallback: true })).toBeInstanceOf(MockProvider);
    expect(resolveProvider(fresh, { mockFallback: false })).toBeNull();
  });

  it('credenziali di un altra clinic (AAD sbagliata) → errore, mai un provider sbagliato', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
    const { clinic } = await seedBase(prisma);
    const withStolenKey = await prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        whatsappActive: true,
        whatsappApiKeyEnc: encryptSecret('chiave-altrui', 'clinic-di-un-altro'),
      },
    });
    expect(() => resolveProvider(withStolenKey, { mockFallback: true })).toThrow();
  });
});
