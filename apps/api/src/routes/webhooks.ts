import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { prisma } from '../db.js';
import { parseDialog360Webhook } from '../messaging/dialog360.js';
import { resolveProvider } from '../messaging/index.js';
import { handleInboundEvent } from '../services/inbound.js';
import { webhookRateLimit } from '../plugins/rateLimit.js';

/** Confronto constant-time tra token (via hash per pareggiare le lunghezze). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Webhook per-clinic: ogni studio ha il proprio canale 360dialog e configura
 * nel pannello BSP l'URL con il suo token segreto. 360dialog non firma le
 * richieste, quindi l'autenticità si verifica con il token nell'URL
 * (constant-time). Token assente o errato → 401, nessun processing.
 */
export default async function webhookRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    '/whatsapp/:clinicId',
    {
      config: { rateLimit: webhookRateLimit },
      schema: {
        params: Type.Object({ clinicId: Type.String({ format: 'uuid' }) }),
        querystring: Type.Object({ token: Type.Optional(Type.String()) }),
      },
    },
    async (req, reply) => {
      const clinic = await prisma.clinic.findUnique({ where: { id: req.params.clinicId } });
      const token = req.query.token;
      if (!clinic?.whatsappWebhookSecret || !token || !safeEqual(token, clinic.whatsappWebhookSecret)) {
        return reply.code(401).send({ error: 'Non autorizzato' });
      }

      const events = parseDialog360Webhook(req.body);
      let processed = 0;
      let duplicates = 0;
      for (const event of events) {
        const outcome = await handleInboundEvent(prisma, clinic, event, resolveProvider);
        if (outcome.duplicate) duplicates++;
        else processed++;
      }
      return reply.code(200).send({ received: events.length, processed, duplicates });
    },
  );
}
