import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import bcrypt from 'bcryptjs';
import { MIN_PASSWORD_LENGTH } from '@confermo/shared';
import { prisma } from '../db.js';
import { COOKIE_NAME } from '../plugins/auth.js';
import { changePasswordRateLimit, loginRateLimit } from '../plugins/rateLimit.js';
import { logEvent } from '../lib/events.js';
import { toClinicDto } from './clinic.js';

export default async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    '/login',
    {
      config: { rateLimit: loginRateLimit },
      schema: {
        body: Type.Object({
          email: Type.String({ format: 'email' }),
          password: Type.String({ minLength: 1 }),
        }),
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return reply.code(401).send({ error: 'Email o password errati' });
      }
      const token = app.jwt.sign({ sub: user.id, clinicId: user.clinicId });
      return reply
        .setCookie(COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 30 * 24 * 60 * 60,
        })
        .send({ ok: true });
    },
  );

  app.post('/logout', async (_req, reply) => {
    return reply.clearCookie(COOKIE_NAME, { path: '/' }).send({ ok: true });
  });

  app.get('/me', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    const clinic = await prisma.clinic.findUnique({ where: { id: req.user.clinicId } });
    if (!clinic) {
      // Il cookie punta a uno studio che non esiste più (studio eliminato,
      // oppure database ricreato da un seed). Va trattato come sessione
      // scaduta: l'utente rivede la schermata di accesso, non un errore.
      return reply.clearCookie(COOKIE_NAME, { path: '/' }).code(401).send({ error: 'Sessione scaduta' });
    }
    return { clinic: toClinicDto(clinic) };
  });

  /**
   * Cambio password dello studio. Richiede la password attuale: il cookie di
   * sessione da solo non basta, così un dispositivo lasciato aperto non
   * permette di prendere possesso dell'account.
   */
  app.post(
    '/change-password',
    {
      onRequest: [fastify.authenticate],
      config: { rateLimit: changePasswordRateLimit },
      schema: {
        body: Type.Object({
          currentPassword: Type.String({ minLength: 1 }),
          newPassword: Type.String({ minLength: MIN_PASSWORD_LENGTH, maxLength: 200 }),
        }),
      },
    },
    async (req, reply) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
      if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) {
        return reply.code(401).send({ error: 'La password attuale non è corretta' });
      }
      if (req.body.newPassword === req.body.currentPassword) {
        return reply.code(422).send({ error: 'La nuova password deve essere diversa da quella attuale' });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(req.body.newPassword, 10) },
      });
      await logEvent(prisma, { clinicId: user.clinicId, type: 'password_changed' });

      // la sessione corrente resta valida: chi ha appena cambiato la password
      // non deve ritrovarsi buttato fuori
      return { ok: true };
    },
  );
}
