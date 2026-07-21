import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { APPOINTMENT_STATUSES, type AppointmentStatus, type MetricsDto } from '@confermo/shared';
import { prisma } from '../db.js';
import { localToUtc } from '../lib/time.js';

/**
 * Metriche per il materiale di vendita: tasso di conferma, tasso di no-show,
 * tempi medi di risposta. Calcolate al volo dalle tabelle: ai volumi di uno
 * studio non serve alcuna aggregazione precalcolata.
 */
export default async function metricsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/',
    {
      schema: {
        querystring: Type.Object({
          from: Type.String(), // "yyyy-MM-dd" o "dd/MM/yyyy"
          to: Type.String(),
        }),
      },
    },
    async (req, reply) => {
      const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: req.user.clinicId } });
      const from = localToUtc(req.query.from, '00:00', clinic.timezone);
      const to = localToUtc(req.query.to, '23:59', clinic.timezone);
      if (!from || !to) return reply.code(400).send({ error: 'Date non valide' });

      const appointmentWindow = { clinicId: clinic.id, startsAt: { gte: from, lte: to } };

      const grouped = await prisma.appointment.groupBy({
        by: ['status'],
        where: appointmentWindow,
        _count: { _all: true },
      });
      const byStatus = Object.fromEntries(
        APPOINTMENT_STATUSES.map((s) => [s, grouped.find((g) => g.status === s)?._count._all ?? 0]),
      ) as Record<AppointmentStatus, number>;
      const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

      const reminders = await prisma.reminder.findMany({
        where: { appointment: appointmentWindow, status: 'sent' },
        select: { response: true, sentAt: true, respondedAt: true },
      });
      const remindersSent = reminders.length;
      const remindersConfirmed = reminders.filter((r) => r.response === 'confirmed').length;
      const remindersCancelRequested = reminders.filter((r) => r.response === 'cancel_requested').length;

      const responseTimes = reminders
        .filter((r) => r.respondedAt && r.sentAt)
        .map((r) => (r.respondedAt!.getTime() - r.sentAt!.getTime()) / 60000);

      const decided = byStatus.no_show + byStatus.completed;

      const metrics: MetricsDto = {
        from: from.toISOString(),
        to: to.toISOString(),
        totalAppointments: total,
        byStatus,
        remindersSent,
        remindersConfirmed,
        remindersCancelRequested,
        confirmationRate: remindersSent > 0 ? remindersConfirmed / remindersSent : null,
        noShowRate: decided > 0 ? byStatus.no_show / decided : null,
        avgResponseMinutes:
          responseTimes.length > 0
            ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
            : null,
      };
      return metrics;
    },
  );
}
