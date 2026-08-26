// Prisma 7 project configuration.
// The CLI reads the datasource URL from here (Prisma 7 removed `url` from the
// schema's datasource block). Runtime code uses the same DATABASE_URL through
// a driver adapter — see src/lib/prisma.ts.
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
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=5',
  },
});
