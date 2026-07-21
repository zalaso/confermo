import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { TEMPLATE_KINDS, DEFAULT_TEMPLATES, type TemplateKind } from '@confermo/shared';
import { prisma } from '../db.js';

export default async function templateRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get('/', async (req) => {
    const templates = await prisma.messageTemplate.findMany({
      where: { clinicId: req.user.clinicId },
    });
    return TEMPLATE_KINDS.map((kind) => ({
      kind,
      body: templates.find((t) => t.kind === kind)?.body ?? DEFAULT_TEMPLATES[kind],
    }));
  });

  app.put(
    '/:kind',
    {
      schema: {
        params: Type.Object({ kind: Type.Union(TEMPLATE_KINDS.map((k) => Type.Literal(k))) }),
        body: Type.Object({ body: Type.String({ minLength: 1, maxLength: 1000 }) }),
      },
    },
    async (req) => {
      const kind = req.params.kind as TemplateKind;
      const t = await prisma.messageTemplate.upsert({
        where: { clinicId_kind: { clinicId: req.user.clinicId, kind } },
        create: { clinicId: req.user.clinicId, kind, body: req.body.body },
        update: { body: req.body.body },
      });
      return { kind: t.kind, body: t.body };
    },
  );
}
