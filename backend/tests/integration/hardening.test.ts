// =============================================================================
// Integration — REGRESSION SUITE for the production-hardening audit.
//
// Every test here corresponds to a defect found during the audit. They run the
// REAL Express app over HTTP so routing, middleware and services are all in
// the loop.
//
//   1. /api/health  — must be reachable when the shared per-IP rate limit is
//                     exhausted (load-balancer probes were getting 429s) and
//                     must report real dependency health.
//   2. Session security — a SUSPENDED/BANNED/soft-deleted account must lose
//                     access immediately, even while holding a valid,
//                     unexpired access token.
//   3. Concurrent refresh — a burst of parallel refreshes with the same
//                     single-use cookie must keep the session alive (this is
//                     the "logged out after ~5 minutes" bug).
//   4. RBAC — role claims in the JWT are never trusted over the database.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/lib/tokens';
import * as auth from '../../src/services/auth.service';
import { cleanupUsers, db, makeUser } from '../helpers/db';

const created: string[] = [];
const ctx = { ip: '203.0.113.77', userAgent: 'vitest-hardening' };

let server: Server;
let base = '';

beforeAll(async () => {
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await cleanupUsers(created);
  await db.$disconnect();
});

async function call(path: string, token?: string) {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
describe('health endpoint', () => {
  it('reports ok plus a real database probe', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    const data = res.json.data as Record<string, unknown>;
    expect(data.status).toBe('ok');
    // Proves the handler actually round-trips to the database rather than
    // returning a hardcoded "ok" that stays green while the DB is down.
    expect(data.database).toBe('up');
  });

  it('never leaks infrastructure details', async () => {
    const body = JSON.stringify((await call('/api/health')).json);
    for (const secret of ['postgres', 'password', 'DATABASE_URL', 'connectionString']) {
      expect(body).not.toContain(secret);
    }
  });

  it('is mounted BEFORE the global rate limiter', async () => {
    // Regression: the probe used to sit behind `apiLimiter`, so a monitor
    // polling every few seconds eventually got 429s and the platform declared
    // the service unhealthy. Hammer it well past any sane per-IP budget.
    const results = await Promise.all(
      Array.from({ length: 120 }, () => call('/api/health')),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('session security — account status is re-checked on every request', () => {
  for (const status of ['SUSPENDED', 'BANNED'] as const) {
    it(`a ${status} account loses access despite a valid access token`, async () => {
      const u = await makeUser({ prefix: 'hard' });
      created.push(u.id);
      const token = signAccessToken({ sub: u.id, role: 'USER', username: u.username });

      // Valid while ACTIVE…
      expect((await call('/api/notifications', token)).status).toBe(200);

      // …and dead the moment the account is stopped, with the SAME token.
      await db.user.update({ where: { id: u.id }, data: { status } });
      const after = await call('/api/notifications', token);
      expect(after.status).toBe(401);
      expect(after.json.code).toBe('UNAUTHORIZED');
    });
  }

  it('a soft-deleted account cannot keep using its token', async () => {
    const u = await makeUser({ prefix: 'hard' });
    created.push(u.id);
    const token = signAccessToken({ sub: u.id, role: 'USER', username: u.username });
    await db.user.update({
      where: { id: u.id },
      data: { status: 'SUSPENDED', deletedAt: new Date() },
    });
    expect((await call('/api/notifications', token)).status).toBe(401);
  });

  it('a token for a user id that does not exist is refused', async () => {
    const token = signAccessToken({ sub: 'no-such-user-id', role: 'ADMIN', username: 'ghost' });
    expect((await call('/api/admin/users', token)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('RBAC — the database role wins over the JWT claim', () => {
  it('a forged ADMIN claim on a USER account cannot reach admin APIs', async () => {
    const u = await makeUser({ prefix: 'hard' });
    created.push(u.id);
    // Signed with the REAL server secret, but claiming a role the account
    // does not have — requireAuth re-reads the row and downgrades it.
    const forged = signAccessToken({ sub: u.id, role: 'SUPER_ADMIN', username: u.username });
    const res = await call('/api/admin/users', forged);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('FORBIDDEN');
  });

  it('anonymous access to admin APIs is 401, not 403 or 200', async () => {
    expect((await call('/api/admin/users')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('concurrent refresh — the ~5-minute logout bug', () => {
  // A burst of parallel API calls all hitting 401 at access-token expiry each
  // triggers a refresh with the SAME single-use cookie. Naive rotation-replay
  // detection reads that as theft and revokes every session — the user is
  // logged out at random. Grace-chaining must keep the session alive.
  for (const n of [2, 5, 8, 20]) {
    it(`${n} simultaneous refreshes keep the session alive`, async () => {
      const u = await makeUser({ prefix: 'hard' });
      created.push(u.id);
      const { refreshToken } = await auth.login(u.username, u.password, ctx);

      const results = await Promise.allSettled(
        Array.from({ length: n }, () => auth.refreshSession(refreshToken, ctx)),
      );
      const okCount = results.filter((r) => r.status === 'fulfilled').length;
      expect(okCount).toBe(n);

      // Every racer must end up with a usable access token…
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const value = r.value as { accessToken: string; refreshToken: string };
        expect(value.accessToken).toBeTruthy();
        expect((await call('/api/notifications', value.accessToken)).status).toBe(200);
      }

      // …and the account must still hold at least one live session.
      const live = await db.authToken.count({
        where: { userId: u.id, type: 'REFRESH', revokedAt: null },
      });
      expect(live).toBeGreaterThanOrEqual(1);

      // A benign race is NOT theft: no fraud alert may be raised.
      const alerts = await db.fraudAlert.count({
        where: { kind: 'REFRESH_TOKEN_REUSE', userId: u.id },
      });
      expect(alerts).toBe(0);
    });
  }

  it('the newest cookie from a race still refreshes afterwards', async () => {
    const u = await makeUser({ prefix: 'hard' });
    created.push(u.id);
    const { refreshToken } = await auth.login(u.username, u.password, ctx);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => auth.refreshSession(refreshToken, ctx)),
    );
    // Chain onwards from the last winner — the session must survive the race.
    const last = results[results.length - 1]!;
    const next = await auth.refreshSession(last.refreshToken, ctx);
    expect(next.accessToken).toBeTruthy();
  });

  it('a revoked (logged-out) session cannot be refreshed', async () => {
    const u = await makeUser({ prefix: 'hard' });
    created.push(u.id);
    const { refreshToken } = await auth.login(u.username, u.password, ctx);
    await db.authToken.updateMany({
      where: { userId: u.id, type: 'REFRESH' },
      data: { revokedAt: new Date(Date.now() - 10 * 60_000) }, // outside the grace window
    });
    await expect(auth.refreshSession(refreshToken, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('logout actually ends the session', () => {
  it('a cookie already rotated within the grace window is still logged out', async () => {
    // REGRESSION: `logout` resolved the presented cookie with `findToken`,
    // which filters on `revokedAt: null`. Refresh tokens rotate on every use
    // and a within-grace replay is deliberately chained onto its successor, so
    // the cookie a tab holds is very often already-revoked-but-chainable.
    // For exactly those cookies logout matched nothing and did nothing — the
    // "logged out" cookie could grace-chain straight back into a live session.
    const u = await makeUser({ prefix: 'hard' });
    created.push(u.id);
    const { refreshToken } = await auth.login(u.username, u.password, ctx);

    // Rotate once: `refreshToken` is now revoked-but-inside-the-grace-window.
    await auth.refreshSession(refreshToken, ctx);

    await auth.logout(refreshToken);

    // The old cookie must NOT be able to chain back into a session…
    await expect(auth.refreshSession(refreshToken, ctx)).rejects.toThrow();
    // …and no refresh token may remain live for the account.
    const live = await db.authToken.count({
      where: { userId: u.id, type: 'REFRESH', revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('logout revokes sibling sessions (other tabs / devices)', async () => {
    const u = await makeUser({ prefix: 'hard' });
    created.push(u.id);
    const a = await auth.login(u.username, u.password, ctx);
    const b = await auth.login(u.username, u.password, ctx);

    await auth.logout(a.refreshToken);

    // The OTHER device's cookie must be dead too.
    await expect(auth.refreshSession(b.refreshToken, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('admin suspension forces a logout', () => {
  it('suspending an account revokes its refresh tokens', async () => {
    // REGRESSION: suspension flipped `status` but left refresh tokens live, so
    // lifting the suspension silently resurrected every session the offender
    // still had open.
    const u = await makeUser({ prefix: 'hard' });
    const admin = await makeUser({ prefix: 'hard', role: 'ADMIN' });
    created.push(u.id, admin.id);
    const { refreshToken } = await auth.login(u.username, u.password, ctx);

    const { setUserStatus } = await import('../../src/services/admin.service');
    await setUserStatus(admin.id, u.id, 'SUSPENDED', 'abuse', ctx);

    expect(await db.authToken.count({
      where: { userId: u.id, type: 'REFRESH', revokedAt: null },
    })).toBe(0);

    // Restoring the account must NOT bring the old session back.
    await setUserStatus(admin.id, u.id, 'ACTIVE', '', ctx);
    await expect(auth.refreshSession(refreshToken, ctx)).rejects.toThrow();
  });

  it('the suspension, the revocation and the audit row commit together', async () => {
    const u = await makeUser({ prefix: 'hard' });
    const admin = await makeUser({ prefix: 'hard', role: 'ADMIN' });
    created.push(u.id, admin.id);
    await auth.login(u.username, u.password, ctx);

    const { setUserStatus } = await import('../../src/services/admin.service');
    await setUserStatus(admin.id, u.id, 'BANNED', 'cheating', ctx);

    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe('BANNED');
    expect(await db.auditLog.count({
      where: { action: 'USER_BANNED', entity: 'User', entityId: u.id },
    })).toBe(1);
    expect(await db.authToken.count({
      where: { userId: u.id, type: 'REFRESH', revokedAt: null },
    })).toBe(0);
  });
});
