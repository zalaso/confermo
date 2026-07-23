import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { syncReminders } from '../../src/services/reminders.js';
import { handleReply } from '../../src/services/replies.js';

const prisma = createTestClient();
const now = new Date();

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

async function createWithSentReminder() {
  const base = await seedBase(prisma);
  const startsAt = new Date(now.getTime() + 40 * 60 * 60 * 1000);
  const appointment = await prisma.appointment.create({
    data: {
      clinicId: base.clinic.id,
      patientId: base.patient.id,
      startsAt,
      durationMin: 30,
      visitType: 'Controllo',
    },
  });
  await syncReminders(prisma, appointment, now);
  await prisma.reminder.update({
    where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    data: { status: 'sent', sentAt: now },
  });
  return { ...base, appointment };
}

describe('risposte dei pazienti', () => {
  it("«Confermo» porta l'appuntamento a confirmed e registra la risposta", async () => {
    const { appointment, patient } = await createWithSentReminder();
    const outcome = await handleReply(prisma, { from: patient.phone, button: 'confirm' });
    expect(outcome.handled).toBe(true);
    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe('confirmed');
    const r48 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
    });
    expect(r48.response).toBe('confirmed');
    expect(r48.respondedAt).not.toBeNull();
  });

  it('«Devo disdire» porta a cancelled e salta il promemoria 3h ancora in coda', async () => {
    const { appointment, patient } = await createWithSentReminder();
    await handleReply(prisma, { from: patient.phone, button: 'cancel' });
    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe('cancelled');
    const r3 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_3h' } },
    });
    expect(r3.status).toBe('skipped');
  });

  it('numero sconosciuto: la risposta non viene gestita', async () => {
    await createWithSentReminder();
    const outcome = await handleReply(prisma, { from: '+390000000000', button: 'confirm' });
    expect(outcome.handled).toBe(false);
  });

  it('appointmentId non-UUID (pulsante di un messaggio di prova) non fa errore', async () => {
    // l'invio di prova usa il payload "test" e va a un numero senza appuntamenti:
    // premere il pulsante non deve far esplodere la query sulla colonna UUID.
    await createWithSentReminder();
    const outcome = await handleReply(prisma, {
      from: '+390000000000', // numero di prova, nessun appuntamento
      button: 'confirm',
      appointmentId: 'test',
    });
    expect(outcome.handled).toBe(false);
  });

  it('gli eventi di audit vengono registrati', async () => {
    const { appointment, patient, clinic } = await createWithSentReminder();
    await handleReply(prisma, { from: patient.phone, button: 'confirm' });
    const events = await prisma.eventLog.findMany({ where: { clinicId: clinic.id } });
    const types = events.map((e) => e.type);
    expect(types).toContain('reply_received');
    expect(types).toContain('appointment_status_changed');
    const changed = events.find((e) => e.type === 'appointment_status_changed')!;
    expect(changed.appointmentId).toBe(appointment.id);
    expect(changed.payload).toMatchObject({ from: 'scheduled', to: 'confirmed', source: 'patient_reply' });
  });
});
