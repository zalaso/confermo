import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

/** Client utilizzabile sia dentro che fuori da una transazione. */
export type Db = PrismaClient | Prisma.TransactionClient;
