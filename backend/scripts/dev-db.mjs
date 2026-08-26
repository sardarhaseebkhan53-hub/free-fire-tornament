// Embedded PostgreSQL (PGlite) over a local TCP socket — dev convenience only.
// Production uses a real/managed PostgreSQL via DATABASE_URL.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = resolve(process.cwd(), '..', 'pgdata'); // workspace-persistent
const PORT = Number(process.env.PG_PORT || 5432);

mkdirSync(DATA_DIR, { recursive: true });
const db = new PGlite(DATA_DIR);
// PGlite is single-writer: the socket server queues queries from all
// connections through one executor, so raising maxConnections is safe and
// required for connection pools (default is 1, which resets pooled clients).
// idleTimeout tears down stale connections so abandoned transaction state is
// rolled back instead of wedging the shared session.
const server = new PGLiteSocketServer({
  db, port: PORT, host: '0.0.0.0', maxConnections: 10, idleTimeout: 120_000,
});

await server.start();
console.log(`[dev-db] PGlite PostgreSQL ready on 0.0.0.0:${PORT} (data: ${DATA_DIR})`);
