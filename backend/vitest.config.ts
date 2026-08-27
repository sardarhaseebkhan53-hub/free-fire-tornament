// =============================================================================
// Phase 15 — test runner configuration.
//
// The suite runs against a REAL PostgreSQL (the same embedded PGlite the dev
// workflow uses) on its own port and data directory, so `npm test` never needs
// Docker, never touches `pgdata/`, and never needs a live dev server.
//
// The database is single-writer, so test files run one at a time.
// =============================================================================
import { defineConfig } from 'vitest/config';

export const TEST_DB_PORT = 55432;
export const TEST_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres?connection_limit=5`;

export default defineConfig({
  test: {
    globalSetup: ['./tests/setup/global.ts'],
    include: ['tests/**/*.test.ts'],
    // PGlite serialises writes through one executor — parallel files would only
    // queue, so run sequentially and keep the output readable.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      CLIENT_ORIGIN: 'http://localhost:3000',
      JWT_ACCESS_SECRET: 'test-access-secret-not-for-production',
      JWT_REFRESH_SECRET: 'test-refresh-secret-not-for-production',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL_DAYS: '7',
      MAX_UPLOAD_MB: '5',
      UPLOAD_DIR: '.test-uploads',
    },
  },
});
