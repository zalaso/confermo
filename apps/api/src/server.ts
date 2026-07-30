import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import authRoutes from './routes/auth.js';
import patientRoutes from './routes/patients.js';
import appointmentRoutes from './routes/appointments.js';
import templateRoutes from './routes/templates.js';
import metricsRoutes from './routes/metrics.js';
import webhookRoutes from './routes/webhooks.js';
import clinicRoutes from './routes/clinic.js';
import whatsappRoutes from './routes/whatsapp.js';
import inboundRoutes from './routes/inbound.js';
import demoRoutes from './routes/demo.js';
import healthRoutes from './routes/health.js';

export async function buildServer() {
  const app = Fastify({
    logger: { level: 'info' },
    // L'applicazione sta sempre dietro un reverse proxy (Railway, Caddy):
    // senza questo `req.ip` sarebbe l'indirizzo del proxy, uguale per tutti,
    // e il rate limiting conterebbe il traffico di tutti in un unico secchio.
    trustProxy: true,
  });

  // Un POST senza corpo su un endpoint d'azione (logout, "segna come gestito")
  // è legittimo: di serie Fastify lo rifiuta con 400 se arriva con
  // Content-Type JSON. Qui un corpo vuoto vale come oggetto vuoto, e le rotte
  // con corpo obbligatorio falliscono comunque, ma sulla validazione dello
  // schema, con un messaggio comprensibile.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = (body as string).trim();
    if (raw === '') return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch {
      const err = new Error('Corpo della richiesta non è JSON valido') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err);
    }
  });

  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });
  await app.register(rateLimitPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });

  // tutte le rotte sotto richiedono la sessione
  await app.register(
    async (secured) => {
      secured.addHook('onRequest', app.authenticate);
      await secured.register(patientRoutes, { prefix: '/patients' });
      await secured.register(appointmentRoutes, { prefix: '/appointments' });
      await secured.register(templateRoutes, { prefix: '/templates' });
      await secured.register(metricsRoutes, { prefix: '/metrics' });
      await secured.register(clinicRoutes, { prefix: '/clinic' });
      await secured.register(whatsappRoutes, { prefix: '/whatsapp' });
      await secured.register(inboundRoutes, { prefix: '/inbound' });
      await secured.register(demoRoutes, { prefix: '/demo' });
    },
    { prefix: '/api' },
  );

  // In produzione l'API serve anche la build statica della dashboard.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Non trovato' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
