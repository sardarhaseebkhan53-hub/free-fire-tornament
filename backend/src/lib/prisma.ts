// =============================================================================
// PrismaClient singleton — Prisma 7 driver-adapter architecture.
//
// The client never uses a native query engine: queries are compiled by the
// WASM query compiler bundled with the generated client and executed through
// the `pg` driver adapter. This keeps the backend portable (web, future
// Flutter app backend, CI, restricted networks) and fully API-first.
// =============================================================================
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';

const DEFAULT_URL =
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=5';

function buildClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_URL;
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// Reuse a single client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
