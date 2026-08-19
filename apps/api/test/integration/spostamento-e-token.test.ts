import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { buildServer } from '../../src/server.js';
import { syncReminders } from '../../src/services/reminders.js';

const prisma = createTestClient();
const PASSWORD = 'password-di-prova';

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

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

async function creaAppuntamento(clinicId: string, patientId: string, oreDaAdesso: number) {
  const appointment = await prisma.appointment.create({
    data: {
      clinicId,
      patientId,
      startsAt: new Date(Date.now() + oreDaAdesso * 60 * 60 * 1000),
      durationMin: 30,
      visitType: 'Controllo',
    },
  });
  await syncReminders(prisma, appointment);
  return appointment;
}

/**
 * Spostare un appuntamento deve restare una cosa sola: senza questa funzione la
 * segreteria disdice e ricrea, e l'appuntamento "disdetto" finisce nelle
 * statistiche gonfiando le disdette e falsando il tasso di no-show.
 */
describe('spostamento di un appuntamento', () => {
  it('cambia data e ora e ricalcola i promemoria non ancora partiti', async () => {
    const { app, cookie, clinic, patient } = await setup();
    try {
      const appointment = await creaAppuntamento(clinic.id, patient.id, 24 * 7);
      const prima = await prisma.reminder.findUniqueOrThrow({
        where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/appointments/${appointment.id}`,
        cookies: { confermo_session: cookie },
        payload: { date: '2026-12-15', time: '10:30' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().localDate).toBe('15/12/2026');
      expect(res.json().localTime).toBe('10:30');
      // lo stato NON cambia: resta in attesa, non diventa disdetto
      expect(res.json().status).toBe('scheduled');

      const dopo = await prisma.reminder.findUniqueOrThrow({ where: { id: prima.id } });
      expect(dopo.scheduledFor.getTime()).not.toBe(prima.scheduledFor.getTime());
    } finally {
      await app.close();
    }
  });

  it('lo spostamento resta a registro come tale, non come disdetta', async () => {
    const { app, cookie, clinic, patient } = await setup();
    try {
      const appointment = await creaAppuntamento(clinic.id, patient.id, 24 * 7);
      await app.inject({
        method: 'PATCH',
        url: `/api/appointments/${appointment.id}`,
        cookies: { confermo_session: cookie },
        payload: { date: '2026-12-15', time: '10:30' },
      });

      const eventi = await prisma.eventLog.findMany({ where: { appointmentId: appointment.id } });
      const tipi = eventi.map((e) => e.type);
      expect(tipi).toContain('appointment_rescheduled');
      expect(tipi).not.toContain('appointment_status_changed');

      // e le statistiche non contano una disdetta
      const disdetti = await prisma.appointment.count({
        where: { clinicId: clinic.id, status: 'cancelled' },
      });
      expect(disdetti).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('un promemoria già inviato non viene toccato dallo spostamento', async () => {
    const { app, cookie, clinic, patient } = await setup();
    try {
      const appointment = await creaAppuntamento(clinic.id, patient.id, 40);
      const inviato = await prisma.reminder.update({
        where: { appointmentId_kind: { appointmentId: appointment.id, kind: 'reminder_48h' } },
        data: { status: 'sent', sentAt: new Date() },
      });

      await app.inject({
        method: 'PATCH',
        url: `/api/appointments/${appointment.id}`,
        cookies: { confermo_session: cookie },
        payload: { date: '2026-12-15', time: '10:30' },
      });

      const dopo = await prisma.reminder.findUniqueOrThrow({ where: { id: inviato.id } });
      expect(dopo.status).toBe('sent'); // la storia non si riscrive
      expect(dopo.scheduledFor.getTime()).toBe(inviato.scheduledFor.getTime());
    } finally {
      await app.close();
    }
  });

  it('si possono cambiare durata e tipologia senza spostare l’orario', async () => {
    const { app, cookie, clinic, patient } = await setup();
    try {
      const appointment = await creaAppuntamento(clinic.id, patient.id, 24 * 7);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/appointments/${appointment.id}`,
        cookies: { confermo_session: cookie },
        payload: { durationMin: 60, visitType: 'Prima visita' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().durationMin).toBe(60);
      expect(res.json().visitType).toBe('Prima visita');
      const dopo = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      expect(dopo.startsAt.getTime()).toBe(appointment.startsAt.getTime());
    } finally {
      await app.close();
    }
  });

  it('una data non valida viene rifiutata', async () => {
    const { app, cookie, clinic, patient } = await setup();
    try {
      const appointment = await creaAppuntamento(clinic.id, patient.id, 24);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/appointments/${appointment.id}`,
        cookies: { confermo_session: cookie },
        payload: { date: '31/02/2026', time: '10:00' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('rigenerazione del token del webhook', () => {
  it('genera un token diverso e cambia l’indirizzo del webhook', async () => {
    const { app, cookie, clinic } = await setup();
    try {
      await prisma.clinic.update({
        where: { id: clinic.id },
        data: { whatsappWebhookSecret: 'token-vecchio-esposto' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/whatsapp/webhook-token/rotate',
        cookies: { confermo_session: cookie },
      });

      expect(res.statusCode).toBe(200);
      const nuovo = await prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
      expect(nuovo.whatsappWebhookSecret).not.toBe('token-vecchio-esposto');
      expect(nuovo.whatsappWebhookSecret).toHaveLength(48);
      // l'indirizzo restituito contiene il token nuovo, non il vecchio
      expect(res.json().webhookUrl).toContain(nuovo.whatsappWebhookSecret!);
      expect(res.json().webhookUrl).not.toContain('token-vecchio-esposto');
    } finally {
      await app.close();
    }
  });

  it('il token vecchio smette davvero di funzionare sul webhook', async () => {
    const { app, cookie, clinic } = await setup();
    try {
      await prisma.clinic.update({
        where: { id: clinic.id },
        data: { whatsappWebhookSecret: 'token-vecchio-esposto' },
      });

      await app.inject({
        method: 'POST',
        url: '/api/whatsapp/webhook-token/rotate',
        cookies: { confermo_session: cookie },
      });

      const conVecchio = await app.inject({
        method: 'POST',
        url: `/api/webhooks/whatsapp/${clinic.id}?token=token-vecchio-esposto`,
        payload: { entry: [] },
      });
      expect(conVecchio.statusCode).toBe(401);

      const aggiornata = await prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
      const conNuovo = await app.inject({
        method: 'POST',
        url: `/api/webhooks/whatsapp/${clinic.id}?token=${aggiornata.whatsappWebhookSecret}`,
        payload: { entry: [] },
      });
      expect(conNuovo.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('la rotazione resta a registro', async () => {
    const { app, cookie, clinic } = await setup();
    try {
      await app.inject({
        method: 'POST',
        url: '/api/whatsapp/webhook-token/rotate',
        cookies: { confermo_session: cookie },
      });
      const evento = await prisma.eventLog.findFirst({
        where: { clinicId: clinic.id, type: 'whatsapp_webhook_token_rotated' },
      });
      expect(evento).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('senza sessione non si può rigenerare', async () => {
    const { app } = await setup();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/whatsapp/webhook-token/rotate' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
