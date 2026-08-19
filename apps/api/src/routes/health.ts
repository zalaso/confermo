import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { dispatcherHealth } from '../services/dispatcher.js';

/**
 * Guasti che indicano un CANALE rotto (credenziali scadute, modello non più
 * approvato, limite di invii esaurito). Sono i casi in cui nessun messaggio
 * arriva più a nessuno.
 *
 * `failed_recipient` è escluso di proposito: significa che quel singolo numero
 * non è su WhatsApp — un dato sbagliato in anagrafica, non un guasto. Contarlo
 * qui trasformerebbe qualche numero errato in un falso allarme.
 */
const GUASTI_DI_CANALE = ['failed', 'failed_template', 'failed_rate_limit'] as const;

/** Sotto questa soglia i fallimenti non fanno scattare nulla: sono casi isolati. */
const MIN_FALLIMENTI_PER_ALLARME = 3;

/**
 * Health check pubblico, pensato per un servizio di monitoraggio esterno.
 * Risponde 503 quando il servizio non sta facendo il suo lavoro; 200 altrimenti.
 * Non espone dati personali.
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

    // Lo scheduler è "in ritardo" se non completa un giro da più di 5 intervalli.
    // "fermo" vale per un processo che non l'ha avviato (test, o spegnimento in
    // corso) e non è un allarme: l'allarme è il ritardo.
    const staleAfterMs = Math.max(dispatcherHealth.intervalMs * 5, 5 * 60_000);
    const lastSuccess = dispatcherHealth.lastSuccessAt;
    const scheduler: 'ok' | 'stale' | 'stopped' = !dispatcherHealth.started
      ? 'stopped'
      : lastSuccess === null || Date.now() - lastSuccess.getTime() > staleAfterMs
        ? 'stale'
        : 'ok';

    /**
     * Il guasto silenzioso: lo scheduler gira benissimo, ma ogni invio fallisce
     * perché il canale WhatsApp è rotto. Senza questo controllo il monitoraggio
     * resterebbe verde mentre nessun paziente riceve più niente.
     */
    let deliveries: {
      status: 'ok' | 'failing' | 'unknown';
      sentLast24h: number;
      failedLast24h: number;
    } = { status: 'unknown', sentLast24h: 0, failedLast24h: 0 };

    if (database === 'ok') {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [sentLast24h, failedLast24h] = await Promise.all([
        prisma.reminder.count({ where: { status: 'sent', sentAt: { gte: since } } }),
        prisma.reminder.count({
          where: { status: { in: [...GUASTI_DI_CANALE] }, scheduledFor: { gte: since } },
        }),
      ]);
      const tentativi = sentLast24h + failedLast24h;
      const failing =
        failedLast24h >= MIN_FALLIMENTI_PER_ALLARME && failedLast24h * 2 >= tentativi;
      deliveries = { status: failing ? 'failing' : 'ok', sentLast24h, failedLast24h };
    }

    const ok = database === 'ok' && scheduler !== 'stale' && deliveries.status !== 'failing';
    return reply.code(ok ? 200 : 503).send({
      ok,
      database,
      databaseError,
      scheduler: {
        status: scheduler,
        lastSuccessAt: lastSuccess?.toISOString() ?? null,
        consecutiveErrors: dispatcherHealth.consecutiveErrors,
      },
      deliveries,
      messagingFallback: env.messagingProvider,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });
}
