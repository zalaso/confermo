import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { buildServer } from '../../src/server.js';

const prisma = createTestClient();
const PASSWORD = 'password-di-prova';

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

/**
 * Gli endpoint d'azione (logout, "segna come gestito") si chiamano in POST
 * senza corpo. Se il client dichiara Content-Type JSON e non manda nulla,
 * Fastify di serie risponde 400 e l'azione non avviene mai — senza errori
 * visibili nell'interfaccia: il pulsante semplicemente non fa niente.
 *
 * È successo davvero in produzione, da qui questi test.
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

/** Ciò che manda il browser: intestazione JSON, corpo assente. */
const JSON_HEADER = { 'content-type': 'application/json' };

describe('POST senza corpo ma con Content-Type JSON', () => {
  it('il logout funziona e cancella il cookie di sessione', async () => {
    const { app, cookie } = await setup();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: JSON_HEADER,
        cookies: { confermo_session: cookie },
      });

      expect(res.statusCode).toBe(200);
      const cleared = res.cookies.find((c) => c.name === 'confermo_session');
      expect(cleared?.value).toBe(''); // cookie svuotato
    } finally {
      await app.close();
    }
  });

  it('"segna come gestito" marca davvero il messaggio', async () => {
    const { app, cookie, clinic } = await setup();
    try {
      const message = await prisma.inboundMessage.create({
        data: {
          clinicId: clinic.id,
          providerMessageId: 'wamid.da-gestire',
          kind: 'text',
          body: 'posso spostare?',
          fromMasked: '+39 333 •••• 456',
          needsAttention: true,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/inbound/${message.id}/handled`,
        headers: JSON_HEADER,
        cookies: { confermo_session: cookie },
      });

      expect(res.statusCode).toBe(200);
      const after = await prisma.inboundMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.needsAttention).toBe(false);
      expect(after.handledAt).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('un corpo JSON malformato resta un errore 400 con messaggio chiaro', async () => {
    const { app, cookie } = await setup();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: JSON_HEADER,
        cookies: { confermo_session: cookie },
        payload: '{ questo non è json',
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('una rotta con corpo obbligatorio fallisce sulla validazione, non sul parsing', async () => {
    const { app } = await setup();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: JSON_HEADER,
      });
      // 400 di validazione dello schema: il messaggio dice quale campo manca
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/email|body/i);
    } finally {
      await app.close();
    }
  });
});
