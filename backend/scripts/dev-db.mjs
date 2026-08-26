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
const server = new PGLiteSocketServer({ db, port: PORT, host: '0.0.0.0' });

await server.start();
console.log(`[dev-db] PGlite PostgreSQL ready on 0.0.0.0:${PORT} (data: ${DATA_DIR})`);
