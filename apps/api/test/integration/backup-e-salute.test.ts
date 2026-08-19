import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { buildServer } from '../../src/server.js';
import { exportClinic, importClinic } from '../../src/demo/backup.js';
import { seedDemoClinic } from '../../src/demo/seed.js';
import { dispatcherHealth } from '../../src/services/dispatcher.js';

const prisma = createTestClient();

afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDb(prisma);
  dispatcherHealth.started = false;
  dispatcherHealth.lastSuccessAt = null;
  dispatcherHealth.consecutiveErrors = 0;
  dispatcherHealth.intervalMs = 60_000;
});

async function buildApp() {
  const app = await buildServer();
  await app.ready();
  return app;
}

/**
 * Un backup che non è mai stato ripristinato non è un backup: questi test sono
 * la prova che il ciclo esporta → cancella → ripristina restituisce gli stessi
 * dati, e girano a ogni esecuzione della suite.
 */
describe('backup e ripristino di uno studio', () => {
  it('il ciclo completo restituisce gli stessi dati', async () => {
    const seed = await seedDemoClinic(prisma, { name: 'Studio Da Salvare', preset: 'dentista' });

    const prima = {
      pazienti: await prisma.patient.count({ where: { clinicId: seed.clinicId } }),
      appuntamenti: await prisma.appointment.count({ where: { clinicId: seed.clinicId } }),
      promemoria: await prisma.reminder.count({ where: { clinicId: seed.clinicId } }),
      utenti: await prisma.user.count({ where: { clinicId: seed.clinicId } }),
    };
    expect(prima.pazienti).toBeGreaterThan(0);

    const backup = await exportClinic(prisma, seed.clinicId);

    // il disastro: lo studio sparisce del tutto
    await prisma.clinic.delete({ where: { id: seed.clinicId } });
    expect(await prisma.patient.count({ where: { clinicId: seed.clinicId } })).toBe(0);

    await importClinic(prisma, backup);

    expect(await prisma.patient.count({ where: { clinicId: seed.clinicId } })).toBe(prima.pazienti);
    expect(await prisma.appointment.count({ where: { clinicId: seed.clinicId } })).toBe(
      prima.appuntamenti,
    );
    expect(await prisma.reminder.count({ where: { clinicId: seed.clinicId } })).toBe(prima.promemoria);
    expect(await prisma.user.count({ where: { clinicId: seed.clinicId } })).toBe(prima.utenti);
  });

  it('sopravvive al passaggio da e verso JSON, date comprese', async () => {
    const seed = await seedDemoClinic(prisma, { name: 'Studio JSON', preset: 'fisioterapia' });
    const appuntamentoPrima = await prisma.appointment.findFirstOrThrow({
      where: { clinicId: seed.clinicId },
      orderBy: { startsAt: 'asc' },
    });

    // come farebbe lo script: serializza su file e rilegge
    const backup = JSON.parse(JSON.stringify(await exportClinic(prisma, seed.clinicId)));
    await prisma.clinic.delete({ where: { id: seed.clinicId } });
    await importClinic(prisma, backup);

    const appuntamentoDopo = await prisma.appointment.findUniqueOrThrow({
      where: { id: appuntamentoPrima.id },
    });
    expect(appuntamentoDopo.startsAt.getTime()).toBe(appuntamentoPrima.startsAt.getTime());
    expect(appuntamentoDopo.visitType).toBe(appuntamentoPrima.visitType);
    expect(appuntamentoDopo.status).toBe(appuntamentoPrima.status);
  });

  it('le credenziali WhatsApp non finiscono nel file di backup', async () => {
    const { clinic } = await seedBase(prisma);
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: { whatsappApiKeyEnc: 'v1:cifrata:non:deve:uscire', whatsappWebhookSecret: 'segreto' },
    });

    const backup = await exportClinic(prisma, clinic.id);
    const testo = JSON.stringify(backup);

    expect(testo).not.toContain('v1:cifrata');
    expect(testo).not.toContain('segreto');
    expect(backup.clinic).not.toHaveProperty('whatsappApiKeyEnc');
  });

  it('un backup di formato sconosciuto viene rifiutato invece di rovinare i dati', async () => {
    const seed = await seedDemoClinic(prisma, { name: 'Studio Formato', preset: 'dentista' });
    const backup = await exportClinic(prisma, seed.clinicId);

    await expect(
      importClinic(prisma, { ...backup, formatVersion: 99 }),
    ).rejects.toThrow(/non compatibile/i);

    // i dati esistenti sono intatti
    expect(await prisma.patient.count({ where: { clinicId: seed.clinicId } })).toBeGreaterThan(0);
  });
});

describe('health check per il monitoraggio esterno', () => {
  it('con tutto a posto risponde 200', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(res.json().database).toBe('ok');
    } finally {
      await app.close();
    }
  });

  it('scheduler in ritardo → 503, così il monitoraggio se ne accorge', async () => {
    dispatcherHealth.started = true;
    dispatcherHealth.lastSuccessAt = new Date(Date.now() - 60 * 60 * 1000); // un'ora fa
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json().scheduler.status).toBe('stale');
    } finally {
      await app.close();
    }
  });

  it('scheduler mai avviato (test, spegnimento) non fa scattare l’allarme', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.json().scheduler.status).toBe('stopped');
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  /**
   * Il guasto silenzioso: lo scheduler gira, ma il canale è rotto e nessun
   * messaggio arriva. Senza questo controllo il monitoraggio resterebbe verde.
   */
  it('canale rotto (invii che falliscono in blocco) → 503', async () => {
    const { clinic, patient } = await seedBase(prisma);
    const appointment = await prisma.appointment.create({
      data: {
        clinicId: clinic.id,
        patientId: patient.id,
        startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        durationMin: 30,
        visitType: 'Controllo',
      },
    });
    for (const kind of ['reminder_48h', 'reminder_3h'] as const) {
      await prisma.reminder.create({
        data: {
          clinicId: clinic.id,
          appointmentId: appointment.id,
          kind,
          scheduledFor: new Date(),
          status: 'failed',
        },
      });
    }
    // il terzo fallimento supera la soglia
    const altro = await prisma.appointment.create({
      data: {
        clinicId: clinic.id,
        patientId: patient.id,
        startsAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
        durationMin: 30,
        visitType: 'Controllo',
      },
    });
    await prisma.reminder.create({
      data: {
        clinicId: clinic.id,
        appointmentId: altro.id,
        kind: 'reminder_48h',
        scheduledFor: new Date(),
        status: 'failed_template',
      },
    });

    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.json().deliveries.status).toBe('failing');
      expect(res.json().deliveries.failedLast24h).toBe(3);
      expect(res.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it('numeri sbagliati in anagrafica NON fanno scattare un falso allarme', async () => {
    const { clinic, patient } = await seedBase(prisma);
    // tre numeri non su WhatsApp: è un problema di dati, non di canale
    for (let i = 0; i < 3; i++) {
      const appointment = await prisma.appointment.create({
        data: {
          clinicId: clinic.id,
          patientId: patient.id,
          startsAt: new Date(Date.now() + (i + 3) * 60 * 60 * 1000),
          durationMin: 30,
          visitType: 'Controllo',
        },
      });
      await prisma.reminder.create({
        data: {
          clinicId: clinic.id,
          appointmentId: appointment.id,
          kind: 'reminder_48h',
          scheduledFor: new Date(),
          status: 'failed_recipient',
        },
      });
    }

    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.json().deliveries.status).toBe('ok');
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('un fallimento isolato in mezzo agli invii riusciti non allarma', async () => {
    const { clinic, patient } = await seedBase(prisma);
    for (let i = 0; i < 5; i++) {
      const appointment = await prisma.appointment.create({
        data: {
          clinicId: clinic.id,
          patientId: patient.id,
          startsAt: new Date(Date.now() + (i + 3) * 60 * 60 * 1000),
          durationMin: 30,
          visitType: 'Controllo',
        },
      });
      await prisma.reminder.create({
        data: {
          clinicId: clinic.id,
          appointmentId: appointment.id,
          kind: 'reminder_48h',
          scheduledFor: new Date(),
          status: i === 0 ? 'failed' : 'sent',
          sentAt: i === 0 ? null : new Date(),
        },
      });
    }

    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.json().deliveries.sentLast24h).toBe(4);
      expect(res.json().deliveries.failedLast24h).toBe(1);
      expect(res.json().deliveries.status).toBe('ok');
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
