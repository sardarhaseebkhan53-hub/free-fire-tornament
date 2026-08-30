// =============================================================================
// TOURNAMENT ROOM MANAGEMENT — the release clock, the eligibility wall, the admin
// switches, and the leak surfaces. Run over the REAL Express app so route wiring
// (auth, ordering, headers) is under test and not just the service.
//
// The scenarios are the ones the feature is judged on, and each one is asserted on
// TWO levels: the response a client receives, and the raw serialized payload. That
// second one is the point — "we returned null for the field" and "the value was never
// in the bytes" are different guarantees, and only the second survives a future
// refactor that adds a `...t` somewhere.
//
// Timing note: tests that need an exact instant PIN it (`releaseAt` = now), because
// "exactly at the release time" cannot be raced against a real clock. The derived
// window is checked with margins wide enough to survive a slow CI box, and the
// millisecond-level boundary itself lives in tests/unit/room.test.ts.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/lib/tokens';
import {
  playerRoomView, releaseTournamentRooms, setRoomStatus, setTournamentRoom,
} from '../../src/services/room.service';
import { joinTournament, myRegistrations } from '../../src/services/tournament.service';
import { getTournamentBySlug } from '../../src/services/public.service';
import {
  cleanupUsers, db, makeTournament, makeUser, rejectsWithCode, setSetting, uid, type TestUser,
} from '../helpers/db';

const ctx = { ip: '203.0.113.77', userAgent: 'vitest-tournament-room' };
const createdUsers: string[] = [];
const createdTournaments: string[] = [];

let server: Server;
let base = '';

beforeAll(async () => {
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The platform default the spec asks for, pinned explicitly so a seeded Setting row
  // or a stray env value cannot move the window these tests measure.
  await setSetting('tournament.roomReleaseMinutes', 5);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await db.tournamentRoom.deleteMany({ where: { tournamentId: { in: createdTournaments } } });
  for (const id of createdTournaments) {
    await db.auditLog.deleteMany({ where: { entityId: id, entity: 'Tournament' } });
  }
  await db.tournament.deleteMany({ where: { id: { in: createdTournaments } } });
  await cleanupUsers(createdUsers);
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function admin(): Promise<TestUser> {
  const u = await makeUser({ role: 'ADMIN', prefix: 'roomadm' });
  createdUsers.push(u.id);
  return u;
}

async function player(cash = 500): Promise<TestUser> {
  const u = await makeUser({ cash, prefix: 'roomu' });
  createdUsers.push(u.id);
  return u;
}

const tokenFor = (u: TestUser, role = 'USER') => signAccessToken({ sub: u.id, role, username: u.username });

/** An event starting `inMinutes` from now, registration open, with a paid seat taken. */
async function event(inMinutes = 60) {
  const start = new Date(Date.now() + inMinutes * 60_000);
  const t = await makeTournament({ entryFee: 10, maxSlots: 10, prizes: [] });
  createdTournaments.push(t.id);
  // The deadline stays BEFORE the start time even for the tight 4-minute events, so a
  // fixture can never be an impossible schedule that only passes because the join engine
  // does not re-check the ordering the admin form enforces.
  const deadline = new Date(Date.now() + Math.min(5 * 60_000, Math.max(60_000, (inMinutes - 1) * 60_000)));
  return db.tournament.update({
    where: { id: t.id },
    data: { startTime: start, registrationDeadline: deadline },
  });
}

type Ev = Awaited<ReturnType<typeof event>>;

/** Pay for a seat the way a player does, then hand back the row. */
async function seat(t: Ev, u: TestUser) {
  await joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip);
  return db.tournamentRegistration.findUniqueOrThrow({
    where: { tournamentId_userId: { tournamentId: t.id, userId: u.id } },
  });
}

async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON body: raw is enough */ }
  return { status: res.status, json, text, headers: res.headers };
}

const roomRow = (tournamentId: string) =>
  db.tournamentRoom.findUnique({ where: { tournamentId } });

const lastAudit = (action: string, entityId: string) =>
  db.auditLog.findFirst({ where: { action, entityId, entity: 'Tournament' }, orderBy: { createdAt: 'desc' } });

// ===========================================================================
// §A — ADMIN AUTHORIZATION
// ===========================================================================
describe('room admin surface — who is allowed to touch a room', () => {
  it('refuses an anonymous caller outright', async () => {
    const t = await event();
    const res = await call(`/api/admin/tournaments/${t.id}/room`);
    expect(res.status).toBe(401);
  });

  it('refuses a normal user AND a moderator: only ADMIN+ may write a room', async () => {
    const t = await event();
    const playerUser = await player();
    const mod = await makeUser({ role: 'MODERATOR', prefix: 'roommod' });
    createdUsers.push(mod.id);

    for (const [label, token] of [
      ['USER', tokenFor(playerUser)],
      ['MODERATOR', tokenFor(mod, 'MODERATOR')],
    ] as const) {
      const get = await call(`/api/admin/tournaments/${t.id}/room`, token);
      const put = await call(`/api/admin/tournaments/${t.id}/room`, token, 'PUT', { roomId: '1234567' });
      const cancel = await call(`/api/admin/tournaments/${t.id}/room/status`, token, 'POST', { action: 'CANCEL', reason: 'nope' });
      expect(get.status, `${label} GET`).toBe(403);
      expect(put.status, `${label} PUT`).toBe(403);
      expect(cancel.status, `${label} POST`).toBe(403);
    }
    // And nothing was written by the attempts that were refused.
    expect(await roomRow(t.id)).toBeNull();
  });

  it('serves an ADMIN, with the credentials marked non-cacheable', async () => {
    const t = await event();
    const adm = await admin();
    const res = await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const data = res.json.data as { room: { status: string; label: string }; tournament: { id: string } };
    expect(data.room.status).toBe('NOT_ADDED');
    expect(data.room.label).toBe('Room Not Added');
    expect(data.tournament.id).toBe(t.id);
  });
});

// ===========================================================================
// §B — ADD / UPDATE CREDENTIALS (ADMIN PANEL)
// ===========================================================================
describe('admin adds and updates the Room ID / password', () => {
  it('stores both values and audits the change WITHOUT the password', async () => {
    const t = await event();
    const adm = await admin();
    const res = await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', {
      roomId: '7412580', roomPassword: 'CNX4821', note: 'lock after 1st zone',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Room saved');

    const row = await roomRow(t.id);
    expect(row).toMatchObject({ roomId: '7412580', roomPassword: 'CNX4821', status: 'SCHEDULED' });
    expect(row?.note).toBe('lock after 1st zone');

    const log = await lastAudit('ROOM_UPDATED', t.id);
    expect(log).not.toBeNull();
    expect(JSON.stringify(log?.after)).toContain('7412580');
    expect(log?.actorId).toBe(adm.id);
    // The audit trail is read by every admin account and kept forever, so the password
    // must never be in it — only the fact that one was set.
    expect(JSON.stringify(log)).not.toContain('CNX4821');
    expect((log?.after as { passwordChanged?: boolean }).passwordChanged).toBe(true);
  });

  it('updates ONE half without disturbing the other', async () => {
    const t = await event();
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '1112223', roomPassword: 'OLDPW1' });
    const res = await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomPassword: 'NEWPW2' });
    expect(res.status).toBe(200);
    expect(await roomRow(t.id)).toMatchObject({ roomId: '1112223', roomPassword: 'NEWPW2' });
  });

  it('refuses values that would break a hand-typed credential, and writes nothing', async () => {
    const t = await event();
    const adm = await admin();
    for (const bad of [
      { roomId: '12' },                       // too short to be a room
      { roomId: 'has space' },                // typed into Free Fire, would silently fail
      { roomId: '<img src=x onerror=1>' },    // never enters audit JSON / CSV / templates
      { roomId: '7412580', roomPassword: 'a b' },
      { roomId: '7412580', releaseMinutesBeforeStart: 99999 },
    ]) {
      const res = await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await roomRow(t.id)).toBeNull();
  });

  it('refuses to empty a room through the save endpoint — that is what Hide/Cancel are for', async () => {
    const t = await event();
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    const res = await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '', roomPassword: '' });
    expect(res.status).toBe(400);
    expect(await roomRow(t.id)).toMatchObject({ roomId: '7412580' });
  });
});

// ===========================================================================
// §C — THE RELEASE: BEFORE / EXACTLY AT / AFTER
// ===========================================================================
describe('automatic release of the room to players', () => {
  it('holds the room back before the window, and shows the countdown instead', async () => {
    const t = await event(60); // an hour out
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });

    const view = await playerRoomView(p.id, t.slug);
    expect(view.status).toBe('SCHEDULED');
    expect(view.label).toBe('Room Scheduled');
    expect(view.roomId).toBeNull();
    expect(view.roomPassword).toBeNull();
    // ~55 minutes out: the countdown, not the values.
    expect(view.releaseInMs).toBeGreaterThan(54 * 60_000);
    expect(view.releaseInMs).toBeLessThanOrEqual(55 * 60_000);

    // And the endpoint agrees with the service, field for field.
    const res = await call(`/api/tournaments/${t.slug}/room`, tokenFor(p));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('7412580');
    expect(res.text).not.toContain('CNX4821');
  });

  it('opens the room EXACTLY at the release instant, to the second', async () => {
    const t = await event(60);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    // Pin the release 1.2s ahead. Waiting is the only honest way to test a boundary:
    // mocking "now" would test the mock, and sampling the clock on both sides of a real
    // instant is what the player's countdown actually does.
    const instant = Date.now() + 1_200;
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', {
      roomId: '7412580', roomPassword: 'CNX4821', releaseAt: new Date(instant).toISOString(),
    });

    const before = await call(`/api/tournaments/${t.slug}/room`, tokenFor(p));
    expect((before.json.data as { status: string; roomId: string | null }).status).toBe('SCHEDULED');
    expect(before.text).not.toContain('7412580');
    expect(before.text).not.toContain('CNX4821');

    await new Promise((r) => setTimeout(r, instant - Date.now() + 250));

    const after = await call(`/api/tournaments/${t.slug}/room`, tokenFor(p));
    const data = after.json.data as { status: string; label: string; roomId: string | null; roomPassword: string | null };
    expect(data.status).toBe('AVAILABLE');
    expect(data.label).toBe('Room Available');
    expect(data.roomId).toBe('7412580');
    expect(data.roomPassword).toBe('CNX4821');
    expect((await roomRow(t.id))?.status).toBe('AVAILABLE');
  });

  it('derives the window from the event start time by default: 5 minutes before', async () => {
    const adm = await admin();
    const soon = await event(4); // starts inside the window
    await call(`/api/admin/tournaments/${soon.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '5554443', roomPassword: 'CNX9911' });
    const p = await player();
    await seat(soon, p);
    const open = await playerRoomView(p.id, soon.slug);
    expect(open.status).toBe('AVAILABLE');

    const later = await event(40);
    await call(`/api/admin/tournaments/${later.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '5554443', roomPassword: 'CNX9911' });
    const p2 = await player();
    await seat(later, p2);
    const held = await playerRoomView(p2.id, later.slug);
    expect(held.status).toBe('SCHEDULED');
    expect(held.releaseInMs).toBeGreaterThan(34 * 60_000); // 40 − 5
  });

  it('is configurable: the platform Setting moves the window, per event too', async () => {
    const t = await event(120); // two hours out
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '6001122', roomPassword: 'CNX3377' });

    // A LEAD is measured backwards from the start, so a LONGER lead unlocks EARLIER:
    // two hours out, the default 5 minutes has not unlocked anything, and 150 minutes
    // unlocked an hour and a half ago. Asserting in the wrong direction here would test a
    // feature that unlocks every room the moment it is saved, which nobody would notice.
    try {
      await setSetting('tournament.roomReleaseMinutes', 5);
      expect((await playerRoomView(p.id, t.slug)).status).toBe('SCHEDULED');

      await setSetting('tournament.roomReleaseMinutes', 150);
      expect((await playerRoomView(p.id, t.slug)).status).toBe('AVAILABLE');

      // 0 is "no lead", not "immediately": the release is still measured from startTime, so
      // a two-hour-out event waits the full two hours. An admin who wants a room out NOW
      // pins the instant (the test above) — a lead that also meant "now" would make 0 two
      // different behaviours depending on nothing visible in the row.
      await setSetting('tournament.roomReleaseMinutes', 0);
      const zeroLead = await playerRoomView(p.id, t.slug);
      expect(zeroLead.status).toBe('SCHEDULED');
      expect(zeroLead.releaseMinutes).toBe(0);
      expect(zeroLead.releaseInMs).toBeGreaterThan(118 * 60_000);

      // A per-event lead overrides the platform value without touching it: with the
      // platform at 0, this event still asks for 3 hours, so it is already open.
      await setSetting('tournament.roomReleaseMinutes', 0);
      await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { releaseMinutesBeforeStart: 180 });
      expect((await playerRoomView(p.id, t.slug)).status).toBe('AVAILABLE');

      // …and clearing it hands the event back to the platform value (0 ⇒ 120 minutes out).
      await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { releaseMinutesBeforeStart: null });
      expect((await playerRoomView(p.id, t.slug)).status).toBe('SCHEDULED');
    } finally {
      // Always restored: this Setting is process-global and cached, so a test that leaves
      // it at 150 makes every later suite read a window it never asked for.
      await setSetting('tournament.roomReleaseMinutes', 5);
    }
  });
});

// ===========================================================================
// §D — ELIGIBILITY
// ===========================================================================
describe('only eligible, registered players can reach the room', () => {
  it('refuses an authenticated player with no seat, and says nothing else', async () => {
    const t = await event(4);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    const bystander = await player();

    const res = await call(`/api/tournaments/${t.slug}/room`, tokenFor(bystander));
    expect(res.status).toBe(403);
    expect(res.text).not.toContain('7412580');
    expect(res.text).not.toContain('CNX4821');
    // No status/label either: a non-seat must not be able to watch the room's lifecycle.
    expect(JSON.stringify(res.json)).not.toContain('SCHEDULED');
  });

  it('refuses an anonymous caller with 401', async () => {
    const t = await event();
    expect((await call(`/api/tournaments/${t.slug}/room`)).status).toBe(401);
  });

  it('lets a confirmed seat in, and stops the moment the seat is refunded', async () => {
    const t = await event(4);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });

    expect((await playerRoomView(p.id, t.slug)).roomId).toBe('7412580');

    await db.tournamentRegistration.update({
      where: { tournamentId_userId: { tournamentId: t.id, userId: p.id } },
      data: { status: 'REFUNDED' },
    });
    await expect(playerRoomView(p.id, t.slug)).rejects.toThrow(/confirmed seat/);
  });

  it('honours a seat held by the player’s team, and loses it when they leave the team', async () => {
    const t = await event(4);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });

    // Captain holds the seat; the member has no registration row of their own.
    const captain = await player();
    const member = await player();
    const team = await db.team.create({
      data: {
        name: `Room Squad ${uid()}`, tag: uid('tg').slice(0, 5).toUpperCase(), captainId: captain.id, type: 'SQUAD',
        members: { create: [{ userId: captain.id, role: 'CAPTAIN' }, { userId: member.id, role: 'MEMBER' }] },
      },
    });
    await db.tournamentRegistration.create({
      data: { tournamentId: t.id, userId: captain.id, teamId: team.id, status: 'CONFIRMED', entryAmount: 0 },
    });

    expect((await playerRoomView(member.id, t.slug)).roomId).toBe('7412580');

    await db.teamMember.deleteMany({ where: { teamId: team.id, userId: member.id } });
    await expect(playerRoomView(member.id, t.slug)).rejects.toThrow(/confirmed seat/);
    await db.team.delete({ where: { id: team.id } });
  });

  it('does not serve a room to a player whose event was cancelled outright', async () => {
    const t = await event(4);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    expect((await playerRoomView(p.id, t.slug)).status).toBe('AVAILABLE');

    await db.tournament.update({ where: { id: t.id }, data: { status: 'CANCELLED' } });
    const after = await playerRoomView(p.id, t.slug);
    expect(after.status).toBe('CANCELLED');
    expect(after.roomId).toBeNull();
    expect(after.roomPassword).toBeNull();
  });
});

// ===========================================================================
// §E — ROOM CANCELLATION
// ===========================================================================
describe('cancelling a room', () => {
  it('refuses to cancel without a reason', async () => {
    const t = await event(4);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    const res = await call(`/api/admin/tournaments/${t.id}/room/status`, tokenFor(adm, 'ADMIN'), 'POST', { action: 'CANCEL' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/reason/i);
  });

  it('stops visibility immediately, flips the status, notifies the seats and records it', async () => {
    const t = await event(4); // already inside the release window
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });

    // Visible before the cancellation.
    expect((await playerRoomView(p.id, t.slug)).roomId).toBe('7412580');
    await db.notification.deleteMany({ where: { userId: p.id } });

    const res = await call(`/api/admin/tournaments/${t.id}/room/status`, tokenFor(adm, 'ADMIN'), 'POST', {
      action: 'CANCEL', reason: 'Lobby was compromised — do not join.',
    });
    expect(res.status).toBe(200);
    expect((res.json.data as { room: { label: string } }).room.label).toBe('Room Cancelled');

    // 1. Players lose it on the next read, with the values gone from the payload.
    const after = await call(`/api/tournaments/${t.slug}/room`, tokenFor(p));
    expect(after.status).toBe(200);
    expect((after.json.data as { status: string }).status).toBe('CANCELLED');
    expect(after.text).not.toContain('7412580');
    expect(after.text).not.toContain('CNX4821');

    // 2. The tournament reads as cancelled to everyone, including the public page.
    const pub = await call(`/api/public/tournaments/${t.slug}`);
    expect((pub.json.data as { room: { label: string } }).room.label).toBe('Room Cancelled');

    // 3. The seats are told, with the reason.
    const notif = await db.notification.findFirst({ where: { userId: p.id, type: 'TOURNAMENT_UPDATE' } });
    expect(String(notif?.body)).toContain('Lobby was compromised');

    // 4. The cancellation is in the audit log, attributed, with the reason.
    const log = await lastAudit('ROOM_CANCELLED', t.id);
    expect(log?.actorId).toBe(adm.id);
    expect(JSON.stringify(log?.after)).toContain('Lobby was compromised');
    expect(JSON.stringify(log)).not.toContain('CNX4821');

    // 5. The values stay in the row (a mis-click must be recoverable) but the status
    //    column caches the truth for lists.
    expect(await roomRow(t.id)).toMatchObject({ roomId: '7412580', status: 'CANCELLED' });
  });

  it('cannot be edited around: a save to a cancelled room is refused until re-activation', async () => {
    const t = await event(4);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    await call(`/api/admin/tournaments/${t.id}/room/status`, tokenFor(adm, 'ADMIN'), 'POST', { action: 'CANCEL', reason: 'test' });

    const sneaky = await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '9998887' });
    expect(sneaky.status).toBe(409);
    expect(await roomRow(t.id)).toMatchObject({ roomId: '7412580' });

    // Re-activating is explicit, and puts the ORIGINAL room back on the schedule.
    const back = await call(`/api/admin/tournaments/${t.id}/room/status`, tokenFor(adm, 'ADMIN'), 'POST', { action: 'REACTIVATE' });
    expect(back.status).toBe(200);
    const row = await roomRow(t.id);
    expect(row?.cancelledAt).toBeNull();
    expect(row?.roomId).toBe('7412580');
  });

  it('re-cancelling a cancelled room is a no-op, not a second audit row', async () => {
    const t = await event(4);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    await call(`/api/admin/tournaments/${t.id}/room/status`, tokenFor(adm, 'ADMIN'), 'POST', { action: 'CANCEL', reason: 'first' });
    const before = await db.auditLog.count({ where: { action: 'ROOM_CANCELLED', entityId: t.id } });
    const again = await call(`/api/admin/tournaments/${t.id}/room/status`, tokenFor(adm, 'ADMIN'), 'POST', { action: 'CANCEL', reason: 'second' });
    expect(again.status).toBe(200);
    expect((again.json.data as { changed: boolean }).changed).toBe(false);
    expect(await db.auditLog.count({ where: { action: 'ROOM_CANCELLED', entityId: t.id } })).toBe(before);
  });
});

// ===========================================================================
// §F — HIDE / SHOW, ROTATION, AND THE ONCE-ONLY ANNOUNCEMENT
// ===========================================================================
describe('hiding, showing and rotating a room', () => {
  it('hide withholds a room whose window has already passed; show gives it back', async () => {
    const t = await event(4);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    expect((await playerRoomView(p.id, t.slug)).status).toBe('AVAILABLE');

    const hidden = await call(`/api/admin/tournaments/${t.id}/room/status`, tokenFor(adm, 'ADMIN'), 'POST', { action: 'HIDE' });
    expect(hidden.status).toBe(200);
    const whileHidden = await call(`/api/tournaments/${t.slug}/room`, tokenFor(p));
    expect((whileHidden.json.data as { status: string; roomId: string | null }).status).toBe('SCHEDULED');
    expect(whileHidden.text).not.toContain('7412580');
    // …and the admin can still see what they hid, so re-showing needs no re-typing.
    expect((await roomRow(t.id))?.roomId).toBe('7412580');

    const shown = await call(`/api/admin/tournaments/${t.id}/room/status`, tokenFor(adm, 'ADMIN'), 'POST', { action: 'SHOW' });
    expect(shown.status).toBe(200);
    const back = await call(`/api/tournaments/${t.slug}/room`, tokenFor(p));
    expect((back.json.data as { roomId: string | null }).roomId).toBe('7412580');
  });

  it('an update after release serves the NEW values and never the old ones', async () => {
    const t = await event(4);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '1111111', roomPassword: 'OLDPW99' });
    expect((await playerRoomView(p.id, t.slug)).roomPassword).toBe('OLDPW99');

    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '2222222', roomPassword: 'NEWPW00' });
    const res = await call(`/api/tournaments/${t.slug}/room`, tokenFor(p));
    const data = res.json.data as { roomId: string; roomPassword: string };
    expect(data.roomId).toBe('2222222');
    expect(data.roomPassword).toBe('NEWPW00');
    expect(res.text).not.toContain('OLDPW99');
    expect(res.text).not.toContain('1111111');
  });

  it('announces each version of the room exactly once, whatever the concurrency', async () => {
    const t = await event(4);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    await db.notification.deleteMany({ where: { userId: p.id } });

    // Five tabs open the room at once; the claim is one atomic UPDATE, so one alert.
    const views = await Promise.all([1, 2, 3, 4, 5].map(() => playerRoomView(p.id, t.slug)));
    for (const v of views) expect(v.status).toBe('AVAILABLE');
    expect(await db.notification.count({ where: { userId: p.id, type: 'ROOM_CREDENTIALS' } })).toBe(1);

    // A second release of the same credentials stays silent…
    await playerRoomView(p.id, t.slug);
    expect(await db.notification.count({ where: { userId: p.id, type: 'ROOM_CREDENTIALS' } })).toBe(1);

    // …until the admin rotates them, which re-arms it on purpose.
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomPassword: 'CNX4822' });
    await playerRoomView(p.id, t.slug);
    expect(await db.notification.count({ where: { userId: p.id, type: 'ROOM_CREDENTIALS' } })).toBe(2);
  });
});

// ===========================================================================
// §G — THE LEAK SURFACES
// ===========================================================================
describe('nothing else on the API can carry a credential', () => {
  it('public detail, my registrations and the admin list stay clean — before AND after release', async () => {
    const t = await event(60);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });

    const assertClean = async (phase: string) => {
      const pub = await call(`/api/public/tournaments/${t.slug}`);
      expect(pub.status, phase).toBe(200);
      expect(pub.text, phase).not.toContain('7412580');
      expect(pub.text, phase).not.toContain('CNX4821');
      // The public page still explains the room, without exposing it.
      const room = (pub.json.data as { room: { status: string; label: string } }).room;
      expect(['SCHEDULED', 'AVAILABLE']).toContain(room.status);
      expect(room.label).toBe(room.status === 'AVAILABLE' ? 'Room Available' : 'Room Scheduled');

      const mine = await myRegistrations(p.id);
      expect(JSON.stringify(mine), phase).not.toContain('7412580');
      expect(JSON.stringify(mine), phase).not.toContain('CNX4821');

      const list = await call('/api/admin/tournaments?pageSize=100', tokenFor(adm, 'ADMIN'));
      expect(list.text, phase).not.toContain('CNX4821');
    };

    await assertClean('before release');
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { releaseAt: new Date().toISOString() });
    await assertClean('after release');
  });

  it('a player cannot obtain the room by asking for another event’s, or a draft’s', async () => {
    const mine = await event(4);
    const theirs = await event(4);
    const p = await player();
    await seat(mine, p);
    const adm = await admin();
    await call(`/api/admin/tournaments/${theirs.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '8887776', roomPassword: 'OTHER11' });

    await expect(playerRoomView(p.id, theirs.slug)).rejects.toThrow(/confirmed seat/);

    const draft = await makeTournament({ status: 'DRAFT' });
    createdTournaments.push(draft.id);
    await call(`/api/admin/tournaments/${draft.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '1357911', roomPassword: 'DRAFT01' });
    // A draft is not published, but the room endpoint answers 404 for the slug only when
    // the event is gone — so the seat check is what protects it here. Either way: nothing.
    const res = await call(`/api/tournaments/${draft.slug}/room`, tokenFor(p));
    expect(res.text).not.toContain('DRAFT01');
    expect([403, 404]).toContain(res.status);
  });

  it('the admin tournament LIST is state-only: a pill, no credential at all', async () => {
    // Listing rows are the response an admin screen refetches on every page turn, so the
    // room columns are deliberately absent from it — even the Room ID, which has its own
    // panel. A table full of live passwords is how a credential leaves a screen.
    const t = await event(4);
    const adm = await admin();
    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    const list = await call('/api/admin/tournaments?pageSize=100', tokenFor(adm, 'ADMIN'));
    expect(list.status).toBe(200);
    expect(list.text).not.toContain('CNX4821');
    expect(list.text).not.toContain('7412580');
    const row = (list.json.data as { items: Array<{ id: string; room: { status: string; label: string } | null }> })
      .items.find((i) => i.id === t.id);
    expect(row?.room?.status).toBe('AVAILABLE');
    expect(row?.room?.label).toBe('Room Available');
  });
});

// ===========================================================================
// §H — THE SCHEDULER (release without anybody asking)
// ===========================================================================
describe('the scheduler opens rooms on its own', () => {
  /** Make a scheduled room overdue by moving the EVENT, which is how it happens in anger:
   * nobody edits the room, the clock simply arrives. A raw startTime update leaves the
   * cached STATUS column at SCHEDULED, which is precisely the stale-cache case the sweep
   * has to survive. */
  async function makeOverdue(t: { id: string }) {
    await db.tournament.update({ where: { id: t.id }, data: { startTime: new Date(Date.now() - 60_000) } });
  }

  it('releases when the window arrives, announces once, and is idempotent on the next tick', async () => {
    const t = await event(40);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await setTournamentRoom(adm.id, t.id, { roomId: '7412580', roomPassword: 'CNX4821' }, ctx);
    expect(await roomRow(t.id)).toMatchObject({ status: 'SCHEDULED' });
    expect((await roomRow(t.id))?.releasedAt).toBeNull();

    await makeOverdue(t);
    await releaseTournamentRooms();

    const row = await roomRow(t.id);
    expect(row?.status).toBe('AVAILABLE');
    expect(row?.releasedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: p.id, type: 'ROOM_CREDENTIALS' } })).toBe(1);
    // The player who never asked for it still has the room when they open the card.
    expect((await playerRoomView(p.id, t.slug)).roomId).toBe('7412580');

    // A second tick finds nothing to announce: the claim is the guard, not the clock.
    await releaseTournamentRooms();
    expect(await db.notification.count({ where: { userId: p.id, type: 'ROOM_CREDENTIALS' } })).toBe(1);
  });

  it('never opens a hidden room, however overdue it is', async () => {
    const t = await event(40);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await setTournamentRoom(adm.id, t.id, { roomId: '7412580', roomPassword: 'CNX4821' }, ctx);
    await setRoomStatus(adm.id, t.id, 'HIDE', null, ctx);
    await makeOverdue(t);

    await releaseTournamentRooms();
    expect((await roomRow(t.id))?.releasedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: p.id, type: 'ROOM_CREDENTIALS' } })).toBe(0);
    expect((await playerRoomView(p.id, t.slug)).roomId).toBeNull();
  });

  it('announces a rotated password even though the status cache already said AVAILABLE', async () => {
    // The case a status-filtered sweep would silently drop: the window had already passed
    // when the admin saved, so the row is cached AVAILABLE — with nothing announced.
    const t = await event(4);
    const p = await player();
    await seat(t, p);
    const adm = await admin();
    await setTournamentRoom(adm.id, t.id, { roomId: '7412580', roomPassword: 'CNX4821' }, ctx);
    expect((await roomRow(t.id))?.status).toBe('AVAILABLE');

    await setTournamentRoom(adm.id, t.id, { roomPassword: 'CNX4822' }, ctx);
    await releaseTournamentRooms();
    expect(await db.notification.count({ where: { userId: p.id, type: 'ROOM_CREDENTIALS' } })).toBe(1);
  });
});

// ===========================================================================
// §I — API-LEVEL ERROR SHAPE (the frontend maps on these codes)
// ===========================================================================
describe('error contract', () => {
  it('returns the codes the client is written against', async () => {
    const t = await event(4);
    const adm = await admin();
    const p = await player();

    expect((await call('/api/admin/tournaments/does-not-exist/room', tokenFor(adm, 'ADMIN'))).json.code).toBe('NOT_FOUND');
    expect((await call(`/api/tournaments/not-a-real-slug/room`, tokenFor(p))).json.code).toBe('NOT_FOUND');

    await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: '7412580', roomPassword: 'CNX4821' });
    const denied = await call(`/api/tournaments/${t.slug}/room`, tokenFor(p));
    expect(denied.json.code).toBe('FORBIDDEN');

    const bad = await call(`/api/admin/tournaments/${t.id}/room/status`, tokenFor(adm, 'ADMIN'), 'POST', { action: 'EXPLODE' });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a validation failure with the field-level detail the panel shows', async () => {
    const t = await event();
    const adm = await admin();
    const res = await call(`/api/admin/tournaments/${t.id}/room`, tokenFor(adm, 'ADMIN'), 'PUT', { roomId: 'x'.repeat(60) });
    expect(res.status).toBe(400);
    await rejectsWithCode(() => setTournamentRoom(adm.id, t.id, { roomId: 'x'.repeat(60) }, ctx), 'VALIDATION_ERROR');
  });
});
