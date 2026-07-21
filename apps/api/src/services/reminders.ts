import type { Appointment, ReminderKind as PrismaReminderKind } from '@prisma/client';
import { REMINDER_KINDS, type ReminderKind } from '@confermo/shared';
import type { Db } from '../db.js';

export const REMINDER_OFFSET_MS: Record<ReminderKind, number> = {
  reminder_48h: 48 * 60 * 60 * 1000,
  reminder_3h: 3 * 60 * 60 * 1000,
};

export interface ReminderPlanItem {
  kind: ReminderKind;
  scheduledFor: Date;
  status: 'pending' | 'skipped';
}

/**
 * Calcola quando devono partire i promemoria per un appuntamento.
 * Un promemoria il cui orario di invio è già passato nasce "skipped":
 * mai inviare messaggi in ritardo (es. appuntamento creato a meno di 3 ore).
 */
export function computeReminderPlan(startsAt: Date, now: Date): ReminderPlanItem[] {
  return REMINDER_KINDS.map((kind) => {
    const scheduledFor = new Date(startsAt.getTime() - REMINDER_OFFSET_MS[kind]);
    return { kind, scheduledFor, status: scheduledFor > now ? ('pending' as const) : ('skipped' as const) };
  });
}

/**
 * Allinea le righe reminder di un appuntamento al suo stato/orario attuale.
 * - crea le righe mancanti (UNIQUE(appointment_id, kind) garantisce l'unicità)
 * - su riprogrammazione aggiorna le righe non ancora inviate
 * - se l'appuntamento è disdetto/concluso, le righe pending diventano skipped
 * - le righe già "sent" o "failed" non vengono MAI toccate (storia immutabile)
 */
export async function syncReminders(db: Db, appointment: Appointment, now = new Date()): Promise<void> {
  const terminal = appointment.status === 'cancelled' || appointment.status === 'completed' || appointment.status === 'no_show';
  if (terminal) {
    await db.reminder.updateMany({
      where: { appointmentId: appointment.id, status: 'pending' },
      data: { status: 'skipped' },
    });
    return;
  }

  const existing = await db.reminder.findMany({ where: { appointmentId: appointment.id } });
  const byKind = new Map(existing.map((r) => [r.kind as ReminderKind, r]));

  for (const plan of computeReminderPlan(appointment.startsAt, now)) {
    const current = byKind.get(plan.kind);
    if (!current) {
      await db.reminder.create({
        data: {
          clinicId: appointment.clinicId,
          appointmentId: appointment.id,
          kind: plan.kind as PrismaReminderKind,
          scheduledFor: plan.scheduledFor,
          status: plan.status,
        },
      });
    } else if (current.status === 'pending' || current.status === 'skipped') {
      await db.reminder.update({
        where: { id: current.id },
        data: { scheduledFor: plan.scheduledFor, status: plan.status },
      });
    }
    // sent/failed: non toccare
  }
}
