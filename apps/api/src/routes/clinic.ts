import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Clinic } from '@prisma/client';
import { VISIT_TYPE_MAX_LENGTH, type ClinicDto, type ClinicLabels } from '@confermo/shared';
import { prisma } from '../db.js';
import { logEvent } from '../lib/events.js';
import { parseHhMm } from '../lib/time.js';

export function toClinicDto(clinic: Clinic): ClinicDto {
  return {
    id: clinic.id,
    name: clinic.name,
    timezone: clinic.timezone,
    demoMode: clinic.demoMode,
    appointmentTypes: Array.isArray(clinic.appointmentTypes) ? (clinic.appointmentTypes as string[]) : [],
    labels: (clinic.labels ?? {}) as ClinicLabels,
    quietHoursStart: clinic.quietHoursStart,
    quietHoursEnd: clinic.quietHoursEnd,
  };
}

/**
 * Impostazioni generali dello studio: nome, tipologie di appuntamento
 * proposte nel form ed etichette dell'interfaccia. Sono configurabili
 * perché il prodotto non è specifico per dentisti.
 */
export default async function clinicRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get('/', async (req) => {
    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: req.user.clinicId } });
    return toClinicDto(clinic);
  });

  app.put(
    '/',
    {
      schema: {
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
          appointmentTypes: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: VISIT_TYPE_MAX_LENGTH }), { maxItems: 30 }),
          ),
          labels: Type.Optional(
            Type.Object({
              studio: Type.Optional(Type.String({ maxLength: 40 })),
              paziente: Type.Optional(Type.String({ maxLength: 40 })),
              appuntamento: Type.Optional(Type.String({ maxLength: 40 })),
            }),
          ),
          quietHoursStart: Type.Optional(Type.String({ pattern: '^\\d{1,2}:\\d{2}$' })),
          quietHoursEnd: Type.Optional(Type.String({ pattern: '^\\d{1,2}:\\d{2}$' })),
        }),
      },
    },
    async (req, reply) => {
      for (const value of [req.body.quietHoursStart, req.body.quietHoursEnd]) {
        if (value !== undefined && parseHhMm(value) === null) {
          return reply.code(400).send({ error: `Orario non valido: "${value}". Usa il formato HH:mm.` });
        }
      }

      const updated = await prisma.clinic.update({
        where: { id: req.user.clinicId },
        data: {
          name: req.body.name?.trim(),
          ...(req.body.appointmentTypes
            ? { appointmentTypes: req.body.appointmentTypes.map((t) => t.trim()).filter(Boolean) }
            : {}),
          ...(req.body.labels ? { labels: req.body.labels } : {}),
          quietHoursStart: req.body.quietHoursStart,
          quietHoursEnd: req.body.quietHoursEnd,
        },
      });
      await logEvent(prisma, {
        clinicId: updated.id,
        type: 'clinic_settings_updated',
        payload: { changed: Object.keys(req.body) },
      });
      return toClinicDto(updated);
    },
  );
}
