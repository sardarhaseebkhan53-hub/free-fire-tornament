// PHASE 18 certification — a REAL PostgreSQL server, not the embedded engine.
//
// Why this exists: every concurrency proof so far ran on PGlite, which is a
// single-writer execution engine. That is a fine dev database, but it means the
// 100-way surge was measuring the *harness* as much as the app — and when a read
// blipped, it was impossible to say whether the application or the engine caused
// it. This script boots an actual postgres(1) process (multi-process backends,
// real fsync, real WAL, real lock manager) from the `embedded-postgres` binary
// package, so the same surge can be re-run against the thing we actually deploy.
//
//   node scripts/real-db.mjs                 # data in /home/user/pgdata-real
//   REAL_PG_PORT=55433 npm run db:real
//
// Dev/certification only. Never a production primitive: production points
// DATABASE_URL at a managed PostgreSQL and this file is not involved.
import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

const DATA_DIR = process.env.REAL_PG_DIR ?? '/home/user/pgdata-real';
const PORT = Number(process.env.REAL_PG_PORT ?? 55433);

const cluster = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  port: PORT,
  user: 'postgres',
  password: 'postgres',
  authMethod: 'password',
  // persistent: shut down without deleting the cluster, so a certification run
  // can be repeated against the same data (and inspected afterwards).
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--data-checksums'],
  // Deliberately NOT tuned for speed: fsync and synchronous_commit stay ON, and
  // max_connections is far above the API's pool so the app cannot blame the
  // server for exhaustion. `idle_in_transaction_session_timeout` mirrors what a
  // managed provider sets, so an abandoned transaction gets reaped here too.
  postgresFlags: [
    '-c', 'max_connections=200',
    '-c', 'shared_buffers=256MB',
    '-c', 'effective_cache_size=1GB',
    '-c', 'fsync=on',
    '-c', 'synchronous_commit=on',
    '-c', 'wal_level=replica',
    '-c', 'listen_addresses=127.0.0.1',
    '-c', 'idle_in_transaction_session_timeout=60s',
    '-c', 'statement_timeout=30s',
    '-c', 'log_min_messages=warning',
  ],
  onLog: (m) => process.stdout.write(`[pg] ${String(m).trimEnd()}\n`),
  onError: (m) => process.stderr.write(`[pg!] ${String(m).trimEnd()}\n`),
});

if (!existsSync(`${DATA_DIR}/PG_VERSION`)) {
  process.stdout.write(`[real-db] initdb into ${DATA_DIR} …\n`);
  await cluster.initialise();
}
await cluster.start();
process.stdout.write(`[real-db] real PostgreSQL 17 ready on 127.0.0.1:${PORT}\n`);
process.stdout.write('[real-db] DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:' + PORT + '/postgres?connection_limit=20\n');

await new Promise((resolve) => {
  process.on('SIGTERM', resolve);
  process.on('SIGINT', resolve);
});
await cluster.stop();
process.exit(0);
