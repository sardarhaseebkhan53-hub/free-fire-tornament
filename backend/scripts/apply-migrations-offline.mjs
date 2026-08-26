// Offline migration applier — reproduces `prisma migrate dev` for sandboxes
// where the native schema-engine binary can't be downloaded (binaries.prisma.sh
// unreachable). Applies prisma/migrations/*.sql through the pg wire protocol
// and records them in `_prisma_migrations` exactly as the CLI would, so
// `prisma migrate status` reports a clean state afterwards.
//
//   node scripts/apply-migrations-offline.mjs
//
import 'dotenv/config';
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=1';

const MIGRATIONS_DIR = new URL('../prisma/migrations', import.meta.url).pathname;

const dirs = readdirSync(MIGRATIONS_DIR)
  .filter((d) => !d.startsWith('.') && d !== 'migration_lock.toml')
  .sort();

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

await db.query(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id                      VARCHAR(36) NOT NULL,
    checksum                VARCHAR(64) NOT NULL,
    finished_at             TIMESTAMPTZ,
    migration_name          VARCHAR(255) NOT NULL,
    logs                    TEXT,
    rolled_back_at          TIMESTAMPTZ,
    started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count     INTEGER NOT NULL DEFAULT 0
  );
`);

const applied = new Set(
  (await db.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`))
    .rows.map((r) => r.migration_name),
);

for (const dir of dirs) {
  if (applied.has(dir)) {
    console.log(`= ${dir} (already applied)`);
    continue;
  }
  const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const id = crypto.randomUUID();
  const started = new Date();
  try {
    await db.query('BEGIN');
    await db.query(sql);
    await db.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, $4, 1)`,
      [id, checksum, dir, started],
    );
    await db.query('COMMIT');
    console.log(`✓ ${dir} applied`);
  } catch (e) {
    await db.query('ROLLBACK');
    console.error(`✗ ${dir} FAILED — ${e.message}`);
    process.exit(1);
  }
}

await db.end();
console.log('\nAll migrations in sync.');
