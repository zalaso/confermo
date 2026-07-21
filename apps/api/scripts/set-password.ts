import '../src/lib/load-env.js';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { MIN_PASSWORD_LENGTH } from '@confermo/shared';

/**
 * Reimposta la password di uno studio dal server, quando l'accesso dalla
 * dashboard non è possibile (password dimenticata, cambio di segreteria).
 *
 *   npm run set-password -w apps/api -- --email studio@esempio.it --password "nuova password"
 *
 * Senza --password ne genera una casuale e la stampa una volta sola.
 */
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    list: { type: 'boolean', default: false },
  },
});

const prisma = new PrismaClient();
try {
  if (values.list) {
    const users = await prisma.user.findMany({ include: { clinic: { select: { name: true } } } });
    console.log('Utenti registrati:');
    for (const u of users) console.log(`  ${u.email}  →  ${u.clinic.name}`);
    process.exit(0);
  }

  if (!values.email) {
    console.error('Uso: npm run set-password -w apps/api -- --email <email> [--password <nuova>]');
    console.error('     npm run set-password -w apps/api -- --list');
    process.exit(1);
  }

  const email = values.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Nessun utente con email "${email}". Usa --list per vedere quelli esistenti.`);
    process.exit(1);
  }

  // password generata: leggibile ma non indovinabile
  const password =
    values.password ??
    Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 6)).join('-');

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });

  console.log(`Password aggiornata per ${email}.`);
  if (!values.password) console.log(`Nuova password: ${password}`);
  console.log('Comunicala allo studio su un canale sicuro e fagliela cambiare al primo accesso.');
} finally {
  await prisma.$disconnect();
}
