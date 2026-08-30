// =============================================================================
// PHASE 19 — CHECK-IN. Attendance is now a first-class, DB-stamped fact, so this suite
// pins the four things that make it trustworthy rather than decorative:
//
//   §A  the window (derived from the event's own timestamps; explicit columns win;
//       boundaries are exact and a broken window is reported, never repaired silently)
//   §B  the player write (one guarded update, idempotent under a retry and under two
//       parallel tabs, impossible on a dead seat, impossible outside the window)
//   §C  the no-show pass (marks once, marks nobody twice, touches no money)
//   §D  the staff desk (late arrivals, manual no-shows, and the board the admin reads)
//
// Every assertion is about DB state, not about a status code — the code is the least
// trustworthy part of an API.
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { joinTournament } from '../../src/services/tournament.service';
import {
  adminCheckIn, adminMarkNoShow, checkIn, checkInBoard, markNoShows, resolveCheckInWindow,
} from '../../src/services/checkin.service';
import {
  cleanupUsers, db, makeTournament, makeUser, rejectsWithCode, walletOf, type TestUser,
} from '../helpers/db';

const ctx = { ip: '203.0.113.92', userAgent: 'vitest-phase19-checkin' };
const created: string[] = [];
const tournamentIds: string[] = [];

async function player(cash = 500): Promise<TestUser> {
  const u = await makeUser({ cash, prefix: 'p19c' });
  created.push(u.id);
  return u;
}

/**
 * An event with registration still OPEN (joinTournament refuses a closed roster, so the
 * window is always moved *after* the seats are taken — which is also exactly how a real
 * event behaves: people pay first, then the deadline passes, then check-in opens).
 */
async function event(): Promise<{ id: string; slug: string }> {
  const t = await makeTournament({ entryFee: 10, maxSlots: 10, prizes: [] });
  tournamentIds.push(t.id);
  return db.tournament.update({
    where: { id: t.id },
    data: { registrationDeadline: new Date(Date.now() + 30 * 60_000), startTime: new Date(Date.now() + 60 * 60_000) },
    select: { id: true, slug: true },
  });
}

/** Move the clock of an event: registration deadline, start time, explicit window. */
async function setWindow(
  t: { id: string },
  w: { deadlineInMs?: number; startInMs?: number; opensInMs?: number | null; closesInMs?: number | null },
) {
  const base = Date.now();
  await db.tournament.update({
    where: { id: t.id },
    data: {
      ...(w.deadlineInMs === undefined ? {} : { registrationDeadline: new Date(base + w.deadlineInMs) }),
      ...(w.startInMs === undefined ? {} : { startTime: new Date(base + w.startInMs) }),
      ...(w.opensInMs === undefined ? {} : { checkInOpensAt: w.opensInMs === null ? null : new Date(base + w.opensInMs) }),
      ...(w.closesInMs === undefined ? {} : { checkInClosesAt: w.closesInMs === null ? null : new Date(base + w.closesInMs) }),
    },
  });
}

/** Pay for a seat and hand back the registration id (joinTournament returns money + seat,
 * not the row id — the id is what every assertion here is actually about). */
async function seat(t: { id: string; slug: string }, u: TestUser): Promise<string> {
  await joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip);
  const row = await db.tournamentRegistration.findUniqueOrThrow({
    where: { tournamentId_userId: { tournamentId: t.id, userId: u.id } },
    select: { id: true },
  });
  return row.id;
}

const attendance = (registrationId: string) =>
  db.tournamentRegistration.findUniqueOrThrow({
    where: { id: registrationId },
    select: { checkedInAt: true, noShowAt: true, status: true, seatNumber: true },
  });

afterAll(async () => {
  await db.notification.deleteMany({ where: { userId: { in: created } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: created } } });
  if (tournamentIds.length) {
    await db.tournamentRegistration.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
    await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  }
  await cleanupUsers(created);
  await db.$disconnect();
});

describe('§A check-in window resolution', () => {
  const t = { checkInOpensAt: null, checkInClosesAt: null, registrationDeadline: new Date('2026-08-30T10:00:00Z'), startTime: new Date('2026-08-30T11:00:00Z') };

  it('derives registration-closed-to-start when the organiser set nothing', () => {
    const w = resolveCheckInWindow(t, new Date('2026-08-30T10:30:00Z'));
    expect(w).toMatchObject({ state: 'OPEN', derived: true });
    expect(w.opensAt.toISOString()).toBe('2026-08-30T10:00:00.000Z');
    expect(w.closesAt.toISOString()).toBe('2026-08-30T11:00:00.000Z');
  });

  it('treats the exact open instant as inside and the exact close instant as outside', () => {
    expect(resolveCheckInWindow(t, t.registrationDeadline).state).toBe('OPEN');
    expect(resolveCheckInWindow(t, t.startTime).state).toBe('CLOSED');
    expect(resolveCheckInWindow(t, new Date(t.registrationDeadline.getTime() - 1)).state).toBe('NOT_OPEN');
  });

  it('prefers explicit columns over the derived defaults', () => {
    const w = resolveCheckInWindow(
      { ...t, checkInOpensAt: new Date('2026-08-30T09:00:00Z'), checkInClosesAt: new Date('2026-08-30T09:30:00Z') },
      new Date('2026-08-30T10:30:00Z'),
    );
    expect(w).toMatchObject({ state: 'CLOSED', derived: false });
  });

  it('reports a window that shuts before it opens instead of inventing one', () => {
    const w = resolveCheckInWindow(
      { ...t, checkInOpensAt: new Date('2026-08-30T12:00:00Z'), checkInClosesAt: new Date('2026-08-30T11:00:00Z') },
      new Date('2026-08-30T10:30:00Z'),
    );
    expect(w.state).toBe('MISCONFIGURED');
  });

  it('accepts the epoch-number form the list endpoints pass', () => {
    const asNumber = resolveCheckInWindow(t, Date.parse('2026-08-30T10:30:00Z'));
    expect(asNumber.state).toBe(resolveCheckInWindow(t, new Date('2026-08-30T10:30:00Z')).state);
  });
});

describe('§B player check-in', () => {
  it('refuses before the window opens, stamps nothing', async () => {
    const u = await player();
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: 20 * 60_000, startInMs: 40 * 60_000 });
    await rejectsWithCode(() => checkIn(u.id, t.slug, ctx), 'CHECK_IN_NOT_OPEN');
    expect((await attendance(reg)).checkedInAt).toBeNull();
  });

  it('refuses a caller with no confirmed seat', async () => {
    const u = await player();
    const stranger = await player();
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: -60_000, startInMs: 15 * 60_000 });
    await rejectsWithCode(() => checkIn(stranger.id, t.slug, ctx), 'NOT_REGISTERED');
    expect((await attendance(reg)).checkedInAt).toBeNull();
  });

  it('honours an explicit window past the registration deadline, then refuses a dead seat', async () => {
    const u = await player();
    // Registration closed 5 min ago, but staff opened check-in only in 10 min and the
    // event starts in 20. The explicit columns must win: otherwise the derived default
    // would silently override what the organiser configured and let players in early.
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: -5 * 60_000, startInMs: 20 * 60_000, opensInMs: 10 * 60_000, closesInMs: 20 * 60_000 });
    await rejectsWithCode(() => checkIn(u.id, t.slug, ctx), 'CHECK_IN_NOT_OPEN');

    // Now widen the window so the seat check is what decides, not the clock.
    await setWindow(t, { opensInMs: -60_000 });
    await db.tournamentRegistration.update({ where: { id: reg }, data: { status: 'CANCELLED' } });
    await rejectsWithCode(() => checkIn(u.id, t.slug, ctx), 'NOT_REGISTERED');
    expect((await attendance(reg)).checkedInAt).toBeNull();
  });

  it('stamps the row, writes one audit entry and one notification', async () => {
    const u = await player();
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: -60_000, startInMs: 15 * 60_000 });

    const out = await checkIn(u.id, t.slug, ctx);
    expect(out).toMatchObject({ checkedIn: true, alreadyCheckedIn: false });
    const row = await attendance(reg);
    expect(row.checkedInAt).toBeInstanceOf(Date);
    expect(row.noShowAt).toBeNull();
    expect(row.seatNumber).toBe(out.seatNumber);

    expect(await db.auditLog.count({ where: { actorId: u.id, action: 'TOURNAMENT_CHECKED_IN', entityId: reg } })).toBe(1);
    expect(await db.notification.count({ where: { userId: u.id, type: 'TOURNAMENT_UPDATE', title: 'Checked in ✅' } })).toBe(1);
  });

  it('is idempotent: a retry returns success and still writes exactly one record', async () => {
    const u = await player();
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: -60_000, startInMs: 15 * 60_000 });

    const first = await checkIn(u.id, t.slug, ctx);
    const at = (await attendance(reg)).checkedInAt;
    const second = await checkIn(u.id, t.slug, ctx);
    expect(first.alreadyCheckedIn).toBe(false);
    expect(second.alreadyCheckedIn).toBe(true);
    // Same timestamp: the second call read the fact, it did not re-create it.
    expect((await attendance(reg)).checkedInAt!.getTime()).toBe(at!.getTime());
    expect(await db.notification.count({ where: { userId: u.id, title: 'Checked in ✅' } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorId: u.id, action: 'TOURNAMENT_CHECKED_IN' } })).toBe(1);
  });

  it('survives two parallel tabs with exactly one stamp and one notification', async () => {
    const u = await player();
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: -60_000, startInMs: 15 * 60_000 });

    const [a, b] = await Promise.allSettled([checkIn(u.id, t.slug, ctx), checkIn(u.id, t.slug, ctx)]);
    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    // Both may report success (that is the point of idempotency); neither may error.
    expect(ok.length).toBe(2);
    const row = await attendance(reg);
    expect(row.checkedInAt).toBeInstanceOf(Date);
    expect(await db.notification.count({ where: { userId: u.id, title: 'Checked in ✅' } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorId: u.id, action: 'TOURNAMENT_CHECKED_IN' } })).toBe(1);
  });

  it('refuses once the window has shut and leaves the seat un-checked-in', async () => {
    const u = await player();
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: -10 * 60_000, startInMs: -60_000 });
    await rejectsWithCode(() => checkIn(u.id, t.slug, ctx), 'CHECK_IN_CLOSED');
    expect((await attendance(reg)).checkedInAt).toBeNull();
  });

  it('exposes the resolved window plus attendance on the players own list', async () => {
    const u = await player();
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: -60_000, startInMs: 15 * 60_000 });
    await checkIn(u.id, t.slug, ctx);

    // myMatches is what My Matches renders; the strip must not re-derive state in JS.
    const { myMatches } = await import('../../src/services/match.service');
    const rows = await myMatches(u.id);
    const item = rows.find((r: { tournament: { slug: string } }) => r.tournament.slug === t.slug);
    // event() never sets the explicit columns, so this window is derived — and `derived`
    // must survive to the client, because the copy has to say when check-in closes and why.
    expect(item?.checkIn).toMatchObject({ state: 'OPEN', derived: true });
    expect((item as { checkIn: { checkedInAt: Date | null } }).checkIn.checkedInAt).toBeInstanceOf(Date);
    expect((item as { checkIn: { noShowAt: Date | null } }).checkIn.noShowAt).toBeNull();
  });
});

describe('§C no-show pass', () => {
  async function moneySnapshot(userIds: string[]) {
    const wallets = await Promise.all(userIds.map((id) => walletOf(id)));
    const counts = await Promise.all(
      userIds.map((id) => db.walletTransaction.count({ where: { userId: id } })),
    );
    return { wallets, counts };
  }

  it('marks confirmed non-attendees once, leaves attendees alone, moves no money', async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    const t = await event();
    const regA = await seat(t, a);
    await seat(t, b);
    const regC = await seat(t, c);
    // Registration closed, start still ahead: the window is open, so A can attend.
    await setWindow(t, { deadlineInMs: -30 * 60_000, startInMs: 10 * 60_000 });
    await checkIn(a.id, t.slug, ctx); // only A showed up
    // Time passes: the event starts, the window shuts. Overdue enough to sort to the front
    // of the sweep (oldest event first), so the cap cannot starve this assertion.
    await setWindow(t, { deadlineInMs: -40 * 60_000, startInMs: -20 * 60_000 });

    const before = await moneySnapshot([a.id, b.id, c.id]);
    // Bounded retry: each tick drains up to 50 actionable events, and this suite shares
    // the database with others, so a backlog may exist. The pass is idempotent, which is
    // precisely why retrying it is safe — that is the property under test, not a workaround.
    let res = { tournaments: 0, marked: 0 };
    for (let i = 0; i < 3 && (await attendance(regC)).noShowAt === null; i += 1) {
      res = await markNoShows();
    }
    expect(res.marked).toBeGreaterThanOrEqual(2);
    expect(res.tournaments).toBeGreaterThanOrEqual(1);

    expect((await attendance(regA)).noShowAt).toBeNull();
    expect((await attendance(regC)).noShowAt).toBeInstanceOf(Date);
    expect((await attendance(regC)).checkedInAt).toBeNull();

    // The invariant that matters on a real-money platform: attendance bookkeeping must be
    // unable to move a coin. No refund, no forfeit, no fee, no ledger row.
    const after = await moneySnapshot([a.id, b.id, c.id]);
    expect(after).toEqual(before);
    expect(await db.auditLog.count({ where: { action: 'CHECK_IN_NO_SHOW_MARKED', entityId: t.id } })).toBe(1);
  });

  it('is idempotent and does not re-mark an event already past', async () => {
    const t = await event();
    const u = await player();
    await seat(t, u);
    await setWindow(t, { deadlineInMs: -30 * 60_000, startInMs: -30 * 60_000 });
    let first = { tournaments: 0, marked: 0 };
    for (let i = 0; i < 3; i += 1) {
      first = await markNoShows();
      if (first.marked >= 1) break;
    }
    expect(first.marked).toBeGreaterThanOrEqual(1);
    const second = await markNoShows();
    // Nothing new to mark for this event; the count for THIS tournament must not grow.
    expect(await db.auditLog.count({ where: { action: 'CHECK_IN_NO_SHOW_MARKED', entityId: t.id } })).toBe(1);
    expect(second.marked).toBeLessThanOrEqual(first.marked);
  });

  it('never marks a seat that cancelled itself out of the count', async () => {
    const u = await player();
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: -30 * 60_000, startInMs: -30 * 60_000 });
    await db.tournamentRegistration.update({ where: { id: reg }, data: { status: 'CANCELLED' } });
    // Several ticks: the point is that nothing ever marks it, not that one sweep ran.
    for (let i = 0; i < 3; i += 1) await markNoShows();
    expect((await attendance(reg)).noShowAt).toBeNull();
  });
});

describe('§D staff desk and board', () => {
  it('records a late arrival without erasing the earlier no-show', async () => {
    const admin = await makeUser({ cash: 0, role: 'ADMIN', prefix: 'p19a' });
    created.push(admin.id);
    const u = await player();
    const t = await event();
    const reg = await seat(t, u);
    await setWindow(t, { deadlineInMs: -30 * 60_000, startInMs: -30 * 60_000 });

    // Retry until this event has been swept (shared database, 50 actionable events per tick).
    for (let i = 0; i < 3 && (await attendance(reg)).noShowAt === null; i += 1) await markNoShows();
    expect((await attendance(reg)).noShowAt).toBeInstanceOf(Date);

    const out = await adminCheckIn(admin.id, reg, ctx);
    expect(out).toMatchObject({ checkedIn: true, alreadyCheckedIn: false });
    const row = await attendance(reg);
    expect(row.checkedInAt).toBeInstanceOf(Date);
    // History is append-only: the absence the timer recorded stays on the record.
    expect(row.noShowAt).toBeInstanceOf(Date);
    expect(await db.auditLog.count({ where: { actorId: admin.id, action: 'TOURNAMENT_CHECKED_IN_BY_STAFF' } })).toBe(1);
    expect(await db.notification.count({ where: { userId: u.id, title: 'You were checked in by staff' } })).toBe(1);

    const again = await adminCheckIn(admin.id, reg, ctx);
    expect(again.alreadyCheckedIn).toBe(true);
    expect(await db.auditLog.count({ where: { actorId: admin.id, action: 'TOURNAMENT_CHECKED_IN_BY_STAFF' } })).toBe(1);
  });

  it('marks a manual no-show once and refuses to stamp a seat that is not confirmed', async () => {
    const admin = await makeUser({ cash: 0, role: 'ADMIN', prefix: 'p19a' });
    created.push(admin.id);
    const u = await player();
    const ghost = await player();
    const t = await event();
    const reg = await seat(t, u);
    const ghostReg = await seat(t, ghost);
    await setWindow(t, { deadlineInMs: -60_000, startInMs: 15 * 60_000 });

    const first = await adminMarkNoShow(admin.id, reg, ctx);
    expect(first.alreadyMarked).toBe(false);
    expect(first.at).toBeInstanceOf(Date);
    const second = await adminMarkNoShow(admin.id, reg, ctx);
    expect(second.alreadyMarked).toBe(true);
    expect(await db.auditLog.count({ where: { actorId: admin.id, action: 'CHECK_IN_NO_SHOW_MARKED', entityId: reg } })).toBe(1);

    // A cancelled refund is not an entry: staff cannot record attendance for it.
    await db.tournamentRegistration.update({ where: { id: ghostReg }, data: { status: 'CANCELLED' } });
    await rejectsWithCode(() => adminCheckIn(admin.id, ghostReg, ctx), 'NOT_REGISTERED');
    expect((await attendance(reg)).checkedInAt).toBeNull();
  });

  it('shows staff the board: totals, who is missing, and the live window', async () => {
    const admin = await makeUser({ cash: 0, role: 'ADMIN', prefix: 'p19a' });
    created.push(admin.id);
    const here = await player();
    const away = await player();
    const t = await event();
    const regHere = await seat(t, here);
    const regAway = await seat(t, away);
    await setWindow(t, { deadlineInMs: -60_000, startInMs: 15 * 60_000 });
    await checkIn(here.id, t.slug, ctx);
    await db.tournamentRegistration.update({ where: { id: regAway }, data: { noShowAt: new Date() } });

    const board = await checkInBoard(admin.id, t.id);
    expect(board.summary).toEqual({ total: 2, checkedIn: 1, missing: 1 });
    expect(board.window.state).toBe('OPEN');
    const bySeat = [...board.registrations].sort((x, y) => (x.seatNumber ?? 0) - (y.seatNumber ?? 0));
    expect(bySeat[0]).toMatchObject({ username: here.username, checkedInAt: expect.any(Date) });
    expect(bySeat[1]).toMatchObject({ username: away.username, noShowAt: expect.any(Date) });
    expect(bySeat[1]!.checkedInAt).toBeNull();
  });

  it('refuses the board for a tournament that does not exist', async () => {
    const admin = await makeUser({ cash: 0, role: 'ADMIN', prefix: 'p19a' });
    created.push(admin.id);
    await rejectsWithCode(() => checkInBoard(admin.id, 'cuid-does-not-exist'), 'NOT_FOUND');
  });
});
