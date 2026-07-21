import { randomBytes } from 'node:crypto';
import { TEST_DATABASE_URL } from './test-db.js';

/**
 * Eseguito in ogni worker PRIMA di caricare i moduli sotto test.
 *
 * Serve ai test che avviano l'applicazione vera (`buildServer`): il client
 * Prisma di `src/db.ts` legge DATABASE_URL da `process.env`, e senza questo
 * finirebbe sul database di SVILUPPO invece che su quello dei test.
 * Node non sovrascrive le variabili già presenti quando carica un file .env,
 * quindi questi valori vincono su quelli di apps/api/.env.
 */
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-solo-per-i-test';
process.env.CREDENTIALS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.MESSAGING_PROVIDER ??= 'mock';
