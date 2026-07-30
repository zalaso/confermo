import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { buildServer } from '../../src/server.js';

const prisma = createTestClient();
const PASSWORD = 'password-di-prova';

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

/**
 * Gestione dell'opt-out dalla dashboard: un paziente che scrive STOP per errore
 * (o che più tardi richiede i promemoria) deve poter essere riattivato senza
 * mettere le mani sul database.
 */
async function setup() {
  const base = await seedBase(prisma);
  await prisma.user.create({
    data: {
      clinicId: base.clinic.id,
      email: 'studio@test.it',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  const app = await buildServer();
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'studio@test.it', password: PASSWORD },
  });
  const cookie = login.cookies.find((c) => c.name === 'confermo_session')!.value;
  return { ...base, app, cookie };
}

describe('opt-out gestito dalla segreteria', () => {
  it('riattiva un paziente che aveva scritto STOP', async () => {
    const { app, cookie, patient } = await setup();
    try {
      await prisma.patient.update({ where: { id: patient.id }, data: { optedOutAt: new Date() } });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/patients/${patient.id}`,
        cookies: { confermo_session: cookie },
        payload: { optedOut: false },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().optedOutAt).toBeNull();
      const event = await prisma.eventLog.findFirst({ where: { type: 'patient_opt_in_restored' } });
      expect(event).not.toBeNull(); // la riattivazione resta a registro
    } finally {
      await app.close();
    }
  });

  it('NON riattiva un paziente senza consenso privacy', async () => {
    const { app, cookie, patient } = await setup();
    try {
      await prisma.patient.update({
        where: { id: patient.id },
        data: { optedOutAt: new Date(), privacyConsentAt: null },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/patients/${patient.id}`,
        cookies: { confermo_session: cookie },
        payload: { optedOut: false },
      });

      expect(res.statusCode).toBe(422);
      const after = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(after.optedOutAt).not.toBeNull(); // resta opted-out
    } finally {
      await app.close();
    }
  });

  it('la segreteria può registrare un opt-out chiesto a voce', async () => {
    const { app, cookie, patient } = await setup();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/patients/${patient.id}`,
        cookies: { confermo_session: cookie },
        payload: { optedOut: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().optedOutAt).not.toBeNull();
      const event = await prisma.eventLog.findFirstOrThrow({ where: { type: 'patient_opted_out' } });
      expect(event.payload).toMatchObject({ source: 'staff' });
    } finally {
      await app.close();
    }
  });

  it('modificare nome o telefono non tocca lo stato di opt-out', async () => {
    const { app, cookie, patient } = await setup();
    try {
      await prisma.patient.update({ where: { id: patient.id }, data: { optedOutAt: new Date() } });

      await app.inject({
        method: 'PATCH',
        url: `/api/patients/${patient.id}`,
        cookies: { confermo_session: cookie },
        payload: { firstName: 'Mario Aggiornato' },
      });

      const after = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(after.firstName).toBe('Mario Aggiornato');
      expect(after.optedOutAt).not.toBeNull(); // non azzerato per sbaglio
    } finally {
      await app.close();
    }
  });
});
