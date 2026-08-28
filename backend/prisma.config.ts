// Prisma 7 project configuration.
// The CLI reads the datasource URL from here (Prisma 7 removed `url` from the
// schema's datasource block). Runtime code uses the same DATABASE_URL through
// a driver adapter — see src/lib/prisma.ts.
//
// POOLED vs DIRECT (managed Postgres — Neon):
//   • DIRECT_URL (preferred) or DATABASE_URL is used by EVERY CLI command that
//     touches the schema: `prisma migrate deploy/dev`, `db push`, `studio`.
//     Migrations must NOT run through PgBouncer — transaction-mode pooling
//     breaks the advisory locks and session state the migration engine relies
//     on — so point DIRECT_URL at the plain (unpooled) Neon host.
//   • DATABASE_URL at RUNTIME is expected to be the POOLED endpoint (host
//     contains `-pooler…`) so the API can absorb 1,000–2,000 concurrent users.
//
// This is the Prisma 7 equivalent of the classic schema block:
//   datasource db {
//     url       = env("DATABASE_URL")   → runtime adapter (src/lib/prisma.ts)
//     directUrl = env("DIRECT_URL")     → datasource.url below (CLI)
//   }
import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=5',
  },
});
