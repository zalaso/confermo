import '../src/lib/load-env.js';
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { exportClinic, importClinic, type ClinicBackup } from '../src/demo/backup.js';

/**
 * Copia di sicurezza dei dati di uno studio, in un file JSON.
 *
 *   npm run backup -w apps/api -- --list
 *   npm run backup -w apps/api -- --export --clinic "Studio Rossi" --out backup.json
 *   npm run backup -w apps/api -- --import --in backup.json
 *
 * Non sostituisce i backup della piattaforma di hosting: è una copia
 * indipendente, e soprattutto un modo per PROVARE che un ripristino funziona.
 */
const { values } = parseArgs({
  options: {
    list: { type: 'boolean', default: false },
    export: { type: 'boolean', default: false },
    import: { type: 'boolean', default: false },
    clinic: { type: 'string' },
    out: { type: 'string' },
    in: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help || (!values.list && !values.export && !values.import)) {
  console.log(`
Uso: npm run backup -w apps/api -- [opzioni]

  --list                        elenca gli studi presenti
  --export --clinic "<nome>"    esporta uno studio
           --out <file.json>    file di destinazione (default: backup-<data>.json)
  --import --in <file.json>     ripristina uno studio da un backup

Le credenziali WhatsApp non vengono esportate (sono cifrate con una chiave
legata a questa installazione): dopo un ripristino vanno reinserite.
`);
  process.exit(0);
}

const prisma = new PrismaClient();
try {
  if (values.list) {
    const cliniche = await prisma.clinic.findMany({
      select: { id: true, name: true, demoMode: true, _count: { select: { patients: true } } },
      orderBy: { name: 'asc' },
    });
    if (cliniche.length === 0) console.log('Nessuno studio presente.');
    for (const c of cliniche) {
      console.log(`  ${c.name}${c.demoMode ? '  (demo)' : ''} — ${c._count.patients} pazienti`);
    }
  }

  if (values.export) {
    if (!values.clinic) {
      console.error('Serve --clinic "<nome dello studio>". Usa --list per vedere quali ci sono.');
      process.exit(1);
    }
    const clinic = await prisma.clinic.findFirst({ where: { name: values.clinic } });
    if (!clinic) {
      console.error(`Studio "${values.clinic}" non trovato. Usa --list per vedere quali ci sono.`);
      process.exit(1);
    }
    const backup = await exportClinic(prisma, clinic.id);
    const file = values.out ?? `backup-${new Date().toISOString().slice(0, 10)}.json`;
    writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`Esportato "${clinic.name}" in ${file}`);
    console.log(
      `  ${backup.patients.length} pazienti · ${backup.appointments.length} appuntamenti · ${backup.reminders.length} promemoria`,
    );
    console.log('  Le credenziali WhatsApp NON sono nel file: vanno reinserite dopo un ripristino.');
  }

  if (values.import) {
    if (!values.in) {
      console.error('Serve --in <file.json>.');
      process.exit(1);
    }
    const backup = JSON.parse(readFileSync(values.in, 'utf8')) as ClinicBackup;
    console.log(`Ripristino di "${backup.clinic.name}" dal backup del ${backup.exportedAt}...`);
    console.log('ATTENZIONE: se lo studio esiste già viene sostituito.');
    const result = await importClinic(prisma, backup);
    console.log(
      `Ripristinati ${result.patients} pazienti, ${result.appointments} appuntamenti, ${result.reminders} promemoria.`,
    );
    console.log('Ricordati di reinserire le credenziali WhatsApp da Impostazioni.');
  }
} finally {
  await prisma.$disconnect();
}
