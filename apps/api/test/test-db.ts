import { PrismaClient } from '@prisma/client';
import { DEFAULT_TEMPLATES, TEMPLATE_KINDS } from '@confermo/shared';

/** DB dedicato ai test, avviato da global-setup.ts. Mai il DB di sviluppo. */
export const TEST_DATABASE_URL = 'postgresql://confermo:confermo@localhost:5434/confermo_test';

export function createTestClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "clinic" CASCADE');
}

/** Crea studio + template + un paziente con consenso: la base di quasi ogni test. */
export async function seedBase(prisma: PrismaClient) {
  const clinic = await prisma.clinic.create({
    data: {
      name: 'Studio Test',
      timezone: 'Europe/Rome',
      // Fascia di silenzio disattivata: altrimenti la suite darebbe risultati
      // diversi a seconda dell'ora in cui viene lanciata (di sera i promemoria
      // verrebbero rinviati invece che inviati). I test sul silenzio la
      // impostano esplicitamente.
      quietHoursStart: '00:00',
      quietHoursEnd: '00:00',
    },
  });
  for (const kind of TEMPLATE_KINDS) {
    await prisma.messageTemplate.create({
      data: { clinicId: clinic.id, kind, body: DEFAULT_TEMPLATES[kind] },
    });
  }
  const patient = await prisma.patient.create({
    data: {
      clinicId: clinic.id,
      firstName: 'Mario',
      lastName: 'Rossi',
      phone: '+393331112233',
      privacyConsentAt: new Date(),
    },
  });
  return { clinic, patient };
}
