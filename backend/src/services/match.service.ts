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
  /** Minutes before start when credentials unlock (default from settings). */
  releaseMinutesBeforeStart?: number;
}

/** Admin/moderator — create a match and sync participants from registrations. */
export async function createMatch(input: CreateMatchInput) {
  const tournament = await prisma.tournament.findUnique({ where: { id: input.tournamentId } });
  if (!tournament) throw notFound('Tournament not found');

  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw badRequest('VALIDATION_ERROR', 'Invalid schedule time');

  const defaultReleaseMin = await getSetting('tournament.roomCredentialsReleaseMinutesBeforeStart', 30);
  const releaseMin = input.releaseMinutesBeforeStart ?? defaultReleaseMin;

  const match = await prisma.match.create({
    data: {
      tournamentId: tournament.id,
      matchNumber: input.matchNumber,
      round: input.round ?? 1,
      map: input.map ?? tournament.map,
      scheduledAt,
      roomId: input.roomId ?? randomRoomId(),
      roomPassword: input.roomPassword ?? randomRoomPassword(),
      credentialsReleaseAt: new Date(scheduledAt.getTime() - releaseMin * 60_000),
    },
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
export async function myMatches(userId: string) {
  const regs = await prisma.tournamentRegistration.findMany({
    where: { userId, status: 'CONFIRMED' },
    include: {
      tournament: {
        select: {
          id: true, title: true, slug: true, type: true, map: true, status: true,
          startTime: true,
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
      team: { select: { name: true, tag: true } },
    },
    orderBy: { registeredAt: 'desc' },
  });

  const now = Date.now();
  const releasedMatchIds: string[] = [];

  const items = regs.map((reg) => ({
    tournament: {
      id: reg.tournament.id,
      title: reg.tournament.title,
      slug: reg.tournament.slug,
      type: reg.tournament.type,
      map: reg.tournament.map,
      status: reg.tournament.status,
      startTime: reg.tournament.startTime,
    },
    team: reg.team,
    matches: reg.tournament.matches.map((m) => {
      const releaseAt = m.credentialsReleaseAt ? new Date(m.credentialsReleaseAt).getTime() : null;
      const unlocked = releaseAt !== null && releaseAt <= now;
      if (unlocked && !m.credentialsReleasedAt) releasedMatchIds.push(m.id);
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
      };
    }),
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
