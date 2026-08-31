// =============================================================================
// DEV-ONLY database self-heal — apply pending Prisma migrations at boot.
//
// The embedded dev database (npm run db:dev → PGlite on :5432) PERSISTS its
// data directory across restarts and `git pull`s. After pulling a branch that
// ships a new migration (e.g. tournament_rooms, check_in, push_subscriptions),
// the freshly generated Prisma client starts querying tables/columns the local
// database does not have yet — every such query throws
// `The table ... does not exist`, which the API answers with a raw 500 and the
// browser console fills with "Failed to load resource: 500".
//
// Production NEVER runs this: deployments run `npm run db:migrate`
// (prisma migrate deploy / Railway release phase) before the API boots, and an
// automatic migration on a pooled production connection is wrong on several
// levels. This module runs only when NODE_ENV !== 'production'.
//
// It applies the same SQL files as scripts/apply-migrations-offline.mjs and
// records them in _prisma_migrations exactly as the Prisma CLI would, so a
// later `prisma migrate status` stays consistent.
// =============================================================================
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { env } from './env';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

async function applyPendingMigrations(connectionString: string): Promise<string[]> {
  const pool = new Pool({ connectionString, max: 1 });
  const applied: string[] = [];
  try {
    await pool.query(`
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

    const { rows } = await pool.query(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const done = new Set(rows.map((r: { migration_name: string }) => r.migration_name));

    const dirs = readdirSync(MIGRATIONS_DIR)
      .filter((d) => !d.startsWith('.') && d !== 'migration_lock.toml')
      .sort();

    for (const dir of dirs) {
      if (done.has(dir)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, now(), 1)`,
          [randomUUID(), checksum, dir],
        );
        await client.query('COMMIT');
        applied.push(dir);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`migration ${dir} failed: ${(e as Error).message}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
  return applied;
}

/**
 * Dev/test self-heal. Best-effort: if the database is unreachable (e.g. the
 * developer hasn't started `npm run db:dev` yet), we log and continue — the
 * request layer already returns honest connection errors instead of crashing.
 * Never awaited in a way that blocks production boot.
 */
export async function syncDevDatabase(): Promise<void> {
  if (env.NODE_ENV === 'production') return;

  const connectionString = env.DATABASE_URL;
  try {
    const fresh = await applyPendingMigrations(connectionString);
    if (fresh.length > 0) {
      console.log(`[auto-migrate] applied ${fresh.length} pending migration(s): ${fresh.join(', ')}`);
    }
  } catch (e) {
    console.warn(
      '[auto-migrate] could not apply pending migrations (is the dev database running? `npm run db:dev`):',
      (e as Error)?.message,
    );
  }
}
