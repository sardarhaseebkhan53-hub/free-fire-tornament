// =============================================================================
// PHASE 19 — ROUTES. The service suites prove the logic; this file proves the WIRING,
// which is where half-built features usually hide: a correct service behind an
// unmounted router, a route that accepts a body the validator never checked, a
// subscription endpoint that trusts a caller-supplied user. The REAL Express app runs
// over HTTP, so middleware, zod, routing and the database are all in the loop.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/lib/tokens';
import { env } from '../../src/lib/env';
import { joinTournament } from '../../src/services/tournament.service';
import { cleanupUsers, db, makeTournament, makeUser } from '../helpers/db';

const created: string[] = [];
const tournaments: string[] = [];
const ctxIp = '203.0.113.88';

let server: Server;
let base = '';

function tokenFor(u: { id: string; username: string; role?: string }): Promise<string> {
  return Promise.resolve(signAccessToken({ sub: u.id, role: (u.role as 'USER') ?? 'USER', username: u.username }));
}

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Browser-shaped subscription material: 65-byte uncompressed P-256 point + 16-byte auth. */
function deviceKeys() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { p256dh: point.toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
}

async function user() {
  const u = await makeUser({ cash: 1_000, prefix: 'p19r' });
  created.push(u.id);
  return u;
}

async function openEvent() {
  const t = await makeTournament({ entryFee: 10, maxSlots: 10, prizes: [] });
  tournaments.push(t.id);
  // Registration still OPEN (a join after the deadline is correctly refused), start ahead.
  return db.tournament.update({
    where: { id: t.id },
    data: {
      registrationDeadline: new Date(Date.now() + 30 * 60_000),
      startTime: new Date(Date.now() + 60 * 60_000),
    },
    select: { id: true, slug: true },
  });
}

/**
 * Pay for a seat, then close registration — the real sequence, and the one that puts the
 * DERIVED check-in window (deadline → start) into the OPEN state.
 */
async function joinAndOpenWindow(t: { id: string; slug: string }, u: { id: string }) {
  await joinTournament(u.id, { tournamentSlug: t.slug }, ctxIp);
  await db.tournament.update({
    where: { id: t.id },
    data: { registrationDeadline: new Date(Date.now() - 60_000), startTime: new Date(Date.now() + 10 * 60_000) },
  });
}

beforeAll(async () => {
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await db.pushSubscription.deleteMany({ where: { userId: { in: created } } });
  await db.notification.deleteMany({ where: { userId: { in: created } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: created } } });
  if (tournaments.length) {
    await db.tournamentRegistration.deleteMany({ where: { tournamentId: { in: tournaments } } });
    await db.tournament.deleteMany({ where: { id: { in: tournaments } } });
  }
  await cleanupUsers(created);
  await db.$disconnect();
});

describe('GET /api/push/config', () => {
  it('is public and answers whether alerts can be delivered at all', async () => {
    const res = await call('GET', '/api/push/config');
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    const data = res.json.data as { enabled: boolean; publicKey: string | null };
    expect(typeof data.enabled).toBe('boolean');
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      // Default test config: no keys, so the client must be told not to ask permission.
      expect(data).toEqual({ enabled: false, publicKey: null });
    } else {
      expect(data.enabled).toBe(true);
      expect(data.publicKey).toBe(env.VAPID_PUBLIC_KEY);
    }
  });
});

describe('POST /api/push/subscribe', () => {
  it('refuses an anonymous caller', async () => {
    const res = await call('POST', '/api/push/subscribe', { body: { endpoint: 'https://push.example/a', ...deviceKeys() } });
    expect(res.status).toBe(401);
    expect(res.json.code).toBe('UNAUTHORIZED');
  });

  it('rejects a plaintext endpoint and short keys instead of storing a dead address', async () => {
    const u = await user();
    const keys = deviceKeys();
    const res = await call('POST', '/api/push/subscribe', {
      token: await tokenFor(u),
      body: { endpoint: `http://127.0.0.1:9/push/nope`, p256dh: keys.p256dh.slice(0, 10), auth: 'x' },
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
    expect(await db.pushSubscription.count({ where: { userId: u.id } })).toBe(0);
  });

  it('stores a valid subscription, and re-subscribing does not duplicate it', async () => {
    const u = await user();
    const token = await tokenFor(u);
    const endpoint = `https://push.example/${crypto.randomUUID()}`;
    const keys = deviceKeys();

    const first = await call('POST', '/api/push/subscribe', { token, body: { endpoint, ...keys } });
    expect(first.status).toBe(201);
    expect((first.json.data as { subscribed: boolean }).subscribed).toBe(true);

    // A browser re-sends the SAME endpoint after every permission grant / SW update. If
    // this inserted a row each time, one fan-out would spam the device N times over.
    const again = await call('POST', '/api/push/subscribe', { token, body: { endpoint, ...keys } });
    expect(again.status).toBe(201);
    expect(await db.pushSubscription.count({ where: { userId: u.id } })).toBe(1);
  });

  it('never lets one account claim another devices endpoint', async () => {
    const owner = await user();
    const other = await user();
    const endpoint = `https://push.example/${crypto.randomUUID()}`;
    await call('POST', '/api/push/subscribe', { token: await tokenFor(owner), body: { endpoint, ...deviceKeys() } });

    // Second account subscribing the same physical endpoint (shared browser, migrated
    // account): the row moves to whoever holds it, and the previous owner loses it — it
    // can never belong to two users at once, or one account would receive another alerts.
    await call('POST', '/api/push/subscribe', { token: await tokenFor(other), body: { endpoint, ...deviceKeys() } });
    expect(await db.pushSubscription.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { userId: other.id } })).toBe(1);
  });
});

describe('GET+DELETE /api/push/subscriptions', () => {
  it('lists and removes only the callers own devices', async () => {
    const u = await user();
    const other = await user();
    const token = await tokenFor(u);
    const mine = `https://push.example/${crypto.randomUUID()}`;
    const theirs = `https://push.example/${crypto.randomUUID()}`;
    await call('POST', '/api/push/subscribe', { token, body: { endpoint: mine, ...deviceKeys() } });
    await call('POST', '/api/push/subscribe', { token: await tokenFor(other), body: { endpoint: theirs, ...deviceKeys() } });

    const list = await call('GET', '/api/push/subscriptions', { token });
    expect(list.status).toBe(200);
    const data = list.json.data as { total: number; items: Array<{ endpoint?: string }>; pushEnabled: boolean };
    expect(data.total).toBe(1);
    expect(data.pushEnabled).toBeTypeOf('boolean');
    // The endpoint is a bearer secret: it must not be echoed back to the client.
    expect(data.items[0]?.endpoint).toBeUndefined();

    // Deleting somebody else device is a no-op, not a cross-account unsubscribe.
    const notMine = await call('DELETE', '/api/push/subscribe', { token, body: { endpoint: theirs } });
    expect((notMine.json.data as { removed: number }).removed).toBe(0);
    expect(await db.pushSubscription.count({ where: { endpoint: theirs } })).toBe(1);

    const mine2 = await call('DELETE', '/api/push/subscribe', { token, body: { endpoint: mine } });
    expect((mine2.json.data as { removed: number }).removed).toBe(1);
    expect(await db.pushSubscription.count({ where: { userId: u.id } })).toBe(0);
  });

  it('wipes every device when the caller has lost the endpoint (reinstall path)', async () => {
    const u = await user();
    const token = await tokenFor(u);
    for (let i = 0; i < 3; i += 1) {
      await call('POST', '/api/push/subscribe', { token, body: { endpoint: `https://push.example/${crypto.randomUUID()}`, ...deviceKeys() } });
    }
    expect(await db.pushSubscription.count({ where: { userId: u.id } })).toBe(3);
    const res = await call('DELETE', '/api/push/subscribe', { token });
    expect((res.json.data as { removed: number }).removed).toBe(3);
    expect(await db.pushSubscription.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe('POST /api/tournaments/check-in', () => {
  it('requires a session', async () => {
    const res = await call('POST', '/api/tournaments/check-in', { body: { tournamentSlug: 'anything-here' } });
    expect(res.status).toBe(401);
  });

  it('requires the slug and refuses a bogus one', async () => {
    const u = await user();
    const token = await tokenFor(u);
    const missing = await call('POST', '/api/tournaments/check-in', { token, body: {} });
    expect(missing.status).toBe(400);
    expect(missing.json.code).toBe('VALIDATION_ERROR');

    const bogus = await call('POST', '/api/tournaments/check-in', { token, body: { tournamentSlug: 'no-such-event-xyz' } });
    expect(bogus.status).toBe(404);
    expect(bogus.json.code).toBe('NOT_FOUND');
  });

  it('checks a paid seat in over HTTP and the database records it', async () => {
    const u = await user();
    const t = await openEvent();
    await joinAndOpenWindow(t, u);

    const res = await call('POST', '/api/tournaments/check-in', { token: await tokenFor(u), body: { tournamentSlug: t.slug } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    const data = res.json.data as { checkedIn: boolean; alreadyCheckedIn: boolean; window: { state: string; derived: boolean } };
    expect(data.checkedIn).toBe(true);
    expect(data.alreadyCheckedIn).toBe(false);
    // The window is reported, so the client shows the same deadline the server enforced.
    expect(data.window).toMatchObject({ state: 'OPEN', derived: true });

    const reg = await db.tournamentRegistration.findUniqueOrThrow({
      where: { tournamentId_userId: { tournamentId: t.id, userId: u.id } },
      select: { checkedInAt: true },
    });
    expect(reg.checkedInAt).toBeInstanceOf(Date);

    // Second tap over the wire: still a 200, still one notification.
    const again = await call('POST', '/api/tournaments/check-in', { token: await tokenFor(u), body: { tournamentSlug: t.slug } });
    expect(again.status).toBe(200);
    expect((again.json.data as { alreadyCheckedIn: boolean }).alreadyCheckedIn).toBe(true);
    expect(await db.notification.count({ where: { userId: u.id, title: 'Checked in ✅' } })).toBe(1);
  });

  it('surfaces the window and attendance on My Matches so the UI cannot lie', async () => {
    const u = await user();
    const t = await openEvent();
    await joinAndOpenWindow(t, u);
    await call('POST', '/api/tournaments/check-in', { token: await tokenFor(u), body: { tournamentSlug: t.slug } });

    const res = await call('GET', '/api/matches/my', { token: await tokenFor(u) });
    expect(res.status).toBe(200);
    const items = (res.json.data ?? []) as Array<{ tournament: { slug: string }; checkIn: { state: string; checkedInAt: string | null; noShowAt: string | null } }>;
    const item = items.find((i) => i.tournament.slug === t.slug);
    expect(item?.checkIn?.state).toBe('OPEN');
    expect(item?.checkIn?.checkedInAt).toBeTypeOf('string');
    expect(item?.checkIn?.noShowAt).toBeNull();
  });
});

describe('admin check-in window endpoint', () => {
  it('opens check-in early on request, and a player uses it before the deadline', async () => {
    const admin = await makeUser({ cash: 0, role: 'ADMIN', prefix: 'p19ra' });
    created.push(admin.id);
    const u = await user();
    const t = await openEvent(); // registration open until +30min, so check-in is NOT_OPEN yet
    await joinTournament(u.id, { tournamentSlug: t.slug }, ctxIp);
    const before = await call('POST', '/api/tournaments/check-in', { token: await tokenFor(u), body: { tournamentSlug: t.slug } });
    expect(before.status).toBe(400);
    expect(before.json.code).toBe('CHECK_IN_NOT_OPEN');

    const res = await call('POST', `/api/admin/tournaments/${t.id}/check-in-window`, {
      token: await tokenFor(admin),
      body: { opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 20 * 60_000).toISOString() },
    });
    expect(res.status).toBe(200);
    const saved = res.json.data as { window: { state: string; derived: boolean }; confirmedSeats: number };
    expect(saved.window).toMatchObject({ state: 'OPEN', derived: false });
    expect(saved.confirmedSeats).toBe(1);

    const after = await call('POST', '/api/tournaments/check-in', { token: await tokenFor(u), body: { tournamentSlug: t.slug } });
    expect(after.status).toBe(200);
    expect((after.json.data as { window: { derived: boolean } }).window.derived).toBe(false);
  });

  it('refuses an inverted window and accepts a null to go back to derived', async () => {
    const admin = await makeUser({ cash: 0, role: 'ADMIN', prefix: 'p19ra' });
    created.push(admin.id);
    const t = await openEvent();

    const bad = await call('POST', `/api/admin/tournaments/${t.id}/check-in-window`, {
      token: await tokenFor(admin),
      body: { opensAt: new Date(Date.now() + 60 * 60_000).toISOString(), closesAt: new Date(Date.now() + 10 * 60_000).toISOString() },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('VALIDATION_ERROR');
    // zod keeps the envelope message generic and puts the reason in `errors[]` — the field
    // path is what the admin form highlights, so that is what has to survive the wire.
    const fieldErrors = (bad.json.errors ?? []) as Array<{ path: string; message: string }>;
    expect(fieldErrors.some((e) => e.path === 'closesAt' && /close after it opens/i.test(e.message))).toBe(true);
    // Nothing was written on rejection.
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id }, select: { checkInOpensAt: true, checkInClosesAt: true } })).checkInClosesAt).toBeNull();

    // The subtle inversion: closing before the DERIVED open passes zod (only one side was
    // sent) and must be caught by the service, which resolves the whole window.
    const halfBad = await call('POST', `/api/admin/tournaments/${t.id}/check-in-window`, {
      token: await tokenFor(admin),
      body: { closesAt: new Date(Date.now() + 5 * 60_000).toISOString() },
    });
    expect(halfBad.status).toBe(400);
    expect(String(halfBad.json.message)).toMatch(/close after it opens/i);
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id }, select: { checkInClosesAt: true } })).checkInClosesAt).toBeNull();

    const cleared = await call('POST', `/api/admin/tournaments/${t.id}/check-in-window`, {
      token: await tokenFor(admin),
      body: { opensAt: null, closesAt: null },
    });
    expect(cleared.status).toBe(200);
    expect((cleared.json.data as { window: { derived: boolean } }).window.derived).toBe(true);
    expect(await db.auditLog.count({ where: { actorId: admin.id, action: 'CHECK_IN_WINDOW_SET' } })).toBe(1);
  });

  it('is admin-only', async () => {
    const u = await user();
    const res = await call('POST', `/api/admin/tournaments/whatever/check-in-window`, { token: await tokenFor(u), body: {} });
    expect(res.status).toBe(403);
  });
});

describe('admin check-in endpoints', () => {
  it('are admin-only over HTTP', async () => {
    const player = await user();
    const res = await call('GET', '/api/admin/tournaments/whatever/check-in', { token: await tokenFor(player) });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('FORBIDDEN');
  });

  it('return the board for an admin', async () => {
    const admin = await makeUser({ cash: 0, role: 'ADMIN', prefix: 'p19ra' });
    created.push(admin.id);
    const player = await user();
    const t = await openEvent();
    await joinAndOpenWindow(t, player);

    const res = await call('GET', `/api/admin/tournaments/${t.id}/check-in`, { token: await tokenFor(admin) });
    expect(res.status).toBe(200);
    const board = res.json.data as {
      summary: { total: number; checkedIn: number; missing: number };
      window: { state: string };
      registrations: Array<{ username: string; checkedInAt: string | null }>;
    };
    expect(board.summary).toEqual({ total: 1, checkedIn: 0, missing: 1 });
    expect(board.window.state).toBe('OPEN');
    expect(board.registrations[0]).toMatchObject({ username: player.username, checkedInAt: null });

    // And the desk path works too: staff stamps the seat, player keeps the record.
    const regId = (await db.tournamentRegistration.findUniqueOrThrow({
      where: { tournamentId_userId: { tournamentId: t.id, userId: player.id } },
      select: { id: true },
    })).id;
    const desk = await call('POST', `/api/admin/registrations/${regId}/check-in`, { token: await tokenFor(admin) });
    expect(desk.status).toBe(200);
    expect(await db.notification.count({ where: { userId: player.id, title: 'You were checked in by staff' } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorId: admin.id, action: 'TOURNAMENT_CHECKED_IN_BY_STAFF' } })).toBe(1);
  });
});
