import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { buildServer } from '../../src/server.js';

const prisma = createTestClient();
const PASSWORD = 'password-di-prova';

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));

/**
 * L'API sotto test usa il client Prisma "di produzione" (src/db.ts), che punta
 * al DATABASE_URL dell'ambiente. In test è quello del Postgres dedicato,
 * impostato dal global setup.
 */
async function buildApp() {
  const app = await buildServer();
  await app.ready();
  return app;
}

async function seedUser() {
  const base = await seedBase(prisma);
  const user = await prisma.user.create({
    data: {
      clinicId: base.clinic.id,
      email: 'studio@test.it',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  return { ...base, user };
}

describe('accesso e sessione', () => {
  it('login corretto, poi /me restituisce lo studio', async () => {
    const { clinic } = await seedUser();
    const app = await buildApp();
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'studio@test.it', password: PASSWORD },
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.cookies.find((c) => c.name === 'confermo_session')!;
      expect(cookie).toBeDefined();

      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { confermo_session: cookie.value },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().clinic.id).toBe(clinic.id);
    } finally {
      await app.close();
    }
  });

  it('sessione che punta a uno studio eliminato: 401, non 500', async () => {
    const { clinic } = await seedUser();
    const app = await buildApp();
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'studio@test.it', password: PASSWORD },
      });
      const cookie = login.cookies.find((c) => c.name === 'confermo_session')!;

      // lo studio sparisce (eliminato, oppure database ricreato da un seed)
      await prisma.clinic.delete({ where: { id: clinic.id } });

      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { confermo_session: cookie.value },
      });
      expect(me.statusCode).toBe(401);
      expect(me.json().error).toMatch(/scaduta/i);
    } finally {
      await app.close();
    }
  });

  it('anche le altre rotte rispondono 401 se lo studio non esiste più', async () => {
    // caso reale: un `seed` ricrea lo studio mentre la dashboard sta facendo
    // polling. Senza questa gestione l'utente vedrebbe una schermata rotta
    // invece di tornare alla pagina di accesso.
    const { clinic } = await seedUser();
    const app = await buildApp();
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'studio@test.it', password: PASSWORD },
      });
      const cookie = login.cookies.find((c) => c.name === 'confermo_session')!.value;

      await prisma.clinic.delete({ where: { id: clinic.id } });

      for (const url of ['/api/appointments', '/api/clinic', '/api/whatsapp/settings']) {
        const res = await app.inject({
          method: 'GET',
          url,
          cookies: { confermo_session: cookie },
        });
        expect(res.statusCode, `${url} dovrebbe rispondere 401`).toBe(401);
      }
    } finally {
      await app.close();
    }
  });

  it('senza cookie /me risponde 401', async () => {
    const app = await buildApp();
    try {
      const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(me.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('cambio password', () => {
  async function loginCookie(app: Awaited<ReturnType<typeof buildApp>>, password = PASSWORD) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'studio@test.it', password },
    });
    return res.cookies.find((c) => c.name === 'confermo_session')?.value;
  }

  it('con la password attuale corretta la password cambia davvero', async () => {
    await seedUser();
    const app = await buildApp();
    try {
      const cookie = await loginCookie(app);
      const change = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        cookies: { confermo_session: cookie! },
        payload: { currentPassword: PASSWORD, newPassword: 'una-nuova-password' },
      });
      expect(change.statusCode).toBe(200);

      expect(await loginCookie(app, 'una-nuova-password')).toBeDefined();
      expect(await loginCookie(app, PASSWORD)).toBeUndefined(); // la vecchia non vale più
    } finally {
      await app.close();
    }
  });

  it('password attuale sbagliata: nessun cambiamento', async () => {
    await seedUser();
    const app = await buildApp();
    try {
      const cookie = await loginCookie(app);
      const change = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        cookies: { confermo_session: cookie! },
        payload: { currentPassword: 'non-e-questa', newPassword: 'una-nuova-password' },
      });
      expect(change.statusCode).toBe(401);
      expect(await loginCookie(app, PASSWORD)).toBeDefined(); // la vecchia funziona ancora
    } finally {
      await app.close();
    }
  });

  it('password nuova troppo corta: rifiutata', async () => {
    await seedUser();
    const app = await buildApp();
    try {
      const cookie = await loginCookie(app);
      const change = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        cookies: { confermo_session: cookie! },
        payload: { currentPassword: PASSWORD, newPassword: 'corta' },
      });
      expect(change.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('protezione dagli attacchi a forza bruta sul login', () => {
  it('dopo 8 tentativi falliti l’account viene bloccato temporaneamente', async () => {
    await seedUser();
    const app = await buildApp();
    try {
      for (let i = 0; i < 8; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'studio@test.it', password: 'sbagliata' },
          remoteAddress: '203.0.113.10',
        });
        expect(res.statusCode).toBe(401);
      }

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'studio@test.it', password: 'sbagliata' },
        remoteAddress: '203.0.113.10',
      });
      expect(blocked.statusCode).toBe(429);

      // anche la password GIUSTA resta bloccata: è il senso della protezione
      const withRightPassword = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'studio@test.it', password: PASSWORD },
        remoteAddress: '203.0.113.10',
      });
      expect(withRightPassword.statusCode).toBe(429);

      // un ALTRO studio dallo stesso indirizzo non è coinvolto: sulle reti
      // mobili migliaia di utenti condividono lo stesso IP pubblico
      const otherAccount = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'altro@test.it', password: 'qualsiasi' },
        remoteAddress: '203.0.113.10',
      });
      expect(otherAccount.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
