import { env } from './env.js';
import { prisma } from './db.js';
import { buildServer } from './server.js';
import { resolveProvider } from './messaging/index.js';
import { startDispatcher } from './services/dispatcher.js';

const app = await buildServer();

const stopDispatcher = startDispatcher(prisma, resolveProvider);

const shutdown = async () => {
  stopDispatcher();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.port, host: '0.0.0.0' });
console.log(
  `Confermo API in ascolto su http://localhost:${env.port} (fallback provider: ${env.messagingProvider})`,
);
