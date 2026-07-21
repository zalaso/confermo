import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { DEFAULT_QUIET_HOURS } from '@confermo/shared';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { resolveProvider } from '../../src/messaging/index.js';
import { MockProvider } from '../../src/messaging/mock.js';
import { Dialog360Provider } from '../../src/messaging/dialog360.js';
import { encryptSecret } from '../../src/lib/crypto.js';
import { seedDemoClinic } from '../../src/demo/seed.js';
import { PRESETS } from '../../src/demo/presets.js';

const prisma = createTestClient();

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

describe('modalità demo per studio', () => {
  it('uno studio demo usa il mock ANCHE con canale WhatsApp attivo e credenziali', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const { clinic } = await seedBase(prisma);
    const demoWithCredentials = await prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        demoMode: true,
        whatsappActive: true,
        whatsappPhone: '+39065550100',
        whatsappChannelId: 'chan-1',
        whatsappApiKeyEnc: encryptSecret('chiave-vera', clinic.id),
      },
    });

    // è la garanzia che rende sicuro fare demo su un'installazione di produzione
    expect(resolveProvider(demoWithCredentials, { mockFallback: false })).toBeInstanceOf(MockProvider);
  });

  it('senza flag demo lo stesso studio userebbe il canale reale', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const { clinic } = await seedBase(prisma);
    const real = await prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        demoMode: false,
        whatsappActive: true,
        whatsappApiKeyEnc: encryptSecret('chiave-vera', clinic.id),
      },
    });
    expect(resolveProvider(real, { mockFallback: false })).toBeInstanceOf(Dialog360Provider);
  });
});

describe('seed dimostrativo', () => {
  it('crea agenda futura e storico, con metriche credibili e riproducibili', async () => {
    const result = await seedDemoClinic(prisma, { name: 'Studio Demo Uno', preset: 'dentista' });

    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: result.clinicId } });
    expect(clinic.demoMode).toBe(true);
    expect(clinic.appointmentTypes).toEqual(PRESETS.dentista.appointmentTypes);

    const past = await prisma.appointment.count({
      where: { clinicId: clinic.id, startsAt: { lt: new Date() } },
    });
    const future = await prisma.appointment.count({
      where: { clinicId: clinic.id, startsAt: { gte: new Date() } },
    });
    expect(past).toBeGreaterThan(20); // due settimane di storico
    expect(future).toBeGreaterThan(10); // agenda dei prossimi giorni

    // tasso di no-show mostrato in dashboard: no_show / (no_show + completed)
    const noShow = await prisma.appointment.count({ where: { clinicId: clinic.id, status: 'no_show' } });
    const completed = await prisma.appointment.count({
      where: { clinicId: clinic.id, status: 'completed' },
    });
    const noShowRate = noShow / (noShow + completed);
    expect(noShowRate).toBeGreaterThan(0.08);
    expect(noShowRate).toBeLessThan(0.18);

    const sent = await prisma.reminder.count({ where: { clinicId: clinic.id, status: 'sent' } });
    const confirmed = await prisma.reminder.count({
      where: { clinicId: clinic.id, response: 'confirmed' },
    });
    expect(confirmed / sent).toBeGreaterThan(0.45);
  });

  it('i pazienti fittizi hanno numeri non assegnabili a persone reali', async () => {
    const result = await seedDemoClinic(prisma, { name: 'Studio Demo Due', preset: 'poliambulatorio' });
    const patients = await prisma.patient.findMany({ where: { clinicId: result.clinicId } });
    expect(patients.length).toBeGreaterThan(0);
    for (const p of patients) {
      expect(p.phone.startsWith('+390000000')).toBe(true);
    }
  });

  it('ogni preset porta le proprie tipologie, la logica non cambia', async () => {
    const result = await seedDemoClinic(prisma, { name: 'Centro Fisio', preset: 'fisioterapia' });
    const types = new Set(
      (await prisma.appointment.findMany({ where: { clinicId: result.clinicId } })).map((a) => a.visitType),
    );
    for (const t of types) {
      expect(PRESETS.fisioterapia.appointmentTypes).toContain(t);
    }
  });

  it('il reset preserva studio e utente (la sessione aperta non decade)', async () => {
    const first = await seedDemoClinic(prisma, { name: 'Studio Reset', preset: 'dentista' });
    const userBefore = await prisma.user.findFirstOrThrow({ where: { clinicId: first.clinicId } });

    const second = await seedDemoClinic(prisma, {
      clinicId: first.clinicId,
      name: 'Studio Rinominato',
      preset: 'fisioterapia',
    });

    expect(second.clinicId).toBe(first.clinicId);
    const userAfter = await prisma.user.findFirstOrThrow({ where: { clinicId: first.clinicId } });
    expect(userAfter.id).toBe(userBefore.id);
    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: first.clinicId } });
    expect(clinic.name).toBe('Studio Rinominato');
    expect(clinic.appointmentTypes).toEqual(PRESETS.fisioterapia.appointmentTypes);
  });

  it('il reset ripristina anche le impostazioni toccate durante la demo', async () => {
    const first = await seedDemoClinic(prisma, { name: 'Studio Impostazioni', preset: 'dentista' });
    await prisma.clinic.update({
      where: { id: first.clinicId },
      data: { quietHoursStart: '00:01', quietHoursEnd: '00:00' },
    });

    await seedDemoClinic(prisma, {
      clinicId: first.clinicId,
      name: 'Studio Impostazioni',
      preset: 'dentista',
    });

    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: first.clinicId } });
    expect(clinic.quietHoursStart).toBe(DEFAULT_QUIET_HOURS.start);
    expect(clinic.quietHoursEnd).toBe(DEFAULT_QUIET_HOURS.end);
  });

  it('il reset non lascia dati della demo precedente', async () => {
    const first = await seedDemoClinic(prisma, { name: 'Studio Pulizia', preset: 'dentista' });
    const before = await prisma.appointment.count({ where: { clinicId: first.clinicId } });
    await seedDemoClinic(prisma, { clinicId: first.clinicId, name: 'Studio Pulizia', preset: 'dentista' });
    const after = await prisma.appointment.count({ where: { clinicId: first.clinicId } });
    expect(after).toBe(before); // non raddoppiati
  });
});
