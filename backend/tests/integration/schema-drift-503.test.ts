// =============================================================================
// SCHEMA DRIFT — when the running client expects a table the database does not
// have (migrations not applied to THIS database), an admin list used to answer
// with a raw 500 INTERNAL_ERROR. It must now answer 503 DATABASE_OUT_OF_DATE so
// the operator gets an actionable signal instead of "the server is broken".
//
// We force the drift inside one test by DROP TABLE on a relation the admin
// tournaments list joins (tournament_rooms), then restore it afterwards so the
// shared test database stays clean for the rest of the suite.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/lib/tokens';
import { db, makeUser } from '../helpers/db';

let server: Server;
let base = '';
let adminToken = '';
let roomSqlRestored = false;

beforeAll(async () => {
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const admin = await makeUser({ role: 'SUPER_ADMIN' });
  adminToken = signAccessToken({ sub: admin.id, role: 'SUPER_ADMIN', username: admin.username });
});

afterAll(async () => {
  if (!roomSqlRestored) {
    // Belt-and-braces: never leave the shared test DB drifted.
    await restoreRoomTable();
  }
  await new Promise((r) => server.close(r));
  await db.$disconnect();
});

async function dropRoomTable() {
  await db.$executeRawUnsafe('DROP TABLE IF EXISTS "tournament_rooms" CASCADE');
}

async function restoreRoomTable() {
  // Recreate via the actual migration SQL so the restored schema is byte-faithful.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const sql = readFileSync(
    join(process.cwd(), 'prisma/migrations/20260901100000_tournament_room/migration.sql'),
    'utf8',
  );
  // The type may already exist; drop it too so CREATE TYPE succeeds.
  await db.$executeRawUnsafe('DROP TYPE IF EXISTS "RoomStatus" CASCADE').catch(() => undefined);
  await db.$executeRawUnsafe(sql);
  roomSqlRestored = true;
}

describe('schema drift error contract', () => {
  it('answers a missing-table query with 503 DATABASE_OUT_OF_DATE, not a bare 500', async () => {
    await dropRoomTable();
    try {
      const res = await fetch(`${base}/api/admin/tournaments?page=1&pageSize=5`, {
        headers: { authorization: `Bearer ${adminToken}`, 'x-clutchnex-client': 'web' },
      });
      const body = (await res.json()) as { success: boolean; code: string };
      expect(res.status).toBe(503);
      expect(body.success).toBe(false);
      expect(body.code).toBe('DATABASE_OUT_OF_DATE');
    } finally {
      await restoreRoomTable();
    }

    // After restoring, the same list works again.
    const res2 = await fetch(`${base}/api/admin/tournaments?page=1&pageSize=5`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-clutchnex-client': 'web' },
    });
    expect(res2.status).toBe(200);
  });
});
