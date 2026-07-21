import '../src/lib/load-env.js';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Avvia un PostgreSQL locale (scaricato come dipendenza npm) su porta 5433.
 * Per lo sviluppo su macchine senza Docker/Postgres. In produzione usare
 * un Postgres vero e impostare DATABASE_URL.
 */
const dataDir = path.resolve(import.meta.dirname, '../.pgdata');
const alreadyInitialised = existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'confermo',
  password: 'confermo',
  port: 5433,
  persistent: true,
});

if (!alreadyInitialised) {
  console.log('Inizializzo il database (solo la prima volta)...');
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase('confermo');
  console.log('Database "confermo" creato.');
} catch {
  // esiste già: ok
}

console.log('PostgreSQL avviato su localhost:5433 (db: confermo). Ctrl+C per fermare.');

const stop = async () => {
  console.log('\nArresto PostgreSQL...');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// resta in vita finché non viene interrotto
await new Promise(() => {});
