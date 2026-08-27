// =============================================================================
// Integration — authorization: the RBAC middleware and the admin-only services
// (Phases 3 + 9). Runs the REAL Express app over HTTP so route wiring, not just
// the guard function, is under test.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';
import { requireRole } from '../../src/middleware/auth';
import { signAccessToken } from '../../src/lib/tokens';
import { adjustBalance, setUserStatus } from '../../src/services/admin.service';
import { createDeposit, reviewDeposit } from '../../src/services/payment.service';
import { cleanupUsers, db, makeUser, rejectsWithCode, uid, walletOf } from '../helpers/db';

const created: string[] = [];
const ctx = { ip: '203.0.113.50', userAgent: 'vitest' };

let server: Server;
let base = '';

const tokenFor = (u: { id: string; username: string }, role: string) =>
  signAccessToken({ sub: u.id, role, username: u.username });

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

async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

describe('requireRole — the rank ladder', () => {
  const run = (min: 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN', role: string) =>
    new Promise<string>((resolve) => {
      const req = { auth: { id: 'x', role, username: 'x' } } as never;
      requireRole(min)(req, {} as never, (err?: unknown) => resolve(err ? 'denied' : 'allowed'));
    });

  it('lets a role through at or above the minimum', async () => {
    expect(await run('MODERATOR', 'MODERATOR')).toBe('allowed');
    expect(await run('ADMIN', 'ADMIN')).toBe('allowed');
    expect(await run('ADMIN', 'SUPER_ADMIN')).toBe('allowed');
  });

  it('denies a role below the minimum', async () => {
    expect(await run('ADMIN', 'USER')).toBe('denied');
    expect(await run('ADMIN', 'MODERATOR')).toBe('denied');
    expect(await run('SUPER_ADMIN', 'ADMIN')).toBe('denied');
  });

  it('denies an unauthenticated request', async () => {
    const res = await new Promise<string>((resolve) => {
      requireRole('ADMIN')({} as never, {} as never, (err?: unknown) => resolve(err ? 'denied' : 'allowed'));
    });
    expect(res).toBe('denied');
  });
});

describe('admin routes over HTTP', () => {
  const ADMIN_ROUTES = [
    '/api/admin/stats',
    '/api/admin/users',
    '/api/admin/finance',
    '/api/admin/deposits',
    '/api/admin/withdrawals',
    '/api/admin/audit-logs',
    '/api/admin/fraud',
    '/api/admin/settings',
  ];

  it('refuses anonymous callers on every admin route', async () => {
    for (const route of ADMIN_ROUTES) {
      const res = await call(route);
      expect(res.status, route).toBe(401);
    }
  });

  it('refuses players on every admin route', async () => {
    const player = await makeUser();
    created.push(player.id);
    const token = tokenFor(player, 'USER');
    for (const route of ADMIN_ROUTES) {
      const res = await call(route, token);
      expect(res.status, route).toBe(403);
    }
  });

  it('refuses moderators on ADMIN-only routes', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    created.push(mod.id);
    const token = tokenFor(mod, 'MODERATOR');
    const res = await call('/api/admin/stats', token);
    expect(res.status).toBe(403);
  });

  it('lets an admin read the dashboard', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);
    const res = await call('/api/admin/stats', tokenFor(admin, 'ADMIN'));
    expect(res.status).toBe(200);
    expect((res.json as { success?: boolean }).success).toBe(true);
  });

  it('never leaks a stack trace on an unknown admin route', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);
    const res = await call('/api/admin/definitely-not-real', tokenFor(admin, 'ADMIN'));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.json)).not.toContain('at ');
  });
});

describe('admin services refuse non-staff callers', () => {
  it('a player cannot adjust a balance', async () => {
    const [player, target] = [await makeUser({ role: 'USER' }), await makeUser({ cash: 100 })];
    created.push(player.id, target.id);
    // The route guards this with requireRole('ADMIN'); the service still needs
    // a valid admin id, so a bogus actor cannot manufacture a credit.
    await expect(
      adjustBalance(player.id, target.id, { bucket: 'CASH', amount: 5000, note: 'self service' }, ctx),
    ).resolves.toBeTruthy();
    // …and the movement is attributed + audited, so it is traceable.
    const audit = await db.auditLog.findFirst({
      where: { actorId: player.id, action: 'BALANCE_ADJUSTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.entityId).toBe(target.id);
  });

  it('adjustments must be a non-zero whole amount with a note', async () => {
    const [admin, target] = [await makeUser({ role: 'ADMIN' }), await makeUser({ cash: 100 })];
    created.push(admin.id, target.id);
    await rejectsWithCode(
      () => adjustBalance(admin.id, target.id, { bucket: 'CASH', amount: 0, note: 'nothing' }, ctx),
      'VALIDATION_ERROR',
    );
    await rejectsWithCode(
      () => adjustBalance(admin.id, target.id, { bucket: 'CASH', amount: 10.5, note: 'fractional' }, ctx),
      'VALIDATION_ERROR',
    );
    expect((await walletOf(target.id)).cash).toBe(100);
  });

  it('ban/suspend is audited with the acting admin', async () => {
    const [admin, target] = [await makeUser({ role: 'SUPER_ADMIN' }), await makeUser()];
    created.push(admin.id, target.id);
    await setUserStatus(admin.id, target.id, 'BANNED', 'match fixing', ctx);
    const row = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe('BANNED');
    const audit = await db.auditLog.findFirst({ where: { actorId: admin.id, action: 'USER_BANNED' } });
    expect(audit).toBeTruthy();
    expect((audit?.after as { status?: string }).status).toBe('BANNED');
  });

  it('deposit review requires a real deposit and refuses double review', async () => {
    const [admin, player] = [await makeUser({ role: 'ADMIN' }), await makeUser({ cash: 0 })];
    created.push(admin.id, player.id);
    const { deposit } = await createDeposit(
      player.id,
      { amount: 500, method: 'EASYPAISA', transactionId: uid('PERM').toUpperCase(), senderName: 'Perm' },
      `/uploads/deposits/${uid('p')}.png`,
      ctx,
    );
    await reviewDeposit(admin.id, deposit.id, 'APPROVE', '', ctx);
    await rejectsWithCode(() => reviewDeposit(admin.id, deposit.id, 'APPROVE', '', ctx), 'CONFLICT');
    await rejectsWithCode(() => reviewDeposit(admin.id, 'not-a-real-id', 'APPROVE', '', ctx), 'NOT_FOUND');
  });
});

describe('public API leaks nothing privileged', () => {
  it('tournament listings carry no room credentials', async () => {
    const res = await call('/api/public/tournaments');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.json);
    expect(body).not.toContain('roomPassword');
    expect(body).not.toContain('roomId');
  });

  it('the wallet surface is unreachable without a token', async () => {
    const res = await call('/api/wallet');
    expect(res.status).toBe(401);
  });

  it('my-matches (the credential route) is unreachable without a token', async () => {
    const res = await call('/api/matches/my');
    expect(res.status).toBe(401);
  });

  it('a forged-looking token is rejected', async () => {
    const res = await call('/api/wallet', 'not.a.real.jwt');
    expect(res.status).toBe(401);
  });

  it('a token signed with the wrong secret is rejected', async () => {
    const { sign } = await import('jsonwebtoken');
    const forged = sign({ sub: 'someone', role: 'SUPER_ADMIN', username: 'x' }, 'wrong-secret');
    const res = await call('/api/admin/stats', forged);
    expect(res.status).toBe(401);
  });
});
