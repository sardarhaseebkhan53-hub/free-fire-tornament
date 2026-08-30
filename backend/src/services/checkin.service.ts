// =============================================================================
// Check-in — PHASE 19. "You paid" is not the same fact as "you are here".
//
// Before this, a paid seat had no attendance state at all: an organisation could not
// tell a no-show from a player who simply had not opened the app, could not reassign or
// chase a missing team, and had no record for a dispute about who was expected to play.
//
// Design rules this file holds to:
//
//   WINDOW       Check-in opens when registration closes and shuts at start time, unless
//                the admin set the two columns explicitly. Deriving the default from the
//                tournament's own timestamps means every event created before this feature
//                works immediately — no backfill, no "legacy" branch in the read path.
//   ATOMIC       One `updateMany` guarded on `checkedInAt: null` is the whole mutation, so
//                two tabs, a retry after a timeout, or a player racing staff at the desk
//                cannot produce two check-ins or a check-in after a cancellation.
//   IDEMPOTENT   Re-checking-in returns success (with `alreadyCheckedIn`), never an error:
//                a retry of a request that already landed must not look like a failure.
//   APPEND-ONLY  `noShowAt` is never cleared. If staff check in a player who had been
//                marked absent, both timestamps stand — the record then says what actually
//                happened, in order, and the audit entry carries the before/after.
//   NOT MONEY    No wallet, no ledger, no refund is touched here. Missing a check-in does
//                not take anyone's entry fee back; that stays an operator decision made
//                through the existing disqualification/refund paths.
// =============================================================================
import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import { confirmAbsent } from '../lib/tx-conflict';
import { audit } from '../lib/security';
import { pushForNotification } from '../lib/push';
import { notifyAdmins } from './notification.service';

export type CheckInWindowState = 'NOT_OPEN' | 'OPEN' | 'CLOSED' | 'MISCONFIGURED';

export interface CheckInWindow {
  opensAt: Date;
  closesAt: Date;
  /** True when the tournament did not set the window and it came from its own timestamps. */
  derived: boolean;
  state: CheckInWindowState;
}

/**
 * The window, resolved. `checkInOpensAt`/`checkInClosesAt` win when set; otherwise a
 * tournament is check-innable from the moment its roster is final (registration deadline)
 * to the moment it starts. A window that closes at or before it opens is reported as
 * MISCONFIGURED rather than being silently repaired — inventing a deadline the admin
 * never asked for is how an event quietly stops accepting anyone.
 */
export function resolveCheckInWindow(
  t: { checkInOpensAt: Date | null; checkInClosesAt: Date | null; registrationDeadline: Date; startTime: Date },
  // Routes pass a fresh Date; list paths pass the epoch they already computed once for
  // the whole page. Both mean the same instant — one clock, one decision.
  now: Date | number = new Date(),
): CheckInWindow {
  const at = typeof now === 'number' ? new Date(now) : now;
  const derived = t.checkInOpensAt === null || t.checkInClosesAt === null;
  const opensAt = t.checkInOpensAt ?? t.registrationDeadline;
  const closesAt = t.checkInClosesAt ?? t.startTime;
  let state: CheckInWindowState;
  if (closesAt.getTime() <= opensAt.getTime()) state = 'MISCONFIGURED';
  else if (at < opensAt) state = 'NOT_OPEN';
  else if (at >= closesAt) state = 'CLOSED';
  else state = 'OPEN';
  return { opensAt, closesAt, derived, state };
}

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d) + ' UTC';

/** The player's own check-in state for one event (also used by the desk view). */
const SELECTED = {
  id: true,
  status: true,
  seatNumber: true,
  checkedInAt: true,
  noShowAt: true,
  teamId: true,
  userId: true,
} as const;

/**
 * Check in. `ctx` is the request context for the audit trail, exactly as the join path
 * takes it — attendance is evidence in a dispute, so it is recorded with the same care.
 */
export async function checkIn(
  userId: string,
  tournamentSlug: string,
  ctx: { ip?: string; userAgent?: string } = {},
) {
  const t = await confirmAbsent(() =>
    prisma.tournament.findFirst({
      where: { slug: tournamentSlug, deletedAt: null },
      select: {
        id: true, title: true, slug: true, status: true,
        registrationDeadline: true, startTime: true,
        checkInOpensAt: true, checkInClosesAt: true,
      },
    }),
  );
  if (!t) throw notFound('Tournament not found');
  if (t.status === 'CANCELLED') throw badRequest('TOURNAMENT_CLOSED', 'This tournament was cancelled — check-in is off.');
  if (t.status === 'COMPLETED') throw badRequest('TOURNAMENT_CLOSED', 'This tournament has already finished.');

  const now = new Date();
  const window = resolveCheckInWindow(t, now);
  if (window.state === 'MISCONFIGURED') {
    throw badRequest('CHECK_IN_CLOSED', 'Check-in for this event is misconfigured by the organiser. Please contact support.');
  }
  if (window.state === 'NOT_OPEN') {
    throw badRequest('CHECK_IN_NOT_OPEN', `Check-in opens at ${fmt(window.opensAt)}.`);
  }
  if (window.state === 'CLOSED') {
    throw badRequest('CHECK_IN_CLOSED', `Check-in closed at ${fmt(window.closesAt)}. Contact the organiser if you arrived late.`);
  }

  const mine = await prisma.tournamentRegistration.findUnique({
    where: { tournamentId_userId: { tournamentId: t.id, userId } },
    select: SELECTED,
  });
  if (!mine || mine.status !== 'CONFIRMED') {
    throw badRequest('NOT_REGISTERED', 'You do not hold a confirmed seat in this tournament.');
  }
  if (mine.checkedInAt) {
    return { checkedIn: true, alreadyCheckedIn: true, at: mine.checkedInAt, seatNumber: mine.seatNumber, window };
  }

  // The single guarded write. `status: 'CONFIRMED'` in the same predicate means a
  // cancellation landing right now cannot be raced into a check-in on a dead seat.
  const claimed = await prisma.tournamentRegistration.updateMany({
    where: { id: mine.id, status: 'CONFIRMED', checkedInAt: null },
    data: { checkedInAt: now },
  });
  if (claimed.count === 0) {
    const fresh = await prisma.tournamentRegistration.findUnique({ where: { id: mine.id }, select: SELECTED });
    if (fresh?.checkedInAt) {
      // Lost the race to your own second tab / a retry: that is a success, not an error.
      return { checkedIn: true, alreadyCheckedIn: true, at: fresh.checkedInAt, seatNumber: fresh.seatNumber, window };
    }
    throw conflict('CONFLICT', 'Your registration changed while you were checking in. Reload and try again.');
  }

  await audit({
    actorId: userId,
    action: 'TOURNAMENT_CHECKED_IN',
    entity: 'TournamentRegistration',
    entityId: mine.id,
    after: { tournamentId: t.id, seatNumber: mine.seatNumber, at: now.toISOString() },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const notification = await prisma.notification.create({
    data: {
      userId,
      type: 'TOURNAMENT_UPDATE',
      title: 'Checked in ✅',
      body: `You are checked in for ${t.title}. Seat #${mine.seatNumber ?? '—'} is held for you.`,
      data: { tournamentId: t.id, slug: t.slug, area: 'matches' },
    },
    select: { type: true, title: true, body: true, data: true },
  });
  // After the write, outside any transaction, fire-and-forget by contract.
  pushForNotification([userId], {
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: (notification.data ?? {}) as Record<string, unknown>,
  });

  return { checkedIn: true, alreadyCheckedIn: false, at: now, seatNumber: mine.seatNumber, window };
}

/**
 * Mark everyone who did not check in once their window shut. Idempotent and index-backed
 * (tournaments are selected by `checkInClosesAt`, registrations by the partial predicate),
 * so running it twice, or after a restart, cannot double-mark or un-mark anybody.
 *
 * It records attendance only. It never touches a wallet: a no-show forfeit has to be a
 * deliberate, visible operator action, not a side effect of a 30-second timer.
 */
export async function markNoShows(now: Date = new Date()): Promise<{ tournaments: number; marked: number }> {
  const due = await prisma.tournament.findMany({
    where: {
      deletedAt: null,
      status: { in: ['REGISTRATION_OPEN', 'LIVE'] },
      // Only events that still have something to mark. Without this the query keeps
      // returning every historical event whose window has shut (their status rarely moves
      // on its own), so after a few hundred finished events the 50-row budget is spent on
      // no-ops and a freshly finished event is starved forever. This is also what makes
      // the sweep cheap: the partial index below is exactly this predicate.
      registrations: { some: { status: 'CONFIRMED', checkedInAt: null, noShowAt: null } },
      OR: [
        { checkInClosesAt: { not: null, lt: now } },
        // Derived windows shut at start time.
        { checkInClosesAt: null, startTime: { lt: now } },
      ],
    },
    select: { id: true, title: true, slug: true, checkInClosesAt: true, startTime: true },
    // Oldest event first, capped per tick: a deployment that was down over a weekend
    // drains its backlog in order instead of doing an unbounded sweep in one request.
    orderBy: { startTime: 'asc' },
    take: 50,
  });
  let markedTotal = 0;
  for (const t of due) {
    // Only past the shut-off, never exactly on it: `<= now` on a derived window would
    // otherwise mark players in the same tick that start time passes.
    const shutAt = t.checkInClosesAt ?? t.startTime;
    if (shutAt.getTime() >= now.getTime()) continue;
    const candidates = await prisma.tournamentRegistration.findMany({
      where: { tournamentId: t.id, status: 'CONFIRMED', checkedInAt: null, noShowAt: null },
      select: { id: true },
    });
    if (candidates.length === 0) continue;
    const marked = await prisma.tournamentRegistration.updateMany({
      where: { tournamentId: t.id, status: 'CONFIRMED', checkedInAt: null, noShowAt: null },
      data: { noShowAt: now },
    });
    if (marked.count === 0) continue;
    markedTotal += marked.count;
    // Keep the bulk mutation efficient, but retain one immutable audit event per
    // registration so staff can prove exactly which player was marked absent.
    await Promise.all(
      candidates.slice(0, marked.count).map((registration) =>
        audit({
          action: 'CHECK_IN_NO_SHOW_MARKED',
          entity: 'TournamentRegistration',
          entityId: registration.id,
          after: { tournamentId: t.id, windowClosedAt: shutAt.toISOString() },
        }),
      ),
    );
    await notifyAdmins({
      type: 'TOURNAMENT_UPDATE',
      title: `No-shows marked — ${t.title}`,
      body: `${marked.count} confirmed ${marked.count === 1 ? 'player' : 'players'} had not checked in when the window closed. See Admin → Slots for the list.`,
      data: { tournamentId: t.id, slug: t.slug, area: 'slots' },
    }).catch(() => 0);
  }
  return { tournaments: due.length, marked: markedTotal };
}

/** Per-event attendance board for staff (Admin → Slots). */
export async function checkInBoard(adminId: string, tournamentId: string) {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true, title: true, slug: true, status: true,
      registrationDeadline: true, startTime: true,
      checkInOpensAt: true, checkInClosesAt: true,
    },
  });
  if (!t) throw notFound('Tournament not found');
  void adminId; // requireAdmin already ran; kept in the signature so every staff action is attributable
  const rows = await prisma.tournamentRegistration.findMany({
    where: { tournamentId, status: { in: ['CONFIRMED', 'DISQUALIFIED'] } },
    select: {
      ...SELECTED,
      user: { select: { username: true } },
      team: { select: { tag: true, name: true } },
    },
    orderBy: [{ seatNumber: 'asc' }, { userId: 'asc' }],
  });
  const checkedIn = rows.filter((r) => r.checkedInAt !== null).length;
  return {
    tournament: { id: t.id, title: t.title, slug: t.slug, status: t.status },
    window: resolveCheckInWindow(t),
    summary: { total: rows.length, checkedIn, missing: rows.length - checkedIn },
    registrations: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.user.username,
      team: r.team ? (r.team.tag || r.team.name) : null,
      seatNumber: r.seatNumber,
      status: r.status,
      checkedInAt: r.checkedInAt,
      noShowAt: r.noShowAt,
    })),
  };
}

/**
 * Organiser sets (or clears) the window for one event.
 *
 * `null` on either side means "derive it from the tournament's own timestamps", which is
 * the state every pre-existing event is in — so clearing a window is a supported action,
 * not an error. The ordering rule is checked against the PROJECTED window (derived halves
 * included), because an explicit close before a derived open is just as locked-out as a
 * fully explicit inversion, and that is the one misconfiguration that silently keeps
 * every paying player from checking in.
 */
export async function setCheckInWindow(
  adminId: string,
  tournamentId: string,
  input: { opensAt: Date | null; closesAt: Date | null },
  ctx: { ip?: string; userAgent?: string } = {},
) {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, deletedAt: null },
    select: {
      id: true, title: true, slug: true,
      registrationDeadline: true, startTime: true, checkInOpensAt: true, checkInClosesAt: true,
    },
  });
  if (!t) throw notFound('Tournament not found');

  const opensAt = input.opensAt ?? null;
  const closesAt = input.closesAt ?? null;
  const projected = resolveCheckInWindow({
    checkInOpensAt: opensAt,
    checkInClosesAt: closesAt,
    registrationDeadline: t.registrationDeadline,
    startTime: t.startTime,
  });
  if (projected.state === 'MISCONFIGURED') {
    throw badRequest(
      'VALIDATION_ERROR',
      `Check-in must close after it opens. Resolved window would be ${fmt(projected.opensAt)} to ${fmt(projected.closesAt)}.`,
    );
  }

  const updated = await prisma.tournament.update({
    where: { id: t.id },
    data: { checkInOpensAt: opensAt, checkInClosesAt: closesAt },
    select: { id: true, checkInOpensAt: true, checkInClosesAt: true, registrationDeadline: true, startTime: true },
  });
  await audit({
    actorId: adminId,
    action: 'CHECK_IN_WINDOW_SET',
    entity: 'Tournament',
    entityId: t.id,
    before: { checkInOpensAt: t.checkInOpensAt?.toISOString() ?? null, checkInClosesAt: t.checkInClosesAt?.toISOString() ?? null },
    after: { checkInOpensAt: updated.checkInOpensAt?.toISOString() ?? null, checkInClosesAt: updated.checkInClosesAt?.toISOString() ?? null },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return {
    tournamentId: t.id,
    window: resolveCheckInWindow(updated),
    confirmedSeats: await prisma.tournamentRegistration.count({ where: { tournamentId: t.id, status: 'CONFIRMED' } }),
  };
}

/**
 * Staff check-in at the desk — the reason `noShowAt` is not a lock. A player whose phone
 * died, or who queued behind a registration desk, is still the person who paid for that
 * seat; refusing to record it would only make the data less true.
 *
 * Both timestamps stay: the board then shows "marked absent at 19:02, checked in at
 * 19:11", which is the actual history, rather than a rewritten one.
 */
export async function adminCheckIn(
  adminId: string,
  registrationId: string,
  ctx: { ip?: string; userAgent?: string } = {},
) {
  const reg = await prisma.tournamentRegistration.findUnique({
    where: { id: registrationId },
    select: { ...SELECTED, tournament: { select: { id: true, title: true, status: true } } },
  });
  if (!reg) throw notFound('Registration not found');
  if (reg.tournament.status === 'CANCELLED') throw badRequest('TOURNAMENT_CLOSED', 'This tournament was cancelled.');
  if (reg.status !== 'CONFIRMED') throw badRequest('NOT_REGISTERED', 'This seat is not a confirmed entry.');
  if (reg.checkedInAt) return { checkedIn: true, alreadyCheckedIn: true, at: reg.checkedInAt };

  const now = new Date();
  const claimed = await prisma.tournamentRegistration.updateMany({
    where: { id: reg.id, status: 'CONFIRMED', checkedInAt: null },
    data: { checkedInAt: now },
  });
  if (claimed.count === 0) throw conflict('CONFLICT', 'This seat was just updated by someone else. Reload to see its current state.');

  await audit({
    actorId: adminId,
    action: 'TOURNAMENT_CHECKED_IN_BY_STAFF',
    entity: 'TournamentRegistration',
    entityId: reg.id,
    before: { checkedInAt: null, noShowAt: reg.noShowAt ? reg.noShowAt.toISOString() : null },
    after: { checkedInAt: now.toISOString(), noShowAt: reg.noShowAt ? reg.noShowAt.toISOString() : null },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  await prisma.notification.create({
    data: {
      userId: reg.userId,
      type: 'TOURNAMENT_UPDATE',
      title: 'You were checked in by staff',
      body: `Staff confirmed your seat for ${reg.tournament.title}.`,
      data: { area: 'matches' },
    },
  });
  return { checkedIn: true, alreadyCheckedIn: false, at: now };
}

/** The same, in reverse: staff record that a seat did not appear. */
export async function adminMarkNoShow(
  adminId: string,
  registrationId: string,
  ctx: { ip?: string; userAgent?: string } = {},
) {
  const reg = await prisma.tournamentRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, userId: true, checkedInAt: true, noShowAt: true, status: true },
  });
  if (!reg) throw notFound('Registration not found');
  if (reg.noShowAt) return { noShow: true, alreadyMarked: true, at: reg.noShowAt };
  const now = new Date();
  const marked = await prisma.tournamentRegistration.updateMany({
    where: { id: reg.id, noShowAt: null },
    data: { noShowAt: now },
  });
  if (marked.count === 0) throw conflict('CONFLICT', 'This seat was just updated by someone else. Reload to see its current state.');
  await audit({
    actorId: adminId,
    action: 'CHECK_IN_NO_SHOW_MARKED',
    entity: 'TournamentRegistration',
    entityId: reg.id,
    before: { checkedInAt: reg.checkedInAt ? reg.checkedInAt.toISOString() : null, noShowAt: null },
    after: { noShowAt: now.toISOString(), manual: true },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { noShow: true, alreadyMarked: false, at: now };
}
