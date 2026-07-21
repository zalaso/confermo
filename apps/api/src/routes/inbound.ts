import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { InboundKind, InboundMessageDto } from '@confermo/shared';
import { prisma } from '../db.js';

/** Messaggi ricevuti: la segreteria vede e smarca quelli "da gestire". */
export default async function inboundRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/',
    {
      schema: {
        querystring: Type.Object({ onlyAttention: Type.Optional(Type.Boolean()) }),
      },
    },
    async (req) => {
      const messages = await prisma.inboundMessage.findMany({
        where: {
          clinicId: req.user.clinicId,
          ...(req.query.onlyAttention ? { needsAttention: true, handledAt: null } : {}),
        },
        include: { patient: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return messages.map(
        (m): InboundMessageDto => ({
          id: m.id,
          kind: m.kind as InboundKind,
          body: m.body,
          fromMasked: m.fromMasked,
          patientName: m.patient ? `${m.patient.firstName} ${m.patient.lastName}` : null,
          needsAttention: m.needsAttention,
          handledAt: m.handledAt?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
        }),
      );
    },
  );

  app.post(
    '/:id/handled',
    { schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } },
    async (req, reply) => {
      const message = await prisma.inboundMessage.findFirst({
        where: { id: req.params.id, clinicId: req.user.clinicId },
      });
      if (!message) return reply.code(404).send({ error: 'Messaggio non trovato' });
      await prisma.inboundMessage.update({
        where: { id: message.id },
        data: { needsAttention: false, handledAt: new Date() },
      });
      return { ok: true };
    },
  );
}
