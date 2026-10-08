// ─── Prisma Client Singleton ────────────────────────────────────────────────
// A fresh PrismaClient per import would exhaust Postgres connections under
// hot-reload (tsx watch re-executes modules). Cache it on `globalThis` in
// development so watch-mode reuses the same connection pool.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
