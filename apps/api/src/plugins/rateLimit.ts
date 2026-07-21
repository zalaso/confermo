import fp from 'fastify-plugin';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Protezione contro gli abusi su un'installazione esposta a internet.
 *
 * Il limite globale è largo (la dashboard fa polling ogni 15 secondi e la
 * segreteria clicca parecchio): serve solo a fermare uno script impazzito.
 * I limiti severi stanno sulle singole rotte sensibili — vedi
 * `loginRateLimit` e `webhookRateLimit`.
 */
export default fp(async (app: FastifyInstance) => {
  await app.register(fastifyRateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    // il conteggio è in memoria: con un solo processo va bene, e comunque
    // il vincolo vero contro il brute force è quello sul login
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Troppe richieste. Attendi qualche secondo e riprova.',
    }),
  });
});

/**
 * Login: 8 tentativi ogni 15 minuti per combinazione IP+email.
 *
 * La chiave include l'email così i tentativi falliti contro uno studio non
 * bloccano gli altri utenti dietro lo stesso IP — caso concreto: le reti
 * mobili, dove migliaia di clienti condividono lo stesso indirizzo pubblico.
 *
 * `hook: 'preHandler'` è indispensabile: nel hook predefinito (`onRequest`)
 * il corpo della richiesta non è ancora stato letto, `req.body` sarebbe
 * undefined e la chiave finirebbe per essere il solo IP.
 */
export const loginRateLimit = {
  max: 8,
  timeWindow: '15 minutes',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const email = (req.body as { email?: string } | undefined)?.email ?? '';
    return `login:${req.ip}:${email.toLowerCase()}`;
  },
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Troppi tentativi di accesso. Riprova tra qualche minuto.',
  }),
};

/**
 * Webhook WhatsApp: già protetto dal token nell'URL, ma resta un endpoint
 * pubblico. Il limite è alto perché in caso di picco è il provider a
 * chiamarci e non vogliamo perdere risposte dei pazienti.
 */
export const webhookRateLimit = {
  max: 300,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => `webhook:${req.ip}`,
};

/** Cambio password: impedisce di indovinare la password attuale a tentativi. */
export const changePasswordRateLimit = {
  max: 5,
  timeWindow: '15 minutes',
  keyGenerator: (req: FastifyRequest) => `pwd:${req.ip}`,
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Troppi tentativi. Riprova tra qualche minuto.',
  }),
};
