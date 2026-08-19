import type { PrismaClient } from '@prisma/client';

/**
 * Esportazione e reimportazione dei dati di uno studio.
 *
 * A cosa serve:
 * - una copia indipendente dalla piattaforma di hosting (se sparisce l'account,
 *   i backup della piattaforma spariscono con lui);
 * - portabilità: uno studio che chiede i propri dati, o che va spostato su
 *   un'altra installazione;
 * - e soprattutto la possibilità di **provare** un ripristino, che è l'unica
 *   cosa che distingue un backup da un file.
 *
 * Le credenziali WhatsApp NON vengono esportate: sono cifrate con una chiave
 * legata a questa installazione, quindi altrove sarebbero illeggibili — e un
 * file di backup non è il posto dove tenerle. Vanno reinserite dopo il
 * ripristino.
 */

export const BACKUP_FORMAT_VERSION = 1;

export interface ClinicBackup {
  formatVersion: number;
  exportedAt: string;
  clinic: Record<string, unknown>;
  users: Record<string, unknown>[];
  templates: Record<string, unknown>[];
  patients: Record<string, unknown>[];
  appointments: Record<string, unknown>[];
  reminders: Record<string, unknown>[];
  inboundMessages: Record<string, unknown>[];
  eventLog: Record<string, unknown>[];
}

/** Campi che non escono mai dall'installazione in cui sono stati cifrati. */
const CAMPI_ESCLUSI = ['whatsappApiKeyEnc', 'whatsappWebhookSecret'] as const;

export async function exportClinic(prisma: PrismaClient, clinicId: string): Promise<ClinicBackup> {
  const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
  const senzaCredenziali = { ...clinic } as Record<string, unknown>;
  for (const campo of CAMPI_ESCLUSI) delete senzaCredenziali[campo];

  const [users, templates, patients, appointments, reminders, inboundMessages, eventLog] =
    await Promise.all([
      prisma.user.findMany({ where: { clinicId } }),
      prisma.messageTemplate.findMany({ where: { clinicId } }),
      prisma.patient.findMany({ where: { clinicId } }),
      prisma.appointment.findMany({ where: { clinicId } }),
      prisma.reminder.findMany({ where: { clinicId } }),
      prisma.inboundMessage.findMany({ where: { clinicId } }),
      prisma.eventLog.findMany({ where: { clinicId } }),
    ]);

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    clinic: senzaCredenziali,
    users,
    templates,
    patients,
    appointments,
    reminders,
    inboundMessages,
    eventLog,
  } as ClinicBackup;
}

/** Le date tornano da JSON come stringhe: vanno riconvertite prima di scriverle. */
function ravvivaDate<T extends Record<string, unknown>>(riga: T): T {
  const out: Record<string, unknown> = { ...riga };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)) {
      out[k] = new Date(v);
    }
  }
  return out as T;
}

export interface ImportResult {
  clinicId: string;
  patients: number;
  appointments: number;
  reminders: number;
}

/**
 * Reimporta un backup. Se lo studio esiste già viene **sostituito**: è un
 * ripristino, non una fusione. Gli identificativi originali sono conservati,
 * così i riferimenti fra le tabelle restano validi.
 */
export async function importClinic(prisma: PrismaClient, backup: ClinicBackup): Promise<ImportResult> {
  if (backup.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Formato di backup non compatibile (atteso ${BACKUP_FORMAT_VERSION}, trovato ${backup.formatVersion})`,
    );
  }
  const clinicId = backup.clinic.id as string;

  await prisma.$transaction(async (tx) => {
    // cancella e ricrea: un ripristino deve restituire lo stato del backup,
    // non sommarlo a quello attuale
    await tx.clinic.deleteMany({ where: { id: clinicId } });

    await tx.clinic.create({ data: ravvivaDate(backup.clinic) as never });
    if (backup.users.length) {
      await tx.user.createMany({ data: backup.users.map(ravvivaDate) as never });
    }
    if (backup.templates.length) {
      await tx.messageTemplate.createMany({ data: backup.templates.map(ravvivaDate) as never });
    }
    if (backup.patients.length) {
      await tx.patient.createMany({ data: backup.patients.map(ravvivaDate) as never });
    }
    if (backup.appointments.length) {
      await tx.appointment.createMany({ data: backup.appointments.map(ravvivaDate) as never });
    }
    if (backup.reminders.length) {
      await tx.reminder.createMany({ data: backup.reminders.map(ravvivaDate) as never });
    }
    if (backup.inboundMessages.length) {
      await tx.inboundMessage.createMany({ data: backup.inboundMessages.map(ravvivaDate) as never });
    }
    if (backup.eventLog.length) {
      await tx.eventLog.createMany({ data: backup.eventLog.map(ravvivaDate) as never });
    }
  });

  return {
    clinicId,
    patients: backup.patients.length,
    appointments: backup.appointments.length,
    reminders: backup.reminders.length,
  };
}
