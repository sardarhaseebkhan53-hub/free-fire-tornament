// =============================================================================
// PrismaClient singleton — Prisma 7 driver-adapter architecture.
//
// The client never uses a native query engine: queries are compiled by the
// WASM query compiler bundled with the generated client and executed through
// the `pg` driver adapter. This keeps the backend portable (web, future
// Flutter app backend, CI, restricted networks) and fully API-first.
//
// Connection strategy (managed Postgres — Neon):
//   • RUNTIME (this file) uses DATABASE_URL → point it at Neon's POOLED
//     endpoint (host contains `-pooler…`). PgBouncer multiplexes thousands of
//     API clients over a handful of real Postgres connections, which is what
//     keeps 1,000–2,000 concurrent users from exhausting the connection cap.
//   • PRISMA CLI (migrate deploy / studio) uses DIRECT_URL via prisma.config.ts
//     → migrations need a real, unpooled session connection.
// =============================================================================
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';

const DEFAULT_DEV_URL =
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=20';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function buildClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DEV_URL;

  let parsed: URL | null = null;
  try {
    parsed = new URL(connectionString);
  } catch {
    // env.ts / prisma.config.ts report malformed URLs with better messages.
  }
  const isLocal = !parsed || LOCAL_HOSTS.has(parsed.hostname.replace(/^\[|\]$/g, ''));

  // Pool size: explicit `?connection_limit=N` in the URL always wins.
  // Otherwise 20 per process locally, 10 per process against a pooled managed
  // endpoint. The local number is deliberately not tiny: one money operation
  // can hold a transaction for its whole lifetime while the auth middleware
  // reads the account on the way in, so a 5-socket pool queues behind bursts of
  // five and the embedded dev server starts handing back torn sockets (which
  // then surface as P2039 / blank reads instead of honest backpressure). Size it so `instances × connection_limit` stays well under the
  // provider cap (Neon pooler: 10,000 — 2 instances × 10 is trivially safe
  // while absorbing 1,000–2,000 concurrent users; PgBouncer does the rest).
  const explicitLimit = Number(parsed?.searchParams.get('connection_limit') ?? NaN);
  const max = Number.isFinite(explicitLimit) && explicitLimit > 0
    ? explicitLimit
    : isLocal ? 20 : 10;

  // TLS: managed Postgres (Neon, Supabase, RDS…) requires SSL. `pg` honours
  // `?sslmode=` in the URL, but we pass an explicit setting so a missing
  // sslmode param still encrypts, and `sslmode=no-verify` keeps self-signed
  // setups workable. Local PGlite/Postgres runs plain.
  const sslmode = parsed?.searchParams.get('sslmode');
  const ssl = isLocal || sslmode === 'disable'
    ? false
    : { rejectUnauthorized: sslmode !== 'no-verify' };

  const adapter = new PrismaPg({
    connectionString,
    // Recycle pooled sockets BEFORE the dev PGlite server's idle teardown
    // (300s, see scripts/dev-db.mjs), so the pool never hands out connections
    // the server has already closed.
    max,
    idleTimeoutMillis: isLocal ? 90_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    ssl,
  });
  return new PrismaClient({ adapter });
}

// Reuse a single client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
