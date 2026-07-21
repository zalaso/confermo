import type { PrismaClient } from '@prisma/client';
import { canTransition } from '@confermo/shared';
import { logEvent } from '../lib/events.js';
import { syncReminders } from './reminders.js';

export interface ButtonReply {
  /** numero mittente E.164 */
  from: string;
  button: 'confirm' | 'cancel';
  /** estratto dal payload del pulsante: lega la risposta all'appuntamento esatto */
  appointmentId?: string | null;
}

export interface ReplyOutcome {
  handled: boolean;
  appointmentId?: string;
  patientId?: string;
  newStatus?: string;
}

/**
 * Applica la risposta di un paziente ("Confermo" / "Devo disdire").
 * Se il payload contiene l'ID appuntamento, la risposta è agganciata a quello;
 * altrimenti (testo scritto a mano) vale l'euristica: promemoria inviato più
 * di recente per un appuntamento futuro del numero mittente.
 */
export async function handleReply(
  prisma: PrismaClient,
  reply: ButtonReply,
  now = new Date(),
): Promise<ReplyOutcome> {
  return prisma.$transaction(async (tx) => {
    const reminder = await tx.reminder.findFirst({
      where: {
        status: 'sent',
        appointment: {
          ...(reply.appointmentId ? { id: reply.appointmentId } : {}),
          patient: { phone: reply.from },
          startsAt: { gt: now },
          status: { in: ['scheduled', 'confirmed'] },
        },
      },
      orderBy: { sentAt: 'desc' },
      include: { appointment: true },
    });
    if (!reminder) return { handled: false };

    const target = reply.button === 'confirm' ? ('confirmed' as const) : ('cancelled' as const);
    const appointment = reminder.appointment;

    await tx.reminder.update({
      where: { id: reminder.id },
      data: {
        response: reply.button === 'confirm' ? 'confirmed' : 'cancel_requested',
        respondedAt: now,
      },
    });
    await logEvent(tx, {
      clinicId: reminder.clinicId,
      type: 'reply_received',
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      payload: { kind: reminder.kind, button: reply.button },
    });

    if (appointment.status !== target && canTransition(appointment.status, target)) {
      const updated = await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: target },
      });
      await logEvent(tx, {
        clinicId: reminder.clinicId,
        type: 'appointment_status_changed',
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        payload: { from: appointment.status, to: target, source: 'patient_reply' },
      });
      // una disdetta annulla i promemoria futuri ancora in coda
      await syncReminders(tx, updated, now);
    }

    return {
      handled: true,
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      newStatus: target,
    };
  });
}
