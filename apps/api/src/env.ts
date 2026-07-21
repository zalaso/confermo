import './lib/load-env.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return v;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  port: Number(process.env.PORT ?? 3001),
  messagingProvider: (process.env.MESSAGING_PROVIDER ?? 'mock') as 'mock' | 'twilio',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // validata pigramente in lib/crypto.ts: serve solo quando si salvano/leggono credenziali
  appBaseUrl: process.env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`,
};
