import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { dispatcherHealth } from '../services/dispatcher.js';

/**
 * Health check pubblico: verifica il database e lo stato del poller.
 * Risponde 503 se il DB non risponde o se il poller è fermo da troppo tempo,
 * così una piattaforma di hosting può accorgersene da sola.
 * Non espone dati sensibili.
 */
export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    let database: 'ok' | 'error' = 'ok';
    let databaseError: string | null = null;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      database = 'error';
      databaseError = err instanceof Error ? err.message : String(err);
    }

    // il poller è "in ritardo" se non completa un giro da più di 5 intervalli
    const staleAfterMs = Math.max(dispatcherHealth.intervalMs * 5, 5 * 60_000);
    const lastSuccess = dispatcherHealth.lastSuccessAt;
    const scheduler: 'ok' | 'stale' | 'stopped' = !dispatcherHealth.started
      ? 'stopped'
      : lastSuccess === null || Date.now() - lastSuccess.getTime() > staleAfterMs
        ? 'stale'
        : 'ok';

    const ok = database === 'ok' && scheduler !== 'stale';
    return reply.code(ok ? 200 : 503).send({
      ok,
      database,
      databaseError,
      scheduler: {
        status: scheduler,
        lastSuccessAt: lastSuccess?.toISOString() ?? null,
        consecutiveErrors: dispatcherHealth.consecutiveErrors,
      },
      messagingFallback: env.messagingProvider,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });
}
