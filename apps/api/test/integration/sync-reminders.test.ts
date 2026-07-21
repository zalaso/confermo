import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { syncReminders } from '../../src/services/reminders.js';

const prisma = createTestClient();
const now = new Date('2026-07-19T10:00:00Z');

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

async function createAppointment(startsAt: Date) {
  const { clinic, patient } = await seedBase(prisma);
  return prisma.appointment.create({
    data: { clinicId: clinic.id, patientId: patient.id, startsAt, durationMin: 30, visitType: 'Controllo' },
  });
}

describe('syncReminders', () => {
  it('crea le due righe reminder alla creazione', async () => {
    const a = await createAppointment(new Date('2026-07-25T14:00:00Z'));
    await syncReminders(prisma, a, now);
    const reminders = await prisma.reminder.findMany({ where: { appointmentId: a.id } });
    expect(reminders).toHaveLength(2);
    expect(reminders.every((r) => r.status === 'pending')).toBe(true);
  });

  it('è idempotente: due sync non creano righe doppie', async () => {
    const a = await createAppointment(new Date('2026-07-25T14:00:00Z'));
    await syncReminders(prisma, a, now);
    await syncReminders(prisma, a, now);
    const reminders = await prisma.reminder.findMany({ where: { appointmentId: a.id } });
    expect(reminders).toHaveLength(2);
  });

  it('riprogrammazione: aggiorna gli orari dei reminder non inviati', async () => {
    const a = await createAppointment(new Date('2026-07-25T14:00:00Z'));
    await syncReminders(prisma, a, now);
    const moved = await prisma.appointment.update({
      where: { id: a.id },
      data: { startsAt: new Date('2026-07-28T09:00:00Z') },
    });
    await syncReminders(prisma, moved, now);
    const r48 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: a.id, kind: 'reminder_48h' } },
    });
    expect(r48.scheduledFor.toISOString()).toBe('2026-07-26T09:00:00.000Z');
  });

  it('riprogrammazione: un reminder già inviato NON viene toccato', async () => {
    const a = await createAppointment(new Date('2026-07-25T14:00:00Z'));
    await syncReminders(prisma, a, now);
    await prisma.reminder.update({
      where: { appointmentId_kind: { appointmentId: a.id, kind: 'reminder_48h' } },
      data: { status: 'sent', sentAt: now },
    });
    const moved = await prisma.appointment.update({
      where: { id: a.id },
      data: { startsAt: new Date('2026-07-28T09:00:00Z') },
    });
    await syncReminders(prisma, moved, now);
    const r48 = await prisma.reminder.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: a.id, kind: 'reminder_48h' } },
    });
    expect(r48.status).toBe('sent');
    expect(r48.scheduledFor.toISOString()).toBe('2026-07-23T14:00:00.000Z');
  });

  it('disdetta: i reminder pending diventano skipped', async () => {
    const a = await createAppointment(new Date('2026-07-25T14:00:00Z'));
    await syncReminders(prisma, a, now);
    const cancelled = await prisma.appointment.update({
      where: { id: a.id },
      data: { status: 'cancelled' },
    });
    await syncReminders(prisma, cancelled, now);
    const reminders = await prisma.reminder.findMany({ where: { appointmentId: a.id } });
    expect(reminders.every((r) => r.status === 'skipped')).toBe(true);
  });
});
