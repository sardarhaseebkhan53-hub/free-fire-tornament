// =============================================================================
// Tournament ROOM MANAGEMENT — the event's Free Fire Room ID / password.
//
// Operators run single-room events: the room belongs to the TOURNAMENT, not to a match
// row, and it has to be controlled from the tournament itself. This service owns that
// whole lifecycle — add, update, hide, cancel, re-activate, and the timed release that
// decides who may see the two values.
//
// THE ONE RULE THIS FILE EXISTS FOR
//   A credential leaves this process in exactly one place: `playerRoomView`, for a
//   caller who (a) holds a confirmed seat on the event and (b) is reading it at or after
//   the release instant. Everything else — the public tournament page, the tournament
//   lists, the app's "my registrations" feed, the admin tournament table — gets the
//   *state* and the *timing*, never the values. The release therefore cannot be bypassed
//   from a client: there is no hidden field in the payload to reveal, and no fetch trick
//   that obtains a credential the server has not already decided to hand over.
//
// WHY `tournament_rooms` AND NOT COLUMNS ON `tournaments`
//   Tournament rows are read and SPREAD all over this codebase — the public detail
//   response is literally `{ ...core }` over an `include`. Credentials as columns there
//   would be one forgotten `select` away from leaking on a public page. On their own
//   table, a response carries a credential only if a query deliberately asked for one.
//
// DESIGN DECISIONS
//   DERIVED RELEASE   The release instant is `startTime − lead minutes` unless an admin
//                     pins an exact time or a per-event lead. Moving an event moves its
//                     release with it, instead of quietly leaving a room unlocked since
//                     yesterday. Same philosophy as the check-in window
//                     (`resolveCheckInWindow`).
//   CONFIGURABLE      lead = per-event column → platform Setting → ROOM_RELEASE_MINUTES
//                     env (default 5). Nobody edits code to make it 6.
//   CACHE, NOT TRUTH  `TournamentRoom.status` is written for listing and filtering, but
//                     every read re-derives it, so a missed scheduler tick can never show
//                     a stale "Room Available" — or hide a room that has already unlocked.
//   CANCEL IS DECIDED Cancellation is the one state the clock cannot produce, so it is
//                     stored, checked first, and cleared only by an explicit admin action.
//                     The values survive in the row (a cancelled room is often a mis-click
//                     that wants undoing) but are unreachable until re-activation.
//   AUDIT NEVER LEAKS Every mutation writes an AuditLog row with before/after. The Room ID
//                     is recorded (it identifies the room in a dispute); the PASSWORD
//                     NEVER IS — audit rows are readable by every admin account and are
//                     kept forever.
// =============================================================================
import { env } from '../lib/env';
import { moneyTx, prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { auditIn } from '../lib/security';
import { getSetting } from './settings.service';
import { pushForNotification } from '../lib/push';

export const ROOM_STATUSES = ['NOT_ADDED', 'SCHEDULED', 'AVAILABLE', 'CANCELLED'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

/** The four labels the spec asks for, verbatim, in the admin panel and the player card. */
export const ROOM_LABEL: Record<RoomStatus, string> = {
  NOT_ADDED: 'Room Not Added',
  SCHEDULED: 'Room Scheduled',
  AVAILABLE: 'Room Available',
  CANCELLED: 'Room Cancelled',
};

/**
 * Free Fire custom-room credentials are NUMERIC ONLY — the in-game room ID
 * and password are digits, full stop. The pattern is a whitelist of exactly
 * that, which also excludes quotes, angle brackets, newlines and control
 * characters for free, keeping the value safe in audit JSON, CSV exports and
 * templated messages without needing per-sink escaping. Values stay STRINGS
 * end to end (never Number()) so 20-digit room IDs cannot lose precision.
 */
const ROOM_ID_RE = /^\d{3,20}$/;
/** Free Fire room passwords are digits too; 30 is generous for a hand-typed code. */
const ROOM_PW_RE = /^\d{3,30}$/;

/** One message per field, shared by the builder and the room panel so they can never diverge.
 *  Keep textually identical to ROOM_ID_RULE / ROOM_PW_RULE in frontend/lib/room-form.ts. */
const ERR_ID = 'Room ID must be numbers only — 3 to 20 digits.';
const ERR_PW = 'Room password must be numbers only — 3 to 30 digits.';
const ERR_LEAD = 'Release lead must be a whole number of minutes between 0 and 1440.';

/** The room columns the resolver reads. Credentials included: presence IS part of the state. */
export const ROOM_ROW_SELECT = {
  status: true,
  releaseAt: true,
  releaseMinutes: true,
  releasedAt: true,
  hiddenAt: true,
  cancelledAt: true,
  cancelReason: true,
  note: true,
  updatedAt: true,
  roomId: true,
  roomPassword: true,
} as const;

/**
 * The select for paths that may NOT hold a credential: the state columns, plus the Room ID
 * column ONLY because "is a room filled in at all?" is part of the state machine. No
 * password and no staff note — so the worst a careless `...spread` of such a row could do
 * is surface a value the release rules already show to the seated players, instead of a
 * password or an internal note. `flagsToRoom` turns the Room ID into a presence flag before
 * the resolver sees it, and every response builder uses only the derived view.
 */
export const ROOM_FLAG_SELECT = {
  status: true,
  releaseAt: true,
  releaseMinutes: true,
  hiddenAt: true,
  cancelledAt: true,
  cancelReason: true,
  roomId: true,
} as const;

/**
 * Turn a row that only knows "is there a Room ID?" into a resolver input: both credential
 * slots become a sentinel string, because the state machine only ever asks whether they are
 * filled. A caller that goes on to try to READ a value out of the result gets 'set', never a
 * password — which is the point.
 */
export function flagsToRoom<T extends { roomId: string | null }>(row: T | null): RoomRow {
  if (!row) return { roomId: null, roomPassword: null };
  const has = typeof row.roomId === 'string' && row.roomId.trim() !== '';
  return { ...row, roomId: has ? 'set' : null, roomPassword: has ? 'set' : null };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The platform-wide lead time, in minutes before `startTime`.
 *
 * The Setting row (admin-editable at runtime, seeded to the same default as the env) wins
 * over `ROOM_RELEASE_MINUTES`, which wins over the built-in 5. Read through `getSetting`,
 * so a list of forty events costs one cached lookup rather than forty queries — the same
 * budget the rest of the read paths already work to.
 */
export async function globalRoomReleaseMinutes(): Promise<number> {
  const raw = await getSetting<number | string | null>('tournament.roomReleaseMinutes', env.ROOM_RELEASE_MINUTES);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(1440, Math.floor(n)) : env.ROOM_RELEASE_MINUTES;
}

/** The event's own lead if it set one, otherwise the platform-wide value. */
export function effectiveReleaseMinutes(room: { releaseMinutes?: number | null } | null, globalMinutes: number): number {
  const own = room?.releaseMinutes;
  if (own === null || own === undefined) return globalMinutes;
  const n = Number(own);
  return Number.isFinite(n) && n >= 0 ? Math.min(1440, Math.floor(n)) : globalMinutes;
}

// ---------------------------------------------------------------------------
// The resolver — every room status the platform shows comes out of here
// ---------------------------------------------------------------------------

/**
 * A room row, as far as the resolver is concerned. Everything but `roomId` is optional
 * because the list paths select only the state columns (see `ROOM_FLAG_SELECT`) — the
 * resolver never needs a value, only whether one exists.
 */
export interface RoomRow {
  status?: string;
  roomId: string | null;
  roomPassword?: string | null;
  releaseAt?: Date | null;
  releaseMinutes?: number | null;
  releasedAt?: Date | null;
  hiddenAt?: Date | null;
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  note?: string | null;
  updatedAt?: Date | null;
}

/** What the resolver needs: the event's clock, its own status, and its room row. */
export interface RoomSource {
  startTime: Date;
  /** Tournament.status — a cancelled EVENT must not hand out a room either. */
  status?: string;
  room: RoomRow | null;
}

export interface RoomState {
  status: RoomStatus;
  label: string;
  /** Whether either credential exists — the admin form's "add" versus "update". */
  hasRoomId: boolean;
  hasRoomPassword: boolean;
  /** True exactly when an eligible player may see the values right now. */
  unlocked: boolean;
  /** The instant the current credentials unlock (or unlocked). */
  releaseAt: Date;
  /** The instant the platform first observed them unlocked, for this set of values. */
  releasedAt: Date | null;
  /** Milliseconds until `releaseAt`; already elapsed when negative. */
  releaseInMs: number;
  /** Minutes before start the release sits at, and who said so. */
  releaseMinutes: number;
  releaseSource: 'PINNED' | 'EVENT' | 'GLOBAL';
  /** An admin has hidden the room: kept, never served, one click from being shown again. */
  hidden: boolean;
  cancelledAt: Date | null;
  cancelReason: string | null;
  note: string | null;
  updatedAt: Date | null;
}

const EMPTY_ROOM: RoomRow = {
  roomId: null,
  roomPassword: null,
  releaseAt: null,
  releaseMinutes: null,
  releasedAt: null,
  hiddenAt: null,
  cancelledAt: null,
  cancelReason: null,
  note: null,
  updatedAt: null,
} as const;

/**
 * Pure, synchronous and total: given the event's clock, its room row and the configured
 * lead, it answers what the room's state is. No database access, so it can be exercised at
 * the exact release boundary (tests/unit/room.test.ts) and reused unchanged by the read
 * path, the admin board, the lists and the scheduler.
 *
 * The order of the branches IS the security order: a cancellation beats everything, an
 * admin hide beats the clock, and only then does the clock decide.
 */
export function resolveRoomState(
  source: RoomSource,
  globalMinutes: number,
  now: Date | number = new Date(),
): RoomState {
  const at = typeof now === 'number' ? new Date(now) : now;
  const room = source.room ?? EMPTY_ROOM;
  const hasRoomId = typeof room.roomId === 'string' && room.roomId.trim() !== '';
  const hasRoomPassword = typeof room.roomPassword === 'string' && room.roomPassword.trim() !== '';
  const hasCredentials = hasRoomId || hasRoomPassword;
  const eventCancelled = source.status === 'CANCELLED';
  const cancelled = (room.cancelledAt ?? null) !== null || eventCancelled;

  const releaseMinutes = effectiveReleaseMinutes(room, globalMinutes);
  // A pinned instant wins; otherwise the release rides on the event's own start time.
  // `startTime` is NOT NULL, so there is always a real number to derive from — and an
  // event with no room still yields a valid answer, it is simply never served.
  const start = source.startTime instanceof Date ? source.startTime.getTime() : new Date(source.startTime).getTime();
  const releaseAt = room.releaseAt ?? new Date(start - releaseMinutes * 60_000);
  const releaseSource: RoomState['releaseSource'] = room.releaseAt
    ? 'PINNED'
    : (room.releaseMinutes ?? null) !== null ? 'EVENT' : 'GLOBAL';

  let status: RoomStatus;
  if (cancelled) status = 'CANCELLED';
  else if (!hasCredentials) status = 'NOT_ADDED';
  else if ((room.hiddenAt ?? null) !== null) status = 'SCHEDULED';
  else status = releaseAt.getTime() <= at.getTime() ? 'AVAILABLE' : 'SCHEDULED';

  return {
    status,
    label: ROOM_LABEL[status],
    hasRoomId,
    hasRoomPassword,
    // The ONLY flag any credential response may depend on.
    unlocked: status === 'AVAILABLE',
    releaseAt,
    releasedAt: room.releasedAt ?? null,
    releaseInMs: releaseAt.getTime() - at.getTime(),
    releaseMinutes,
    releaseSource,
    hidden: (room.hiddenAt ?? null) !== null,
    cancelledAt: room.cancelledAt ?? null,
    // An explicit room cancellation carries the admin's reason; a cancelled EVENT
    // explains itself.
    cancelReason: room.cancelReason ?? (eventCancelled ? 'The tournament was cancelled.' : null),
    note: room.note ?? null,
    updatedAt: room.updatedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Eligibility — who may see the room
// ---------------------------------------------------------------------------

/**
 * A confirmed seat on the event. Two shapes count, because the join engine writes both:
 *   • the player's own CONFIRMED registration (SOLO, and every member of a team join —
 *     each player pays and each player gets a row), and
 *   • a CONFIRMED team registration for a team the player belongs to — which is what a
 *     squad looks like when the captain holds the seat, and what an admin-paired
 *     independent entry looks like before its rows were rewritten.
 *
 * CANCELLED / REFUNDED / DISQUALIFIED never qualify: a refunded seat is not a seat. The
 * team branch goes through `team.members`, so leaving or being kicked out of a squad
 * revokes the room with it.
 */
export async function isRoomEligible(tournamentId: string, userId: string): Promise<boolean> {
  const own = await prisma.tournamentRegistration.findFirst({
    where: { tournamentId, userId, status: 'CONFIRMED' },
    select: { id: true },
  });
  if (own) return true;
  const viaTeam = await prisma.tournamentRegistration.findFirst({
    where: { tournamentId, status: 'CONFIRMED', team: { members: { some: { userId } } } },
    select: { id: true },
  });
  return viaTeam !== null;
}

/** Everyone holding a seat — the fan-out list for the "room is open / cancelled" alerts. */
export async function roomAudience(tournamentId: string): Promise<string[]> {
  const regs = await prisma.tournamentRegistration.findMany({
    where: { tournamentId, status: 'CONFIRMED' },
    select: { userId: true, team: { select: { members: { select: { userId: true } } } } },
  });
  const users = new Set<string>();
  for (const r of regs) {
    users.add(r.userId);
    for (const m of r.team?.members ?? []) users.add(m.userId);
  }
  return Array.from(users);
}

// ---------------------------------------------------------------------------
// ADMIN — the room board for one event
// ---------------------------------------------------------------------------

/**
 * What the admin panel sees: the state, the timing, the seat count — and the values,
 * because an operator cannot verify a room they are not allowed to read. The route serving
 * this sets `Cache-Control: no-store`, and nothing player-facing is ever built from it.
 */
export async function adminRoomView(tournamentId: string) {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, deletedAt: null },
    select: {
      id: true, title: true, slug: true, type: true, status: true,
      maxSlots: true, registeredSlots: true, registrationDeadline: true, endTime: true,
      startTime: true,
      room: { select: ROOM_ROW_SELECT },
      matches: {
        where: { deletedAt: null },
        orderBy: { matchNumber: 'asc' },
        select: { id: true, matchNumber: true, scheduledAt: true, status: true, roomId: true, credentialsReleaseAt: true },
      },
    },
  });
  if (!t) throw notFound('Tournament not found');

  const globalMinutes = await globalRoomReleaseMinutes();
  const state = resolveRoomState(t, globalMinutes);
  const seats = await prisma.tournamentRegistration.count({ where: { tournamentId: t.id, status: 'CONFIRMED' } });

  return {
    tournament: {
      id: t.id, title: t.title, slug: t.slug, type: t.type, status: t.status,
      startTime: t.startTime, registrationDeadline: t.registrationDeadline, endTime: t.endTime,
      maxSlots: t.maxSlots, registeredSlots: t.registeredSlots, confirmedSeats: seats,
    },
    room: { ...state, roomId: t.room?.roomId ?? null, roomPassword: t.room?.roomPassword ?? null },
    config: { globalReleaseMinutes: globalMinutes },
    // Match-level rooms are a separate thing on a separate clock; the board lists them so
    // an admin can tell which room a player is actually looking at.
    matchRooms: t.matches.map((m) => ({
      id: m.id,
      matchNumber: m.matchNumber,
      scheduledAt: m.scheduledAt,
      status: m.status,
      hasCredentials: m.roomId !== null,
      releaseAt: m.credentialsReleaseAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// ADMIN — add / update the credentials
// ---------------------------------------------------------------------------

export interface SetRoomInput {
  /** `undefined` = leave the column alone; `null` / `''` = clear it. */
  roomId?: string | null;
  roomPassword?: string | null;
  /** Pinned release instant (ISO). `null` clears the pin and re-derives from startTime. */
  releaseAt?: string | null;
  /** Per-event lead in minutes. `null` returns the event to the platform-wide value. */
  releaseMinutesBeforeStart?: number | null;
  /** `false` hides the room (kept, never served); `true` shows it again. */
  enabled?: boolean;
  note?: string | null;
}

/** Trim a client string into a column value, keeping "not sent" distinguishable from "cleared". */
const field = (v: string | null | undefined): string | null | undefined =>
  v === undefined ? undefined : ((v ?? '').trim() || null);

/**
 * Write the event's Room ID / password and its release timing.
 *
 * One endpoint for "add" and "update" — an update IS a re-add into the same slot — so the
 * panel cannot grow into two half-implementations of the validation.
 *
 * Guards worth knowing about:
 *   • a CANCELLED room cannot be edited back into being live. Otherwise a stale "save" in
 *     somebody's open tab quietly re-arms credentials an admin deliberately pulled;
 *     re-activating is an explicit action of its own;
 *   • either half may be sent alone (fixing a typo in the password must not require
 *     retyping the Room ID), but the pair may not be emptied through this endpoint — use
 *     Hide or Cancel, both of which leave an audit row saying so;
 *   • updating AFTER the release instant has passed means the new values are visible
 *     immediately. That is the point (the lobby got locked, a fresh one was made), and it
 *     is why the release mark is reset: the audience is told once about each version.
 */
export async function setTournamentRoom(
  adminId: string,
  tournamentId: string,
  input: SetRoomInput,
  ctx: { ip?: string; userAgent?: string } = {},
) {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, deletedAt: null },
    select: { id: true, title: true, startTime: true, status: true, room: { select: ROOM_ROW_SELECT } },
  });
  if (!t) throw notFound('Tournament not found');
  const current = t.room;
  if (current?.cancelledAt) {
    throw conflict('CONFLICT', 'This room was cancelled. Re-activate it from the room panel before changing its credentials.');
  }

  const roomId = field(input.roomId);
  const roomPassword = field(input.roomPassword);
  if (roomId !== undefined && roomId !== null && !ROOM_ID_RE.test(roomId)) throw badRequest('VALIDATION_ERROR', ERR_ID);
  if (roomPassword !== undefined && roomPassword !== null && !ROOM_PW_RE.test(roomPassword)) throw badRequest('VALIDATION_ERROR', ERR_PW);
  const nextRoomId = roomId === undefined ? (current?.roomId ?? null) : roomId;
  const nextRoomPassword = roomPassword === undefined ? (current?.roomPassword ?? null) : roomPassword;
  if (nextRoomId === null && nextRoomPassword === null) {
    throw badRequest('VALIDATION_ERROR', 'A room needs a Room ID or a password — use "Hide room" or "Cancel room" to take one away from players.');
  }

  // --- release timing -----------------------------------------------------
  const globalMinutes = await globalRoomReleaseMinutes();
  let releaseAt: Date | null | undefined;
  if (input.releaseAt !== undefined) {
    if (input.releaseAt === null || String(input.releaseAt).trim() === '') releaseAt = null;
    else {
      const d = new Date(input.releaseAt);
      if (Number.isNaN(d.getTime())) throw badRequest('VALIDATION_ERROR', 'Invalid release time.');
      releaseAt = d;
    }
  }
  let releaseMinutes: number | null | undefined;
  if (input.releaseMinutesBeforeStart !== undefined) {
    if (input.releaseMinutesBeforeStart === null) releaseMinutes = null;
    else {
      const n = Number(input.releaseMinutesBeforeStart);
      if (!Number.isInteger(n) || n < 0 || n > 1440) throw badRequest('VALIDATION_ERROR', ERR_LEAD);
      releaseMinutes = n;
    }
  }
  let note: string | null | undefined;
  if (input.note !== undefined) {
    note = (input.note ?? '').trim() || null;
    if (note !== null && note.length > 300) throw badRequest('VALIDATION_ERROR', 'Room note is limited to 300 characters.');
  }
  const hiddenAt = input.enabled === undefined ? (current?.hiddenAt ?? null) : input.enabled ? null : new Date();

  const next = {
    roomId: nextRoomId,
    roomPassword: nextRoomPassword,
    releaseAt: releaseAt === undefined ? (current?.releaseAt ?? null) : releaseAt,
    releaseMinutes: releaseMinutes === undefined ? (current?.releaseMinutes ?? null) : releaseMinutes,
    releasedAt: current?.releasedAt ?? null,
    hiddenAt,
    cancelledAt: null,
    cancelReason: null,
    note: note === undefined ? (current?.note ?? null) : note,
    updatedAt: null,
  };
  // Decided BEFORE the write, so the response can tell the admin the truth about whether
  // what they just typed is already sitting in front of the players.
  const projected = resolveRoomState({ startTime: t.startTime, status: t.status, room: next }, globalMinutes);
  const credentialsChanged =
    (roomId !== undefined && roomId !== (current?.roomId ?? null)) ||
    (roomPassword !== undefined && roomPassword !== (current?.roomPassword ?? null));

  const data = {
    roomId: nextRoomId,
    roomPassword: nextRoomPassword,
    releaseAt: next.releaseAt,
    releaseMinutes: next.releaseMinutes,
    hiddenAt,
    note: next.note,
    status: projected.status,
    // Rotating the credentials re-arms the once-only announcement: players were told about
    // the old room, and a new password nobody announces is a seat nobody can take.
    ...(credentialsChanged ? { releasedAt: null } : {}),
  };

  const updated = await moneyTx(async (tx) => {
    const row = await tx.tournamentRoom.upsert({
      where: { tournamentId },
      create: { tournamentId, ...data },
      update: data,
      select: ROOM_ROW_SELECT,
    });
    await auditIn(tx, {
      actorId: adminId,
      action: 'ROOM_UPDATED',
      entity: 'Tournament',
      entityId: tournamentId,
      // The password is deliberately absent — see the note at the top of the file. This
      // boolean says a password moved without saying to what.
      before: {
        roomId: current?.roomId ?? null, releaseAt: current?.releaseAt ?? null,
        releaseMinutes: current?.releaseMinutes ?? null, hiddenAt: current?.hiddenAt ?? null,
        note: current?.note ?? null, status: current?.status ?? 'NOT_ADDED',
      },
      after: {
        roomId: row.roomId, releaseAt: row.releaseAt, releaseMinutes: row.releaseMinutes,
        hiddenAt: row.hiddenAt, note: row.note, status: projected.status,
        passwordChanged: credentialsChanged,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return row;
  });

  const state = resolveRoomState({ startTime: t.startTime, status: t.status, room: updated }, globalMinutes);
  return {
    room: { ...state, roomId: updated.roomId, roomPassword: updated.roomPassword },
    // Loud on purpose: this is the case where the credentials went public the moment they
    // were saved, because the event starts inside its own release window.
    releasedImmediately: state.unlocked,
    releaseAt: state.releaseAt,
    releaseInMs: state.releaseInMs,
    releaseMinutes: state.releaseMinutes,
    releaseSource: state.releaseSource,
  };
}

// ---------------------------------------------------------------------------
// ADMIN — hide / show / cancel / re-activate
// ---------------------------------------------------------------------------

export const ROOM_ACTIONS = ['HIDE', 'SHOW', 'CANCEL', 'REACTIVATE'] as const;
export type RoomAction = (typeof ROOM_ACTIONS)[number];

interface RoomActionPlan {
  data: {
    status: RoomStatus;
    hiddenAt?: Date | null;
    cancelledAt?: Date | null;
    cancelReason?: string | null;
    releasedAt?: Date | null;
  };
  /** Re-state the state the action is valid FROM, so a double click is a no-op. */
  guard: Record<string, unknown>;
  auditAction: string;
  message: string;
  /** Whether the players holding a seat need to be told, right now. */
  announce: boolean;
}

/**
 * The four room switches, as one guarded write.
 *
 * Each action is a conditional UPDATE whose `where` restates the state the admin acted
 * on, so two admins clicking Cancel in the same second produce ONE cancellation and ONE
 * audit row rather than two of each — the same compare-and-set the tournament status and
 * check-in paths already use.
 *
 * CANCEL keeps the values in the row and stops serving them. That is deliberate: the
 * operator's very next move after "cancel the room" is often "…no, wait, the lobby is
 * fine, put it back", and re-activating must not require retyping a password somebody
 * would have to go and find again. Players see neither version while it is cancelled.
 */
export async function setRoomStatus(
  adminId: string,
  tournamentId: string,
  action: RoomAction,
  reason: string | null | undefined,
  ctx: { ip?: string; userAgent?: string } = {},
) {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, deletedAt: null },
    select: {
      id: true, title: true, startTime: true, status: true,
      room: { select: ROOM_ROW_SELECT },
    },
  });
  if (!t) throw notFound('Tournament not found');
  const current = t.room;
  const hasCredentials = (current?.roomId ?? null) !== null || (current?.roomPassword ?? null) !== null;
  if (!hasCredentials) {
    throw badRequest('VALIDATION_ERROR', 'There is no room on this tournament yet — add a Room ID first.');
  }
  if (!current) throw conflict('CONFLICT', 'This tournament has no room record to change.');

  const cleanReason = (reason ?? '').trim().slice(0, 200) || null;
  if (action === 'CANCEL' && !cleanReason) {
    throw badRequest('VALIDATION_ERROR', 'A cancellation reason is required — the players told about it and the audit row recording it both deserve to say why.');
  }

  const now = new Date();
  const plan: RoomActionPlan =
    action === 'HIDE'
      ? { data: { hiddenAt: now, status: 'SCHEDULED' }, guard: { hiddenAt: null }, auditAction: 'ROOM_HIDDEN', message: 'Room hidden — players can no longer see the credentials.', announce: false }
      : action === 'SHOW'
      ? { data: { hiddenAt: null, status: 'SCHEDULED', releasedAt: null }, guard: { hiddenAt: { not: null } }, auditAction: 'ROOM_VISIBLE', message: 'Room visible again.', announce: true }
      : action === 'CANCEL'
      ? { data: { cancelledAt: now, cancelReason: cleanReason, hiddenAt: null, status: 'CANCELLED' }, guard: { cancelledAt: null }, auditAction: 'ROOM_CANCELLED', message: 'Room cancelled — the credentials are no longer visible to players.', announce: true }
      : { data: { cancelledAt: null, cancelReason: null, hiddenAt: null, status: 'SCHEDULED', releasedAt: null }, guard: { cancelledAt: { not: null } }, auditAction: 'ROOM_REACTIVATED', message: 'Room re-activated — the original credentials are back on the release schedule.', announce: true };

  const globalMinutes = await globalRoomReleaseMinutes();
  const changed = await moneyTx(async (tx) => {
    const updated = await tx.tournamentRoom.updateMany({
      where: { tournamentId, ...plan.guard },
      data: plan.data,
    });
    // A no-op is reported as a no-op rather than faked as a fresh success: re-clicking
    // Cancel on an already cancelled room changes nothing, and `changed: false` is what
    // lets the panel say so instead of pretending a second cancellation was recorded.
    if (updated.count === 0) return false;
    await auditIn(tx, {
      actorId: adminId,
      action: plan.auditAction,
      entity: 'Tournament',
      entityId: tournamentId,
      // Room ID only, on every action — including the cancellation this exists to record.
      before: {
        status: current.status, roomId: current.roomId ?? null, hiddenAt: current.hiddenAt,
        cancelledAt: current.cancelledAt, reason: current.cancelReason,
      },
      after: {
        status: plan.data.status, roomId: current.roomId ?? null,
        hiddenAt: plan.data.hiddenAt === undefined ? current.hiddenAt : plan.data.hiddenAt,
        cancelledAt: plan.data.cancelledAt === undefined ? current.cancelledAt : plan.data.cancelledAt,
        reason: plan.data.cancelReason === undefined ? current.cancelReason : plan.data.cancelReason,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return true;
  });

  if (changed && plan.announce) {
    // Players were told the room vanished; they are exactly the people who need to hear it
    // is back. A cancellation gets its own alert, because "the room you were about to join
    // is off" is the one message that cannot wait for the next page load.
    const audience = await roomAudience(tournamentId);
    if (audience.length > 0) {
      const cancelledAlert = action === 'CANCEL';
      const title = cancelledAlert ? 'Room cancelled ⛔' : 'Room details unlocked 🔓';
      const body = cancelledAlert
        ? `${t.title}: the room has been cancelled.${cleanReason ? ` Reason: ${cleanReason}` : ''} Do not join the old Room ID.`
        : `${t.title}: the room is live again — open your tournament room card for the details.`;
      await prisma.notification.createMany({
        data: audience.map((userId) => ({
          userId,
          type: cancelledAlert ? ('TOURNAMENT_UPDATE' as const) : ('ROOM_CREDENTIALS' as const),
          title,
          body,
        })),
      });
      // Deliberately not awaited: a hung push service must never be able to fail an admin
      // action that has already committed.
      pushForNotification(audience, {
        type: cancelledAlert ? 'TOURNAMENT_UPDATE' : 'ROOM_CREDENTIALS',
        title,
        body,
        data: { area: 'matches' },
      });
    }
  }

  // Recompute the cached status from the timestamps: the write above knows the transition,
  // not which side of the release line the event now sits on.
  const after = await prisma.tournamentRoom.findUnique({ where: { tournamentId }, select: ROOM_ROW_SELECT });
  const state = resolveRoomState({ startTime: t.startTime, status: t.status, room: after }, globalMinutes);
  if (after && state.status !== after.status) {
    await prisma.tournamentRoom.update({ where: { tournamentId }, data: { status: state.status } });
  }

  return { changed, room: state, message: plan.message };
}

// ---------------------------------------------------------------------------
// PLAYER — the one response that may carry a credential
// ---------------------------------------------------------------------------

/**
 * Safe room metadata for player surfaces: state, label, countdown. No credential field
 * exists on this object at all, which is what makes "never expose the room before its
 * release time" a property of the TYPE rather than of an if-statement somewhere.
 */
export interface RoomPublicView {
  status: RoomStatus;
  label: string;
  releaseAt: Date | null;
  releaseInMs: number | null;
  releaseMinutes: number;
  hidden: boolean;
  cancelReason: string | null;
}

export function roomPublicView(state: RoomState): RoomPublicView {
  const hasCreds = state.hasRoomId || state.hasRoomPassword;
  return {
    status: state.status,
    label: state.label,
    releaseAt: hasCreds ? state.releaseAt : null,
    releaseInMs: hasCreds ? state.releaseInMs : null,
    releaseMinutes: state.releaseMinutes,
    hidden: state.hidden,
    cancelReason: state.status === 'CANCELLED' ? state.cancelReason : null,
  };
}

export interface PlayerRoomView extends RoomPublicView {
  /** Populated ONLY when `status === 'AVAILABLE'` and the caller holds a seat. */
  roomId: string | null;
  roomPassword: string | null;
  eligible: boolean;
  seatNumber: number | null;
}

/**
 * A player's own view of the event's room — the single credential-bearing endpoint.
 *
 * Order of the checks, and why:
 *   1. the event must exist and not be archived, so the endpoint cannot be used to probe
 *      soft-deleted ids (404, like every other surface);
 *   2. ELIGIBILITY BEFORE STATE — a player without a seat gets a flat 403 and no room
 *      metadata at all, so watching an event's admin activity is not a by-product of it;
 *   3. the release decision, from a freshly read row. `unlocked` is the only gate on the
 *      two values; there is no branch that ships them and lets the client decide.
 *
 * Reading the room is also what STAMPS the release exactly once — the lazy transition the
 * match flow already uses, so the notification and the scheduler can never disagree about
 * whether an event has been announced.
 */
export async function playerRoomView(userId: string, slug: string): Promise<PlayerRoomView> {
  const t = await prisma.tournament.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true, startTime: true, status: true,
      room: { select: ROOM_ROW_SELECT },
    },
  });
  if (!t) throw notFound('Tournament not found');

  if (!(await isRoomEligible(t.id, userId))) {
    throw forbidden('Room details are private to the players holding a confirmed seat in this tournament.');
  }

  const globalMinutes = await globalRoomReleaseMinutes();
  const state = resolveRoomState(t, globalMinutes);
  const seat = await prisma.tournamentRegistration.findFirst({
    where: { tournamentId: t.id, userId, status: 'CONFIRMED' },
    select: { seatNumber: true },
  });
  const seatNumber = seat?.seatNumber ?? null;

  if (!state.unlocked) {
    return { ...roomPublicView(state), roomId: null, roomPassword: null, eligible: true, seatNumber };
  }

  await claimRoomRelease(t.id);
  return {
    ...roomPublicView(state),
    roomId: t.room?.roomId ?? null,
    roomPassword: t.room?.roomPassword ?? null,
    eligible: true,
    seatNumber,
  };
}

/**
 * Claim the "these credentials have been released" mark for one event.
 *
 * `updateMany` guarded on `releasedAt: null` is the whole race: a player's page, a second
 * tab and the scheduler tick can all arrive in the same millisecond, and exactly one of
 * them announces. Releasing is not money, so this deliberately runs outside any
 * transaction — a lost claim costs a duplicate read, never a duplicate debit.
 */
export async function claimRoomRelease(tournamentId: string): Promise<boolean> {
  const claimed = await prisma.tournamentRoom.updateMany({
    where: { tournamentId, releasedAt: null },
    data: { releasedAt: new Date(), status: 'AVAILABLE' },
  });
  if (claimed.count === 0) return false;

  try {
    const audience = await roomAudience(tournamentId);
    if (audience.length === 0) return true;
    const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { title: true, slug: true, startTime: true } });
    if (!t) return true;
    const starts = t.startTime.toLocaleString('en-PK', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    const body = `${t.title}: the Room ID and password are live in your room card. Be in the lobby before it starts (${starts}).`;
    await prisma.notification.createMany({
      data: audience.map((userId) => ({ userId, type: 'ROOM_CREDENTIALS' as const, title: 'Room details unlocked 🔓', body })),
    });
    pushForNotification(audience, {
      type: 'ROOM_CREDENTIALS',
      title: 'Room details unlocked 🔓',
      body,
      data: { slug: t.slug, area: 'matches' },
    });
  } catch (e) {
    // A failed announcement must never cost a player their room: the values are already
    // released and readable, and the next scheduler tick retries the notification.
    console.warn('[room] release notification failed:', (e as Error)?.message);
  }
  return true;
}

// ---------------------------------------------------------------------------
// LISTS — room state for surfaces that show many events at once
// ---------------------------------------------------------------------------

/**
 * Room metadata for a set of events: the configured lead is read ONCE and the resolver is
 * applied per row, with the credential columns already replaced by presence flags.
 *
 * That substitution (`flagsToRoom`) is the actual leak defence for the list paths: a caller
 * that forgets to be careful gets `undefined` for a value, not a password, because the
 * value was never loaded. Used by the public tournament page and the player's registration
 * feed.
 */
export async function roomStates<T extends { id: string; startTime: Date; status?: string; room: { roomId: string | null } & Record<string, unknown> | null }>(
  rows: T[],
  now: Date | number = new Date(),
): Promise<Map<string, RoomPublicView>> {
  const out = new Map<string, RoomPublicView>();
  if (rows.length === 0) return out;
  const globalMinutes = await globalRoomReleaseMinutes();
  for (const row of rows) {
    out.set(row.id, roomStateFor(row, globalMinutes, now));
  }
  return out;
}

/** One row → one safe view. Shared by the list helper and any single-record read path. */
export function roomStateFor(
  row: { startTime: Date; status?: string; room: { roomId: string | null } & Record<string, unknown> | null },
  globalMinutes: number,
  now: Date | number = new Date(),
): RoomPublicView {
  return roomPublicView(resolveRoomState(
    { startTime: row.startTime, status: row.status, room: flagsToRoom(row.room) },
    globalMinutes,
    now,
  ));
}

/**
 * Scheduler sweep — open rooms even if nobody loads a page.
 *
 * This is NOT where correctness or security lives: every read decides the release for
 * itself, with or without a tick. What lives here is the player finding out without having
 * to ask (notification + push) and the admin table's cached status not trailing the clock.
 * The SQL filter is deliberately coarse and the resolver makes the call, so a derived
 * (NULL) release time is judged with exactly the same arithmetic as any read.
 */
export async function releaseTournamentRooms(): Promise<{ checked: number; released: number }> {
  const globalMinutes = await globalRoomReleaseMinutes();
  const now = new Date();
  const candidates = await prisma.tournamentRoom.findMany({
    where: {
      // `releasedAt: null` is the whole filter, deliberately. STATUS is a cache the admin
      // write keeps in step, so a room saved (or a password rotated) while its window had
      // ALREADY passed is correctly cached as AVAILABLE with nothing announced yet — and a
      // sweep filtering on the cache would skip precisely those rooms, leaving a new
      // password nobody told the players about. `releasedAt` is the one column that means
      // "not yet announced", which is all this pass is for.
      releasedAt: null,
      tournament: {
        deletedAt: null,
        status: { not: 'CANCELLED' },
        // Anything that could possibly be inside its window, given the widest lead we
        // allow. `hiddenAt` is NOT filtered out: a hidden room is deliberately silent, and
        // the resolver keeps it that way.
        startTime: { lte: new Date(now.getTime() + 1440 * 60_000) },
      },
      OR: [{ roomId: { not: null } }, { roomPassword: { not: null } }],
    },
    select: {
      tournamentId: true,
      tournament: { select: { startTime: true, status: true } },
      ...ROOM_ROW_SELECT,
    },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  });
  let released = 0;
  for (const row of candidates) {
    const state = resolveRoomState(
      { startTime: row.tournament.startTime, status: row.tournament.status, room: row },
      globalMinutes,
      now,
    );
    if (!state.unlocked) continue;
    if (await claimRoomRelease(row.tournamentId)) released += 1;
  }
  return { checked: candidates.length, released };
}

// ---------------------------------------------------------------------------
// Builder support — the create flow seeds a room inside its own transaction
// ---------------------------------------------------------------------------

/**
 * Validate a room coming from the tournament builder and turn it into the nested
 * `room: { create: … }` payload, BEFORE anything is inserted, with the same patterns as
 * the update path: one set of rules, two entry points, so the create form can never accept
 * a value the edit form would reject.
 *
 * Returns `null` when nothing was entered (no room row is created at all — "Room Not
 * Added" is then the absence of a record, which is the honest answer rather than a
 * placeholder row). A room entered for an event that starts inside its own release window
 * unlocks immediately, and the response says so rather than letting an admin assume two
 * values they just typed are private.
 */
export function roomCreateColumns(input: {
  roomId?: string | null;
  roomPassword?: string | null;
  releaseMinutesBeforeStart?: number | null;
  note?: string | null;
}) {
  const roomId = (input.roomId ?? '').trim();
  const roomPassword = (input.roomPassword ?? '').trim();
  if (roomId === '' && roomPassword === '') return null;
  if (roomId === '') throw badRequest('VALIDATION_ERROR', 'A room password on its own is not a room — add the Room ID too.');
  if (!ROOM_ID_RE.test(roomId)) throw badRequest('VALIDATION_ERROR', ERR_ID);
  if (roomPassword !== '' && !ROOM_PW_RE.test(roomPassword)) throw badRequest('VALIDATION_ERROR', ERR_PW);

  let releaseMinutes: number | null = null;
  if (input.releaseMinutesBeforeStart !== undefined && input.releaseMinutesBeforeStart !== null) {
    const n = Number(input.releaseMinutesBeforeStart);
    if (!Number.isInteger(n) || n < 0 || n > 1440) throw badRequest('VALIDATION_ERROR', ERR_LEAD);
    releaseMinutes = n;
  }
  const note = (input.note ?? '').trim().slice(0, 300) || null;
  return {
    roomId,
    roomPassword: roomPassword || null,
    releaseMinutes,
    note,
    // SCHEDULED, not AVAILABLE: the state is re-derived from the clock on every read, and
    // a freshly created event has not reached its release time. This column is a cache.
    status: 'SCHEDULED' as const,
  };
}
