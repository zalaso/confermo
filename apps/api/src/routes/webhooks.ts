import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { prisma } from '../db.js';
import { parseCloudApiWebhook, resolveProvider } from '../messaging/index.js';
import { handleInboundEvent } from '../services/inbound.js';
import { webhookRateLimit } from '../plugins/rateLimit.js';

/** Confronto constant-time tra token (via hash per pareggiare le lunghezze). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Webhook per-clinic. Ogni studio configura nel pannello del proprio provider
 * l'URL con il suo token segreto. Né 360dialog né Meta firmano in modo
 * per-clinic (la firma di Meta è a livello di App, condivisa), quindi
 * l'autenticità si verifica con il token nell'URL, confrontato in tempo
 * costante. Token assente o errato → 401.
 *
 * Il payload dei messaggi in ingresso è identico per i due provider (formato
 * Cloud API di Meta), quindi il parsing è comune.
 */
export default async function webhookRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  /**
   * Handshake di verifica richiesto SOLO da Meta al momento in cui si registra
   * l'URL: una GET con hub.mode/hub.verify_token/hub.challenge, a cui si deve
   * rispondere con il challenge in chiaro se il verify_token combacia col
   * segreto dello studio. 360dialog non usa questo passaggio.
   */
  app.get(
    '/whatsapp/:clinicId',
    {
      config: { rateLimit: webhookRateLimit },
      schema: {
        params: Type.Object({ clinicId: Type.String({ format: 'uuid' }) }),
        querystring: Type.Object({
          'hub.mode': Type.Optional(Type.String()),
          'hub.verify_token': Type.Optional(Type.String()),
          'hub.challenge': Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const clinic = await prisma.clinic.findUnique({ where: { id: req.params.clinicId } });
      const verifyToken = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (
        req.query['hub.mode'] !== 'subscribe' ||
        !clinic?.whatsappWebhookSecret ||
        !verifyToken ||
        !safeEqual(verifyToken, clinic.whatsappWebhookSecret)
      ) {
        return reply.code(403).send({ error: 'Non autorizzato' });
      }
      // Meta si aspetta esattamente il challenge come corpo, senza JSON attorno
      return reply.code(200).type('text/plain').send(challenge ?? '');
    },
  );

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

      const events = parseCloudApiWebhook(req.body);
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
