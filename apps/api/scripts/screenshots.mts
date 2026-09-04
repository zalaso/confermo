import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import { chromium, type Page } from 'playwright';

/**
 * Cattura le immagini del prodotto usate nel README.
 *
 * Avvia tutto in un solo processo: un PostgreSQL dedicato, i dati
 * dimostrativi, e l'applicazione vera che serve anche la dashboard compilata.
 * Nessun server da avviare a mano, nessun processo figlio da terminare.
 *
 *   npm run screenshots
 *
 * Le immagini finiscono in docs/img/. Lo studio creato è in modalità
 * dimostrativa: nessun messaggio reale può partire.
 */

const RADICE = path.resolve(import.meta.dirname, '../../..');
const CARTELLA_IMG = path.join(RADICE, 'docs', 'img');
const DATI_PG = path.join(import.meta.dirname, '..', '.pgdata-screenshots');
const PORTA_PG = 5435; // né 5433 (sviluppo) né 5434 (test)
const PORTA_APP = 3100; // non 3001, per non scontrarsi con un server già avviato
const DB_URL = `postgresql://confermo:confermo@localhost:${PORTA_PG}/confermo_shots`;

const CLINIC = 'Studio Dentistico Rossi';
const EMAIL = 'demo@confermo.it';
const PASSWORD = 'demo-confermo';

/** Le variabili vanno impostate PRIMA di importare i moduli che leggono l'ambiente. */
process.env.DATABASE_URL = DB_URL;
process.env.JWT_SECRET ??= randomBytes(32).toString('base64');
process.env.CREDENTIALS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.MESSAGING_PROVIDER = 'mock';
process.env.APP_BASE_URL = `http://localhost:${PORTA_APP}`;

async function scatta(page: Page, nome: string, descrizione: string) {
  const file = path.join(CARTELLA_IMG, nome);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${nome} — ${descrizione}`);
}

const pg = new EmbeddedPostgres({
  databaseDir: DATI_PG,
  user: 'confermo',
  password: 'confermo',
  port: PORTA_PG,
  persistent: false,
});

let chiudiApp: (() => Promise<void>) | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

try {
  if (!existsSync(path.join(RADICE, 'apps', 'web', 'dist', 'index.html'))) {
    throw new Error('Manca la build della dashboard. Esegui prima: npm run build:web');
  }

  console.log('Avvio del database temporaneo...');
  if (existsSync(DATI_PG)) rmSync(DATI_PG, { recursive: true, force: true });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('confermo_shots');

  console.log('Applicazione dello schema...');
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: path.join(RADICE, 'apps', 'api'),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  // Import dinamici: i moduli leggono l'ambiente al caricamento.
  const { prisma } = await import('../src/db.js');
  const { seedDemoClinic } = await import('../src/demo/seed.js');
  const { buildServer } = await import('../src/server.js');

  console.log('Creazione dei dati dimostrativi...');
  await seedDemoClinic(prisma, { name: CLINIC, preset: 'dentista', demoMode: true });

  const app = await buildServer();
  await app.listen({ port: PORTA_APP, host: '127.0.0.1' });
  chiudiApp = async () => {
    await app.close();
    await prisma.$disconnect();
  };
  console.log(`Applicazione avviata su ${process.env.APP_BASE_URL}`);

  mkdirSync(CARTELLA_IMG, { recursive: true });

  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2, // immagini nitide anche sugli schermi ad alta densità
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  });

  console.log('Cattura delle immagini:');

  // --- accesso ---
  await page.goto(`${process.env.APP_BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button:has-text("Entra")');
  await page.waitForSelector('.appointment', { timeout: 15_000 });

  // --- 1. agenda ---
  await scatta(page, '01-agenda.png', 'agenda con stati a colori');

  // --- 2. telefono simulato con messaggio e pulsanti ---
  // Si sceglie un appuntamento con un promemoria ancora in coda («verrà
  // inviato»): quelli imminenti verrebbero rifiutati dalla guardia sui
  // promemoria in ritardo, e il telefono resterebbe vuoto.
  const card = page
    .locator('.appointment')
    .filter({ has: page.locator('button:has-text("Messaggio")') })
    .filter({ hasText: 'verrà inviato' })
    .first();
  await card.locator('button:has-text("Messaggio")').click();
  await page.waitForSelector('.phone-drawer');
  await page.click('.phone-drawer button:has-text("Invia promemoria adesso")');

  // Se l'invio viene rifiutato il pannello mostra il motivo: meglio riportarlo
  // che aspettare invano i pulsanti e morire con un timeout muto.
  const esito = await Promise.race([
    page.waitForSelector('.wa-button', { timeout: 20_000 }).then(() => null),
    page.waitForSelector('.phone-error', { timeout: 20_000 }).then((e) => e.textContent()),
  ]);
  if (esito) throw new Error('Invio del promemoria rifiutato: ' + esito);
  await page.waitForTimeout(400); // l'animazione del pannello si assesta
  await scatta(page, '02-telefono-simulato.png', 'messaggio con i pulsanti di risposta');

  // --- 3. statistiche ---
  await page.click('.phone-drawer button[aria-label="Chiudi anteprima"]');
  await page.click('.nav-btn:has-text("Statistiche")');
  await page.waitForSelector('.stat-value', { timeout: 15_000 });
  await page.waitForTimeout(300);
  await scatta(page, '03-statistiche.png', 'tassi di conferma e no-show');

  console.log(`\nFatto. Immagini in ${path.relative(RADICE, CARTELLA_IMG)}`);
} catch (err) {
  const messaggio = err instanceof Error ? err.message : String(err);
  if (/Executable doesn't exist|browserType.launch/i.test(messaggio)) {
    console.error('\nManca il browser di Playwright. Installalo con:\n  npx playwright install chromium\n');
  } else {
    console.error('\nErrore:', messaggio);
  }
  process.exitCode = 1;
} finally {
  // il browser va chiuso ANCHE quando qualcosa fallisce: altrimenti resta un
  // processo vivo e lo script non termina mai
  await browser?.close().catch(() => {});
  if (chiudiApp) await chiudiApp();
  await pg.stop().catch(() => {});
  rmSync(DATI_PG, { recursive: true, force: true });
}
