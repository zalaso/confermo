import '../src/lib/load-env.js';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { MIN_PASSWORD_LENGTH } from '@confermo/shared';
import { seedDemoClinic } from '../src/demo/seed.js';
import { DEMO_PASSWORD, PRESET_NAMES, PRESETS, isPresetName } from '../src/demo/presets.js';

/**
 * Seed dimostrativo, parametrico per prospect:
 *
 *   npm run seed
 *   npm run seed -- --clinic "Studio Dentistico Rossi" --preset dentista
 *   npm run seed -- --clinic "Poliambulatorio Salute" --preset poliambulatorio
 *
 * Crea uno studio in MODALITÀ DEMO (nessun messaggio reale può partire),
 * con appuntamenti su oggi e i prossimi 7 giorni e due settimane di storico
 * con esiti realistici, così la pagina Statistiche mostra numeri credibili.
 */
const { values } = parseArgs({
  options: {
    clinic: { type: 'string' },
    preset: { type: 'string', default: 'dentista' },
    email: { type: 'string' },
    password: { type: 'string' },
    'no-demo': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`
Uso: npm run seed -- [opzioni]

  --clinic "<nome>"   Nome dello studio (default: quello del preset)
  --preset <nome>     ${PRESET_NAMES.join(' | ')}   (default: dentista)
  --email <email>     Email di accesso (default: demo@confermo.it)
  --password <pw>     Password di accesso (default: ${DEMO_PASSWORD})
  --no-demo           NON attivare la modalità demo (sconsigliato per le presentazioni)
`);
  process.exit(0);
}

const presetName = values.preset ?? 'dentista';
if (!isPresetName(presetName)) {
  console.error(`Preset sconosciuto: "${presetName}". Disponibili: ${PRESET_NAMES.join(', ')}`);
  process.exit(1);
}

if (values.password && values.password.length < MIN_PASSWORD_LENGTH) {
  console.error(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`);
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const name = values.clinic?.trim() || PRESETS[presetName].defaultClinicName;
  console.log(`Creo lo studio dimostrativo "${name}" (preset: ${presetName})...`);

  const result = await seedDemoClinic(prisma, {
    name,
    preset: presetName,
    demoMode: !values['no-demo'],
    email: values.email,
    password: values.password,
  });

  console.log('\nSeed completato.');
  console.log(`  Studio:   ${result.clinicName}${values['no-demo'] ? '' : '  (MODALITÀ DEMO)'}`);
  console.log(`  Agenda:   ${result.futureAppointments} appuntamenti futuri, ${result.pastAppointments} storici`);
  console.log(`  Login:    ${result.email}`);
  console.log(`  Password: ${values.password ?? DEMO_PASSWORD}`);
} finally {
  await prisma.$disconnect();
}
