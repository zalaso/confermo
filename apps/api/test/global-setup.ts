import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { TEST_DATABASE_URL } from './test-db.js';

/**
 * Avvia un PostgreSQL embedded dedicato ai test su porta 5434 e applica lo
 * schema Prisma. Completamente separato dal DB di sviluppo (porta 5433).
 */
export default async function setup() {
  const apiDir = path.resolve(import.meta.dirname, '..');
  const dataDir = path.join(apiDir, '.pgdata-test');

  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'confermo',
    password: 'confermo',
    port: 5434,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('confermo_test');

  execSync('npx prisma db push --skip-generate', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });

  return async () => {
    await pg.stop();
  };
}
