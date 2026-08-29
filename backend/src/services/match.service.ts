// =============================================================================
// Matches — scheduling, participant sync, and TIMED room-credential release.
//
// Security rule (spec §16/§37): room credentials are stored server-side and
// are only ever returned to REGISTERED players after credentialsReleaseAt.
// Public endpoints never include them. Release is evaluated on read (lazy)
// and marked CREDENTIALS_RELEASED exactly once.
// =============================================================================
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { getSetting } from './settings.service';
import { normalizePlacementTable } from '../lib/scoring';

function randomRoomId(): string {
  return String(crypto.randomInt(1_000_000, 9_999_999));
}
function randomRoomPassword(): string {
  return `CNX${crypto.randomInt(100, 999)}`;
}

export interface CreateMatchInput {
  tournamentId: string;
  matchNumber: number;
  round?: number;
  map?: string;
  scheduledAt: string; // ISO
  roomId?: string;
  roomPassword?: string;
  notes?: string;
  /** Minutes before start when credentials unlock (default from settings). */
  releaseMinutesBeforeStart?: number;
}

/** Admin/moderator — create a match and sync participants from registrations. */
export async function createMatch(input: CreateMatchInput, adminId?: string, ctx: { ip?: string; userAgent?: string } = {}) {
  const tournament = await prisma.tournament.findUnique({ where: { id: input.tournamentId } });
  if (!tournament) throw notFound('Tournament not found');

  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw badRequest('VALIDATION_ERROR', 'Invalid schedule time');

  const existing = await prisma.match.findUnique({
    where: { tournamentId_matchNumber: { tournamentId: input.tournamentId, matchNumber: input.matchNumber } },
  });
  if (existing) throw badRequest('VALIDATION_ERROR', `Match #${input.matchNumber} already exists for this tournament.`);

  const defaultReleaseMin = await getSetting('tournament.roomCredentialsReleaseMinutesBeforeStart', 30);
  const releaseMin = input.releaseMinutesBeforeStart ?? defaultReleaseMin;

  const match = await prisma.$transaction(async (tx) => {
    const row = await tx.match.create({
      data: {
        tournamentId: tournament.id,
        matchNumber: input.matchNumber,
        round: input.round ?? 1,
        map: input.map ?? tournament.map,
        scheduledAt,
        roomId: input.roomId ?? randomRoomId(),
        roomPassword: input.roomPassword ?? randomRoomPassword(),
        credentialsReleaseAt: new Date(scheduledAt.getTime() - releaseMin * 60_000),
        notes: input.notes ?? null,
      },
    });
    if (adminId) {
      await tx.auditLog.create({
        data: {
          actorId: adminId, action: 'MATCH_CREATED', entity: 'Match', entityId: row.id,
          after: {
            tournamentId: tournament.id, matchNumber: row.matchNumber, round: row.round,
            map: row.map, scheduledAt: row.scheduledAt,
            roomId: row.roomId, releaseMinutesBeforeStart: releaseMin,
          },
          ip: ctx.ip, userAgent: ctx.userAgent,
        },
      });
    }
    return row;
  });

  await syncParticipants(match.id);
  return match;
}

/** Ensure every confirmed registration has a participant row on the match. */
export async function syncParticipants(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { tournamentId: true },
  });
  if (!match) throw notFound('Match not found');

  const regs = await prisma.tournamentRegistration.findMany({
    where: { tournamentId: match.tournamentId, status: 'CONFIRMED' },
    select: { userId: true, teamId: true },
  });

  let added = 0;
  for (const reg of regs) {
    const exists = await prisma.matchParticipant.findFirst({
      where: {
        matchId,
        ...(reg.teamId ? { teamId: reg.teamId } : { userId: reg.userId }),
      },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.matchParticipant.create({
      data: { matchId, teamId: reg.teamId ?? undefined, userId: reg.teamId ? undefined : reg.userId },
    });
    added++;
  }
  return { added };
}

// ---------------------------------------------------------------------------
// MY MATCHES — the ONLY place room credentials are served.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ADMIN MATCH TABLE — full room-style roster for one match (spec §11, §38).
// ---------------------------------------------------------------------------
export interface MatchTableRow {
  participantId: string;
  slot: number | null;
  playerOrTeam: string;
  ign: string | null;
  uid: string | null;
  username: string | null;
  team: string | null;
  registrationId: string | null;
  registeredAt: Date | null;
  entryAmount: number | null;
  payment: string;
  ready: boolean;
  absent: boolean;
  status: string;
  placement: number | null;
  kills: number | null;
  bonus: number | null;
  penalty: number | null;
  points: number | null;
  finalScore: number | null;
  prize: number | null;
  slotLocked: boolean;
  notes: string | null;
  evidenceUrl: string | null;
  userId: string | null;
  teamId: string | null;
}

export async function matchTable(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true, matchNumber: true, round: true, map: true, scheduledAt: true,
      status: true, resultsStatus: true, resultsFinalized: true, notes: true,
      roomId: true, roomPassword: true, credentialsReleaseAt: true,
      tournament: {
        select: {
          id: true, title: true, slug: true, type: true, maxSlots: true,
          pointsPerKill: true, placementPoints: true,
        },
      },
    },
  });
  if (!match) throw notFound('Match not found');

  const participants = await prisma.matchParticipant.findMany({
    where: { matchId },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, username: true, profile: { select: { freeFireUID: true, freeFireIGN: true } } } },
      team: { select: { id: true, name: true, tag: true, type: true } },
    },
  });

  const t = match.tournament;

  // Resolve registrations in ONE query so admin sees reg id, seat, payment.
  const regs = await prisma.tournamentRegistration.findMany({
    where: {
      tournamentId: t.id,
      status: { in: ['CONFIRMED', 'REFUNDED', 'DISQUALIFIED', 'CANCELLED'] },
    },
    select: { id: true, userId: true, teamId: true, seatNumber: true, status: true, entryAmount: true, registeredAt: true, slotLocked: true },
  });
  const regByUserId = new Map<string, (typeof regs)[number]>();
  const regByTeamId = new Map<string, (typeof regs)[number]>();
  for (const r of regs) {
    if (r.teamId && !regByTeamId.has(r.teamId)) regByTeamId.set(r.teamId, r);
    if (!regByUserId.has(r.userId)) regByUserId.set(r.userId, r);
  }

  const rows: MatchTableRow[] = participants.map((p) => {
    const reg = p.teamId ? regByTeamId.get(p.teamId) : p.userId ? regByUserId.get(p.userId) : undefined;
    const isTeamRow = p.teamId !== null;
    return {
      participantId: p.id,
      slot: reg?.seatNumber ?? null,
      playerOrTeam: p.team ? `${p.team.name} [${p.team.tag}]` : (p.user?.profile?.freeFireIGN ?? p.user?.username ?? 'Unknown'),
      ign: p.user?.profile?.freeFireIGN ?? null,
      uid: isTeamRow ? null : (p.user?.profile?.freeFireUID ?? null),
      username: p.user?.username ?? null,
      team: p.team ? p.team.tag : null,
      registrationId: reg?.id ?? null,
      registeredAt: reg?.registeredAt ?? null,
      entryAmount: reg ? num(reg.entryAmount) : null,
      payment: reg && reg.status === 'CONFIRMED' ? 'PAID' : reg ? reg.status : '—',
      ready: p.readyAt !== null,
      absent: p.absent,
      status: p.status,
      placement: p.placement,
      kills: p.kills,
      bonus: p.bonus,
      penalty: p.penalty,
      points: p.points,
      finalScore: p.finalScore,
      prize: p.prizeAmount !== null ? num(p.prizeAmount) : null,
      slotLocked: reg?.slotLocked ?? false,
      notes: p.notes,
      evidenceUrl: p.evidenceUrl,
      userId: p.userId,
      teamId: p.teamId,
    };
  });

  // Seat-aware sort: empty slot fill from registrations that have no participant
  // row (e.g. joined after the match was scheduled) is handled by sync; here we
  // sort filled slots first so the table reads like the room board.
  rows.sort((a, b) => (a.slot ?? 99999) - (b.slot ?? 99999));

  const totalSeats = t.maxSlots;
  return {
    match: {
      id: match.id,
      matchNumber: match.matchNumber,
      round: match.round,
      map: match.map,
      scheduledAt: match.scheduledAt,
      status: match.status,
      resultsStatus: match.resultsStatus,
      resultsFinalized: match.resultsFinalized,
      notes: match.notes,
      roomId: match.roomId,
      roomPassword: match.roomPassword,
      credentialsReleaseAt: match.credentialsReleaseAt,
      tournament: { id: t.id, title: t.title, slug: t.slug, type: t.type, maxSlots: t.maxSlots },
    },
    scoring: { pointsPerKill: t.pointsPerKill, placementTable: normalizePlacementTable(t.placementPoints) },
    rows,
    totalSeats,
    filled: rows.length,
  };
}

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;

/** Admin — update match operational fields (notes, room, schedule, status). */
export async function updateMatch(
  adminId: string,
  matchId: string,
  input: { notes?: string | null; roomId?: string | null; roomPassword?: string | null; scheduledAt?: string | null; map?: string | null },
  ctx: { ip?: string; userAgent?: string },
) {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) throw notFound('Match not found');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.match.update({
      where: { id: matchId },
      data: {
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.roomId !== undefined ? { roomId: input.roomId || null } : {}),
        ...(input.roomPassword !== undefined ? { roomPassword: input.roomPassword || null } : {}),
        ...(input.map !== undefined ? { map: input.map } : {}),
        ...(input.scheduledAt !== undefined && input.scheduledAt !== null ? { scheduledAt: new Date(input.scheduledAt) } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'MATCH_UPDATED', entity: 'Match', entityId: matchId,
        before: {
          notes: match.notes, roomId: match.roomId, map: match.map,
          scheduledAt: match.scheduledAt, status: match.status,
        },
        after: {
          notes: row.notes, roomId: row.roomId, map: row.map,
          scheduledAt: row.scheduledAt, status: row.status,
        },
        ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return row;
  });
  return updated;
}

export async function myMatches(userId: string) {
  const regs = await prisma.tournamentRegistration.findMany({
    where: { userId, status: 'CONFIRMED' },
    include: {
      tournament: {
        select: {
          id: true, title: true, slug: true, type: true, map: true, status: true,
          startTime: true, entryFeePerPlayer: true, prizePool: true,
          matches: {
            orderBy: { matchNumber: 'asc' },
            select: {
              id: true, matchNumber: true, round: true, map: true, scheduledAt: true,
              status: true, roomId: true, roomPassword: true,
              credentialsReleaseAt: true, credentialsReleasedAt: true,
            },
          },
        },
      },
      team: { select: { id: true, name: true, tag: true } },
    },
    orderBy: { registeredAt: 'desc' },
  });

  const now = Date.now();
  const releasedMatchIds: string[] = [];

  // Per-tournament extras: my slot number, my result rows, my credited earnings.
  const items = await Promise.all(regs.map(async (reg) => {
    const tournament = reg.tournament;
    const teamId = reg.team?.id ?? null;
    const matchIds = tournament.matches.map((m) => m.id);

    const [slotFallback, participants, submissions, earningsAgg] = await Promise.all([
      // Legacy rows predating seatNumber: fall back to registration order.
      reg.seatNumber === null
        ? prisma.tournamentRegistration.count({
            where: { tournamentId: tournament.id, status: 'CONFIRMED', registeredAt: { lte: reg.registeredAt } },
          })
        : Promise.resolve(0),
      prisma.matchParticipant.findMany({
        where: { matchId: { in: matchIds }, ...(teamId ? { teamId } : { userId }) },
        select: { matchId: true, placement: true, kills: true, points: true, status: true },
      }),
      prisma.resultSubmission.findMany({
        where: { matchId: { in: matchIds }, submittedById: userId },
        orderBy: { createdAt: 'desc' },
        select: { matchId: true, status: true, placement: true, kills: true, notes: true, createdAt: true },
      }),
      prisma.winner.aggregate({
        where: { tournamentId: tournament.id, status: 'CREDITED', ...(teamId ? { teamId } : { userId }) },
        _sum: { amount: true },
      }),
    ]);

    // Seat number assigned atomically at join time (authoritative).
    const slotNumber = reg.seatNumber ?? slotFallback;

    const byMatch = (id: string) => participants.find((p) => p.matchId === id) ?? null;
    const subFor = (id: string) => submissions.find((s) => s.matchId === id) ?? null;

    return {
      tournament: {
        id: tournament.id,
        title: tournament.title,
        slug: tournament.slug,
        type: tournament.type,
        map: tournament.map,
        status: tournament.status,
        startTime: tournament.startTime,
        entryFeePerPlayer: Number(tournament.entryFeePerPlayer),
        prizePool: Number(tournament.prizePool),
      },
      team: reg.team ? { name: reg.team.name, tag: reg.team.tag } : null,
      slotNumber,
      myEarnings: Number(earningsAgg._sum.amount ?? 0),
      matches: tournament.matches.map((m) => {
        const releaseAt = m.credentialsReleaseAt ? new Date(m.credentialsReleaseAt).getTime() : null;
        const unlocked = releaseAt !== null && releaseAt <= now;
        if (unlocked && !m.credentialsReleasedAt) releasedMatchIds.push(m.id);
        const p = byMatch(m.id);
        const sub = subFor(m.id);
        return {
          id: m.id,
          matchNumber: m.matchNumber,
          round: m.round,
          map: m.map,
          scheduledAt: m.scheduledAt,
          status: unlocked && m.status === 'SCHEDULED' ? 'CREDENTIALS_RELEASED' : m.status,
          // Credentials: included ONLY when unlocked. Never otherwise.
          roomId: unlocked ? m.roomId : null,
          roomPassword: unlocked ? m.roomPassword : null,
          credentialsReleaseAt: m.credentialsReleaseAt,
          releaseInMs: releaseAt !== null ? releaseAt - now : null,
          unlocked,
          // Phase 8 — my result + submission state for completed matches.
          result: p ? { placement: p.placement, kills: p.kills, points: p.points, status: p.status } : null,
          mySubmission: sub ? { status: sub.status, placement: sub.placement, kills: sub.kills, note: sub.notes } : null,
        };
      }),
    };
  }));

  // Mark releases exactly once (lazy state transition)
  if (releasedMatchIds.length > 0) {
    await prisma.match.updateMany({
      where: { id: { in: releasedMatchIds }, status: 'SCHEDULED' },
      data: { status: 'CREDENTIALS_RELEASED', credentialsReleasedAt: new Date() },
    });
    // Notify registered players whose credentials just unlocked
    const notified = await prisma.matchParticipant.findMany({
      where: { matchId: { in: releasedMatchIds } },
      select: { matchId: true, userId: true, team: { include: { members: { select: { userId: true } } } } },
    });
    const targets = new Map<string, Set<string>>(); // matchId -> userIds
    for (const p of notified) {
      const set = targets.get(p.matchId) ?? new Set<string>();
      if (p.userId) set.add(p.userId);
      for (const m of p.team?.members ?? []) set.add(m.userId);
      targets.set(p.matchId, set);
    }
    for (const [matchId, users] of targets) {
      for (const uid of users) {
        await prisma.notification.create({
          data: {
            userId: uid, type: 'ROOM_CREDENTIALS',
            title: 'Room details unlocked 🔓',
            body: 'Your room ID and password are ready in My Matches.',
            data: { matchId },
          },
        });
      }
    }
  }

  return items;
}
