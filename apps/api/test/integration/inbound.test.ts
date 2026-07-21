import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { syncReminders } from '../../src/services/reminders.js';
import { handleInboundEvent, sendThankYou, WA_WINDOW_MS } from '../../src/services/inbound.js';
import { MockProvider } from '../../src/messaging/mock.js';
import type { IncomingEvent } from '../../src/messaging/provider.js';

const prisma = createTestClient();
const now = new Date();

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

/** Appuntamento futuro con promemoria 48h già inviato (stato realistico post-invio). */
async function setupWithSentReminder() {
  const base = await seedBase(prisma);
  const appointment = await prisma.appointment.create({
    data: {
      clinicId: base.clinic.id,
      patientId: base.patient.id,
      startsAt: new Date(now.getTime() + 40 * 60 * 60 * 1000),
      durationMin: 30,
      visitType: 'Controllo',
    },
  });
  await syncReminders(prisma, appointment, now);
  await prisma.reminder.update({
    where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    data: { status: 'sent', sentAt: now, providerMsgId: 'wamid.out-48h' },
  });
  return { ...base, appointment };
}

const buttonEvent = (
  id: string,
  button: 'confirm' | 'cancel',
  appointmentId: string | null,
): IncomingEvent => ({
  type: 'button',
  providerMessageId: id,
  from: '+393331112233',
  button,
  appointmentId,
});

describe('gestione eventi webhook', () => {
  it('Confermo: appuntamento confirmed, finestra aperta, ringraziamento inviato', async () => {
    const { clinic, appointment, patient } = await setupWithSentReminder();
    const mock = new MockProvider();

    const outcome = await handleInboundEvent(
      prisma,
      clinic,
      buttonEvent('wamid.c1', 'confirm', appointment.id),
      () => mock,
      now,
    );
    expect(outcome).toEqual({ duplicate: false, kind: 'button_confirm' });

    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe('confirmed');

    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(p.waWindowOpenedAt).not.toBeNull();

    // ringraziamento: messaggio di sessione, non template
    expect(mock.outbox).toHaveLength(1);
    expect(mock.outbox[0]!.kind).toBe('text');
    expect(mock.outbox[0]!.body).toBe('Grazie, ti aspettiamo!');
  });

  it('IDEMPOTENZA: lo stesso evento consegnato due volte non produce doppi effetti', async () => {
    const { clinic, appointment } = await setupWithSentReminder();
    const mock = new MockProvider();
    const event = buttonEvent('wamid.dup', 'confirm', appointment.id);

    const first = await handleInboundEvent(prisma, clinic, event, () => mock, now);
    const second = await handleInboundEvent(prisma, clinic, event, () => mock, now);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(mock.outbox).toHaveLength(1); // un solo grazie
    const rows = await prisma.inboundMessage.findMany();
    expect(rows).toHaveLength(1);
  });

  it('Devo disdire: appuntamento cancelled, riga "da gestire" per la segreteria', async () => {
    const { clinic, appointment } = await setupWithSentReminder();
    const mock = new MockProvider();

    await handleInboundEvent(prisma, clinic, buttonEvent('wamid.x1', 'cancel', appointment.id), () => mock, now);

    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe('cancelled');
    const row = await prisma.inboundMessage.findFirstOrThrow();
    expect(row.kind).toBe('button_cancel');
    expect(row.needsAttention).toBe(true);
    expect(mock.outbox).toHaveLength(0); // nessun grazie sulle disdette
  });

  it('testo libero: salvato con needs_attention, nessuna interpretazione', async () => {
    const { clinic, appointment, patient } = await setupWithSentReminder();
    const mock = new MockProvider();

    await handleInboundEvent(
      prisma,
      clinic,
      { type: 'text', providerMessageId: 'wamid.t1', from: '+393331112233', body: 'Posso venire alle 16?' },
      () => mock,
      now,
    );

    const row = await prisma.inboundMessage.findFirstOrThrow();
    expect(row.kind).toBe('text');
    expect(row.body).toBe('Posso venire alle 16?');
    expect(row.needsAttention).toBe(true);
    expect(row.patientId).toBe(patient.id);
    // lo stato dell'appuntamento NON cambia
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(a.status).toBe('scheduled');
  });

  it('STOP: paziente opted-out e promemoria in coda saltati', async () => {
    const { clinic, appointment, patient } = await setupWithSentReminder();
    const mock = new MockProvider();

    await handleInboundEvent(
      prisma,
      clinic,
      { type: 'text', providerMessageId: 'wamid.s1', from: '+393331112233', body: 'STOP' },
      () => mock,
      now,
    );

    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(p.optedOutAt).not.toBeNull();
    const r3 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_3h' } },
    });
    expect(r3.status).toBe('skipped');
  });

  it('status failed asincrono → reminder marcato failed_recipient', async () => {
    const { clinic, appointment } = await setupWithSentReminder();
    await handleInboundEvent(
      prisma,
      clinic,
      {
        type: 'status_failed',
        providerMessageId: 'wamid.out-48h',
        recipientUnreachable: true,
        detail: 'Message undeliverable',
      },
      () => new MockProvider(),
      now,
    );
    const r48 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    });
    expect(r48.status).toBe('failed_recipient');
  });
});

describe('finestra 24 ore', () => {
  it('finestra chiusa → niente messaggio, evento thankyou_skipped a log', async () => {
    const { clinic, patient } = await seedBase(prisma);
    const stale = await prisma.patient.update({
      where: { id: patient.id },
      data: { waWindowOpenedAt: new Date(now.getTime() - WA_WINDOW_MS - 60_000) },
    });
    const mock = new MockProvider();

    const sent = await sendThankYou(prisma, clinic, stale, () => mock, now);
    expect(sent).toBe(false);
    expect(mock.outbox).toHaveLength(0);
    const event = await prisma.eventLog.findFirstOrThrow({ where: { type: 'thankyou_skipped' } });
    expect(event.payload).toMatchObject({ reason: 'window_closed' });
  });

  it('finestra aperta → messaggio inviato con il template dello studio', async () => {
    const { clinic, patient } = await seedBase(prisma);
    await prisma.messageTemplate.update({
      where: { clinicId_kind: { clinicId: clinic.id, kind: 'thank_you' } },
      data: { body: 'Grazie {{paziente}}, a presto da {{studio}}!' },
    });
    const fresh = await prisma.patient.update({
      where: { id: patient.id },
      data: { waWindowOpenedAt: now },
    });
    const mock = new MockProvider();

    const sent = await sendThankYou(prisma, clinic, fresh, () => mock, now);
    expect(sent).toBe(true);
    expect(mock.outbox[0]!.body).toBe('Grazie Mario Rossi, a presto da Studio Test!');
  });
});
