import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Patient } from '@prisma/client';
import type { PatientDto } from '@confermo/shared';
import { prisma } from '../db.js';
import { normalizePhone } from '../lib/phone.js';
import { logEvent } from '../lib/events.js';

export function toPatientDto(p: Patient): PatientDto {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    phone: p.phone,
    privacyConsentAt: p.privacyConsentAt?.toISOString() ?? null,
    optedOutAt: p.optedOutAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

const patientBody = Type.Object({
  firstName: Type.String({ minLength: 1 }),
  lastName: Type.String({ minLength: 1 }),
  phone: Type.String({ minLength: 5 }),
  privacyConsent: Type.Boolean(),
});

export default async function patientRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/',
    { schema: { querystring: Type.Object({ q: Type.Optional(Type.String()) }) } },
    async (req) => {
      const { q } = req.query;
      const patients = await prisma.patient.findMany({
        where: {
          clinicId: req.user.clinicId,
          ...(q
            ? {
                OR: [
                  { firstName: { contains: q, mode: 'insensitive' } },
                  { lastName: { contains: q, mode: 'insensitive' } },
                  { phone: { contains: q } },
                ],
              }
            : {}),
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });
      return patients.map(toPatientDto);
    },
  );

  app.post('/', { schema: { body: patientBody } }, async (req, reply) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return reply.code(400).send({ error: 'Numero di telefono non valido' });

    const existing = await prisma.patient.findUnique({
      where: { clinicId_phone: { clinicId: req.user.clinicId, phone } },
    });
    if (existing) return reply.code(409).send({ error: 'Esiste già un paziente con questo numero' });

    const patient = await prisma.patient.create({
      data: {
        clinicId: req.user.clinicId,
        firstName: req.body.firstName.trim(),
        lastName: req.body.lastName.trim(),
        phone,
        privacyConsentAt: req.body.privacyConsent ? new Date() : null,
      },
    });
    await logEvent(prisma, { clinicId: req.user.clinicId, type: 'patient_created', patientId: patient.id });
    return reply.code(201).send(toPatientDto(patient));
  });

  app.patch(
    '/:id',
    {
      schema: {
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Partial(patientBody),
      },
    },
    async (req, reply) => {
      const current = await prisma.patient.findFirst({
        where: { id: req.params.id, clinicId: req.user.clinicId },
      });
      if (!current) return reply.code(404).send({ error: 'Paziente non trovato' });

      let phone = current.phone;
      if (req.body.phone !== undefined) {
        const normalized = normalizePhone(req.body.phone);
        if (!normalized) return reply.code(400).send({ error: 'Numero di telefono non valido' });
        phone = normalized;
      }

      const patient = await prisma.patient.update({
        where: { id: current.id },
        data: {
          firstName: req.body.firstName?.trim(),
          lastName: req.body.lastName?.trim(),
          phone,
          ...(req.body.privacyConsent !== undefined
            ? { privacyConsentAt: req.body.privacyConsent ? (current.privacyConsentAt ?? new Date()) : null }
            : {}),
        },
      });
      await logEvent(prisma, { clinicId: req.user.clinicId, type: 'patient_updated', patientId: patient.id });
      return toPatientDto(patient);
    },
  );

  /**
   * Diritto all'oblio (GDPR art. 17): elimina il paziente e, in cascata,
   * appuntamenti e promemoria. Le righe di event_log restano ma vengono
   * scollegate (patient_id/appointment_id a NULL): non contengono dati
   * personali, quindi le metriche aggregate sopravvivono.
   */
  app.delete(
    '/:id',
    { schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } },
    async (req, reply) => {
      const patient = await prisma.patient.findFirst({
        where: { id: req.params.id, clinicId: req.user.clinicId },
        include: { appointments: { select: { id: true } } },
      });
      if (!patient) return reply.code(404).send({ error: 'Paziente non trovato' });

      await prisma.$transaction(async (tx) => {
        const appointmentIds = patient.appointments.map((a) => a.id);
        await tx.eventLog.updateMany({
          where: { patientId: patient.id },
          data: { patientId: null },
        });
        if (appointmentIds.length > 0) {
          await tx.eventLog.updateMany({
            where: { appointmentId: { in: appointmentIds } },
            data: { appointmentId: null },
          });
        }
        await tx.patient.delete({ where: { id: patient.id } });
        await logEvent(tx, { clinicId: req.user.clinicId, type: 'patient_deleted' });
      });
      return reply.code(204).send();
    },
  );
}
