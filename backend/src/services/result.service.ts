// =============================================================================
// Phase 8 — Results & prize distribution.
//
// Admin-driven results workflow (added this session):
//   Admin enters results per participant (position, kills, bonus, penalty,
//   prize, ready/absent/DQ, notes, evidence) → Save Draft → Confirm Results →
//   Calculate standings → Publish Results → Winners become public.
//
// Player self-verification path is preserved: players submit screenshots for
// completed matches → staff verify → points use the PER-TOURNAMENT placement
// table → winner ranking → IDEMPOTENT prize distribution crediting WINNING
// balances through the immutable ledger.
//
// Scoring is NEVER hard-coded: Final Score = placement table (Tournament
// .placementPoints or platform default) + kills × pointsPerKill + bonus − penalty.
// Every published step is audited; the database is the source of truth and the
// (tournamentId, position) unique constraint on Winner is the double-distribution
// defense. Financial records are never silently changed by leaderboard edits.
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { getSetting } from './settings.service';
import { moveBalance, TX_OPTS } from './wallet.service';
import { fireIdenticalResultClaims } from './fraud.service';
import {
  DEFAULT_PLACEMENT_POINTS, finalScoreFor, normalizePlacementTable,
  placementPointsFor, pointsFor as pointsForScoring, rankByScore,
} from '../lib/scoring';

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;

/** Compatibility export (legacy verification path + unit tests). */
export const PLACEMENT_POINTS = DEFAULT_PLACEMENT_POINTS;

const KILL_POOL_BASE_POSITION = 100; // Winner.position namespace for kill pools
const MVP_POSITION = 200;

/** Placement table for a tournament row (per-tournament, default fallback). */
export function tableFor(tournament: { placementPoints?: unknown }): number[] {
  return normalizePlacementTable(tournament.placementPoints);
}

/** Legacy signature kept for the verification-review path (uses tournament table). */
export function pointsFor(placement: number, kills: number, perKill: number, table?: number[]): number {
  return pointsForScoring(placement, kills, perKill, table);
}

interface Ctx { ip?: string; userAgent?: string }

// ---------------------------------------------------------------------------
// Player submission
// ---------------------------------------------------------------------------

export async function submitResult(
  userId: string,
  matchId: string,
  input: { kills: number; placement: number; notes?: string },
  screenshotPath: string | null,
  ctx: Ctx,
) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, status: true, tournamentId: true },
  });
  if (!match) throw notFound('Match not found');
  if (match.status !== 'COMPLETED') {
    throw badRequest('VALIDATION_ERROR', 'Results can be submitted once the match is completed.');
  }

  // The submitter must have played: a solo participant or a member of a team participant.
  const memberships = await prisma.teamMember.findMany({ where: { userId }, select: { teamId: true } });
  const teamIds = memberships.map((m) => m.teamId);
  const participant = await prisma.matchParticipant.findFirst({
    where: {
      matchId,
      status: { not: 'DISQUALIFIED' },
      OR: [{ userId }, { teamId: { in: teamIds } }],
    },
    select: { id: true, status: true },
  });
  if (!participant) throw forbidden('Only participants of this match can submit results.');

  const existing = await prisma.resultSubmission.findFirst({
    where: { matchId, submittedById: userId, status: { in: ['PENDING', 'UNDER_REVIEW', 'VERIFIED'] } },
    select: { id: true, status: true },
  });
  if (existing) {
    throw conflict('CONFLICT', `You already have a ${existing.status.replace('_', ' ').toLowerCase()} result for this match.`);
  }

  const submission = await prisma.resultSubmission.create({
    data: {
      matchId,
      submittedById: userId,
      kills: input.kills,
      placement: input.placement,
      notes: input.notes || null,
      screenshot: screenshotPath ?? `/uploads/results/submitted-${Date.now()}.png`,
      status: 'PENDING',
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: userId, action: 'RESULT_SUBMITTED', entity: 'ResultSubmission', entityId: submission.id,
      after: { matchId, placement: input.placement, kills: input.kills }, ip: ctx.ip, userAgent: ctx.userAgent,
    },
  });

  // Phase 14 — two players filing the same claim for one match is worth a look.
  fireIdenticalResultClaims(matchId, submission.id);

  return submission;
}

// ---------------------------------------------------------------------------
// Staff verification
// ---------------------------------------------------------------------------

type ReviewAction = 'APPROVE' | 'REJECT' | 'DISQUALIFY';

/** Stats delta helper — creates or increments the PlayerStat row. */
async function bumpStats(
  tx: Prisma.TransactionClient,
  userId: string,
  d: { matches?: number; kills?: number; points?: number; wins?: number; earnings?: number },
  lastPlayedAt?: Date,
) {
  const existing = await tx.playerStat.findUnique({ where: { userId } });
  if (!existing) {
    await tx.playerStat.create({
      data: {
        userId,
        matchesPlayed: d.matches ?? 0,
        kills: d.kills ?? 0,
        totalPoints: d.points ?? 0,
        wins: d.wins ?? 0,
        earnings: new Prisma.Decimal(d.earnings ?? 0),
        lastPlayedAt,
      },
    });
    return;
  }
  await tx.playerStat.update({
    where: { userId },
    data: {
      matchesPlayed: { increment: d.matches ?? 0 },
      kills: { increment: d.kills ?? 0 },
      totalPoints: { increment: d.points ?? 0 },
      wins: { increment: d.wins ?? 0 },
      ...(d.earnings ? { earnings: { increment: new Prisma.Decimal(d.earnings) } } : {}),
      ...(lastPlayedAt ? { lastPlayedAt } : {}),
    },
  });
}

export async function reviewResult(
  adminId: string,
  submissionId: string,
  action: ReviewAction,
  opts: { note?: string; placement?: number; kills?: number } = {},
  ctx: Ctx = {},
) {
  const out = await prisma.$transaction(async (tx) => {
    const sub = await tx.resultSubmission.findUnique({ where: { id: submissionId } });
    if (!sub) throw notFound('Result submission not found');
    if (sub.status === 'VERIFIED' || sub.status === 'REJECTED') {
      throw conflict('CONFLICT', `This submission was already ${sub.status.toLowerCase()}.`);
    }

    const match = await tx.match.findUnique({
      where: { id: sub.matchId },
      select: { id: true, tournamentId: true, tournament: { select: { pointsPerKill: true, placementPoints: true, title: true } } },
    });
    if (!match) throw notFound('Match not found');

    // The submitter's participant row (solo or via one of their teams).
    const memberships = await tx.teamMember.findMany({
      where: { userId: sub.submittedById }, select: { teamId: true },
    });
    const participant = await tx.matchParticipant.findFirst({
      where: {
        matchId: sub.matchId,
        OR: [{ userId: sub.submittedById }, { teamId: { in: memberships.map((m) => m.teamId) } }],
      },
    });
    if (!participant) throw notFound('Participant record missing for this submission.');

    const now = new Date();

    if (action === 'REJECT' || action === 'DISQUALIFY') {
      // Revert stats if a previous approval had applied them (correction path).
      if (participant.status === 'PLAYED' && participant.placement !== null) {
        const perKill = match.tournament.pointsPerKill;
        const table = tableFor(match.tournament);
        const oldPoints = pointsFor(participant.placement, participant.kills ?? 0, perKill, table);
        const soloUserId = participant.userId ?? null;
        if (soloUserId) {
          await bumpStats(tx, soloUserId, {
            matches: -1, kills: -(participant.kills ?? 0), points: -oldPoints,
            wins: participant.placement === 1 ? -1 : 0,
          });
        }
      }
      await tx.matchParticipant.update({
        where: { id: participant.id },
        data: action === 'DISQUALIFY'
          ? { status: 'DISQUALIFIED', placement: null, kills: null, points: null }
          : { status: 'REGISTERED', placement: null, kills: null, points: null },
      });
      const updated = await tx.resultSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'REJECTED',
          notes: opts.note ?? (action === 'DISQUALIFY' ? 'Result rejected — player disqualified.' : 'Result could not be verified.'),
          verifiedById: adminId,
          verifiedAt: now,
        },
      });
      await tx.notification.create({
        data: {
          userId: sub.submittedById,
          type: action === 'DISQUALIFY' ? 'ACCOUNT' : 'RESULT_VERIFIED',
          title: action === 'DISQUALIFY' ? 'Result rejected — disqualified' : 'Result submission rejected',
          body: action === 'DISQUALIFY'
            ? `Your result for ${match.tournament.title} was rejected and you were disqualified from the match.${opts.note ? ` Reason: ${opts.note}` : ''}`
            : `Your result for ${match.tournament.title} could not be verified.${opts.note ? ` Reason: ${opts.note}` : ''} You can submit a corrected screenshot.`,
          data: { matchId: sub.matchId, tournamentId: match.tournamentId },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId, action: `RESULT_${action}`, entity: 'ResultSubmission', entityId: submissionId,
          before: { status: sub.status }, after: { status: 'REJECTED', note: opts.note ?? null },
          ip: ctx.ip, userAgent: ctx.userAgent,
        },
      });
      return updated;
    }

    // APPROVE — placement/kills: admin override wins over the player's claim.
    const placement = Math.max(1, opts.placement ?? sub.placement ?? 1);
    const kills = Math.max(0, opts.kills ?? sub.kills ?? 0);
    const perKill = match.tournament.pointsPerKill;
    const table = tableFor(match.tournament);
    const points = pointsFor(placement, kills, perKill, table);

    // Compensate stats if this participant was already PLAYED (correction).
    if (participant.status === 'PLAYED' && participant.placement !== null) {
      const oldPoints = pointsFor(participant.placement, participant.kills ?? 0, perKill, table);
      if (participant.userId) {
        await bumpStats(tx, participant.userId, {
          kills: kills - (participant.kills ?? 0),
          points: points - oldPoints,
          wins: (placement === 1 ? 1 : 0) - (participant.placement === 1 ? 1 : 0),
        });
      }
      // Solo participants carry userId; team-mode stat rows are updated per member below.
    }
    if (participant.status !== 'PLAYED') {
      // First verification for this participant.
      if (participant.userId) {
        await bumpStats(tx, participant.userId, {
          matches: 1, kills, points, wins: placement === 1 ? 1 : 0,
        }, now);
      } else if (participant.teamId) {
        const members = await tx.teamMember.findMany({ where: { teamId: participant.teamId }, select: { userId: true } });
        for (const m of members) {
          await bumpStats(tx, m.userId, { matches: 1, kills: Math.round(kills / members.length), points, wins: placement === 1 ? 1 : 0 }, now);
        }
      }
    }

    await tx.matchParticipant.update({
      where: { id: participant.id },
      data: { status: 'PLAYED', placement, kills, points, finalScore: points },
    });
    const updated = await tx.resultSubmission.update({
      where: { id: submissionId },
      data: { status: 'VERIFIED', placement, kills, verifiedById: adminId, verifiedAt: now },
    });
    await tx.notification.create({
      data: {
        userId: sub.submittedById, type: 'RESULT_VERIFIED',
        title: 'Result verified ✅',
        body: `Your result for ${match.tournament.title} is verified: #${placement} with ${kills} kills (${points} points).`,
        data: { matchId: sub.matchId, tournamentId: match.tournamentId },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'RESULT_VERIFIED', entity: 'ResultSubmission', entityId: submissionId,
        before: { status: sub.status }, after: { status: 'VERIFIED', placement, kills, points },
        ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return updated;
  }, TX_OPTS);

  return {
    id: out.id,
    status: out.status,
    placement: out.placement,
    kills: out.kills,
  };
}

// ---------------------------------------------------------------------------
// Standings + winner determination
// ---------------------------------------------------------------------------

interface Ranked {
  key: string; // userId or teamId
  userId: string | null;
  teamId: string | null;
  label: string;
  points: number;
  kills: number;
}

export async function tournamentStandings(tournamentId: string) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, type: true, title: true, status: true, numWinners: true },
  });
  if (!tournament) throw notFound('Tournament not found');

  const participants = await prisma.matchParticipant.findMany({
    where: { match: { tournamentId }, status: 'PLAYED' },
    select: {
      placement: true, kills: true, points: true, userId: true, teamId: true,
      user: { select: { username: true, profile: { select: { freeFireIGN: true } } } },
      team: { select: { name: true, tag: true } },
    },
  });

  const agg = new Map<string, Ranked>();
  for (const p of participants) {
    const key = p.teamId ?? p.userId ?? '';
    if (!key) continue;
    const cur = agg.get(key) ?? {
      key,
      userId: p.userId,
      teamId: p.teamId,
      label: p.team ? `${p.team.name} [${p.team.tag}]` : p.user?.profile?.freeFireIGN ?? p.user?.username ?? 'Unknown',
      points: 0,
      kills: 0,
    };
    cur.points += p.points ?? 0;
    cur.kills += p.kills ?? 0;
    agg.set(key, cur);
  }
  const standings = [...agg.values()].sort(
    (a, b) => b.points - a.points || b.kills - a.kills || a.key.localeCompare(b.key),
  );
  return { tournament, standings };
}

// ---------------------------------------------------------------------------
// Prize distribution — placement + capped kill pool + MVP (idempotent)
// ---------------------------------------------------------------------------

export async function distributePrizes(adminId: string, tournamentId: string, ctx: Ctx = {}) {
  const currency = await getSetting('platform.currency', 'PKR');
  const { tournament, standings } = await tournamentStandings(tournamentId);
  if (!standings.length) throw badRequest('VALIDATION_ERROR', 'No verified results to rank — verify result submissions first.');

  const prizes = await prisma.prize.findMany({
    where: { tournamentId },
    orderBy: { position: 'asc' },
  });
  if (!prizes.length) throw badRequest('VALIDATION_ERROR', 'This tournament has no prize configuration.');

  const existingWinners = await prisma.winner.findMany({ where: { tournamentId } });
  const credited = existingWinners.filter((w) => w.status === 'CREDITED').length;
  if (existingWinners.length > 0 && credited === existingWinners.length) {
    throw conflict('CONFLICT', 'Prizes were already distributed for this tournament — distribution is idempotent and cannot run twice.');
  }

  const teamSizeOf = (type: string) => (type === 'SOLO' ? 1 : type === 'DUO' ? 2 : 4);
  const isTeamMode = tournament.type !== 'SOLO';

  interface Award { position: number; kind: string; label: string; amount: number; userId: string | null; teamId: string | null }
  const awards: Award[] = [];

  // 1. Placement prizes → ranked recipients.
  const placementPrizes = prizes
    .filter((p) => (p.kind ?? 'PLACEMENT') === 'PLACEMENT')
    .sort((a, b) => a.position - b.position);
  placementPrizes.forEach((prize, idx) => {
    const recipient = standings[idx];
    if (!recipient) return; // fewer players than prizes — prize not awarded
    awards.push({
      position: prize.position,
      kind: 'PLACEMENT',
      label: prize.label ?? `${prize.position}${prize.position === 1 ? 'st' : prize.position === 2 ? 'nd' : prize.position === 3 ? 'rd' : 'th'} Place`,
      amount: num(prize.amount),
      userId: recipient.userId,
      teamId: recipient.teamId,
    });
  });

  // 2. Kill pool — perKill × kills, capped pro-rata at the budget cap.
  for (const prize of prizes.filter((p) => p.kind === 'KILL_POOL')) {
    const perKill = num(prize.perKill);
    const cap = prize.cap !== null ? num(prize.cap) : num(prize.amount);
    if (!(perKill > 0) || !(cap > 0)) continue;
    const raw = standings.map((s) => ({ s, amount: Math.round(perKill * s.kills * 100) / 100 })).filter((r) => r.amount > 0);
    const rawSum = Math.round(raw.reduce((t, r) => t + r.amount, 0) * 100) / 100;
    const scale = rawSum > cap ? cap / rawSum : 1;
    let budgetLeft = cap;
    raw.forEach((r, i) => {
      let amount = Math.floor(r.amount * scale * 100) / 100;
      if (i === raw.length - 1) amount = Math.min(amount, budgetLeft); // last absorbs rounding
      budgetLeft = Math.round((budgetLeft - amount) * 100) / 100;
      if (amount <= 0) return;
      awards.push({
        position: KILL_POOL_BASE_POSITION + i,
        kind: 'KILL_POOL',
        label: `Kill Pool — ${r.s.label}`,
        amount,
        userId: r.s.userId,
        teamId: r.s.teamId,
      });
    });
  }

  // 3. MVP — top-ranked player.
  for (const prize of prizes.filter((p) => p.kind === 'MVP')) {
    const top = standings[0];
    if (!top) continue;
    awards.push({
      position: MVP_POSITION,
      kind: 'MVP',
      label: prize.label ?? 'MVP',
      amount: num(prize.amount),
      userId: top.userId,
      teamId: top.teamId,
    });
  }

  if (!awards.length) throw badRequest('VALIDATION_ERROR', 'No awards could be generated from the standings.');

  // Resolve recipients to ledger targets (team awards split across members).
  const teamIds = [...new Set(awards.map((a) => a.teamId).filter((t): t is string => t !== null))];
  const teams = teamIds.length
    ? await prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, members: { select: { userId: true } } } })
    : [];
  const membersOf = new Map(teams.map((t) => [t.id, t.members.map((m) => m.userId)]));

  const summary = await prisma.$transaction(async (tx) => {
    const results: Array<{ position: number; label: string; amount: number; credited: Array<{ userId: string; share: number }> }> = [];
    for (const award of awards) {
      // (tournamentId, position) unique — the double-distribution anchor.
      const exists = await tx.winner.findUnique({
        where: { tournamentId_position: { tournamentId, position: award.position } },
      });
      if (exists) continue; // already created → skip (idempotent completion path)

      const winner = await tx.winner.create({
        data: {
          tournamentId,
          position: award.position,
          userId: award.userId,
          teamId: award.teamId,
          amount: new Prisma.Decimal(award.amount),
          status: 'PENDING',
        },
      });

      const memberIds = award.teamId ? (membersOf.get(award.teamId) ?? []) : award.userId ? [award.userId] : [];
      if (!memberIds.length) throw badRequest('VALIDATION_ERROR', `No recipient members for award "${award.label}".`);
      const share = Math.floor((award.amount / memberIds.length) * 100) / 100;
      let firstTxId: string | undefined;
      const credited: Array<{ userId: string; share: number }> = [];
      for (const uid of memberIds) {
        const entry = await moveBalance(tx, uid, 'WINNING', 'CREDIT', share, 'WINNING', {
          entityType: 'Winner',
          entityId: winner.id,
          reference: `PRZ${Date.now()}-${award.position}`,
          description: `Prize — ${award.label} · ${tournament.title}${isTeamMode ? ` (1/${memberIds.length} of ${currency} ${award.amount})` : ''}`,
        }, currency);
        firstTxId ??= entry.id;
        await bumpStats(tx, uid, { earnings: share });
        await tx.notification.create({
          data: {
            userId: uid, type: 'WINNING_CREDITED',
            title: 'Prize credited 🏆',
            body: `${currency} ${share} from "${award.label}" in ${tournament.title} has been added to your Winning balance.`,
            data: { tournamentId, winnerId: winner.id },
          },
        });
        credited.push({ userId: uid, share });
      }
      await tx.winner.update({
        where: { id: winner.id },
        data: { status: 'CREDITED', walletTxId: firstTxId, creditedAt: new Date() },
      });
      results.push({ position: award.position, label: award.label, amount: award.amount, credited });
    }

    if (!results.length) {
      throw conflict('CONFLICT', 'Prizes were already distributed for this tournament.');
    }

    await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'COMPLETED' } });
    await tx.match.updateMany({ where: { tournamentId, resultsFinalized: false }, data: { resultsFinalized: true } });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'PRIZES_DISTRIBUTED', entity: 'Tournament', entityId: tournamentId,
        after: {
          awards: results.map((r) => ({ position: r.position, label: r.label, amount: r.amount })),
          totalPaid: Math.round(results.reduce((t, r) => t + r.amount, 0) * 100) / 100,
        },
        ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return results;
  }, TX_OPTS);

  return {
    tournament: { id: tournament.id, title: tournament.title },
    awards: summary,
    teamSize: teamSizeOf(tournament.type),
    totalPaid: Math.round(summary.reduce((t, r) => t + r.amount, 0) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Admin listing of pending submissions
// ---------------------------------------------------------------------------

export async function listSubmissions(filter: { status?: string; page: number; pageSize: number }) {
  const where: Prisma.ResultSubmissionWhereInput = filter.status
    ? { status: filter.status as Prisma.EnumResultStatusFilter['equals'] }
    : {};
  const [rows, total] = await Promise.all([
    prisma.resultSubmission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
      include: {
        submittedBy: { select: { username: true, profile: { select: { freeFireIGN: true } } } },
        match: {
          select: {
            id: true, matchNumber: true, round: true, scheduledAt: true,
            tournament: { select: { id: true, title: true, slug: true, type: true } },
          },
        },
      },
    }),
    prisma.resultSubmission.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      status: r.status,
      placement: r.placement,
      kills: r.kills,
      notes: r.notes,
      screenshot: r.screenshot ? `/api/matches/results/${r.id}/screenshot` : null,
      submittedBy: {
        username: r.submittedBy.username,
        ign: r.submittedBy.profile?.freeFireIGN,
      },
      match: {
        id: r.match.id,
        matchNumber: r.match.matchNumber,
        round: r.match.round,
        scheduledAt: r.match.scheduledAt,
        tournament: r.match.tournament,
      },
      createdAt: r.createdAt,
    })),
    page: filter.page,
    pageSize: filter.pageSize,
    total,
  };
}

/** Screenshot access — submitter or staff. */
export async function resultScreenshotPath(userId: string, role: string, submissionId: string) {
  const sub = await prisma.resultSubmission.findUnique({ where: { id: submissionId } });
  if (!sub?.screenshot) throw notFound('Screenshot not found');
  const staff = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(role);
  if (sub.submittedById !== userId && !staff) throw forbidden('You can only view your own result screenshots.');
  return sub.screenshot.replace(/^\/uploads\//, '');
}

// =============================================================================
// ADMIN RESULT ENTRY + CONTROLLED PUBLISH FLOW (spec §14, §26, §39)
//
//   Match.resultsStatus:
//     DRAFT          → admin saves participant rows freely
//     UNDER_REVIEW   → rows locked for review
//     CONFIRMED      → standings frozen, prizes ready to calculate
//     PUBLISHED      → public results + winners reveal (no more edits)
//
// Public endpoints only expose results when PUBLISHED (see public.service).
// =============================================================================

export interface AdminResultRowInput {
  participantId: string;
  position?: number | null;
  kills?: number | null;
  bonus?: number | null;
  penalty?: number | null;
  prize?: number | null;
  notes?: string | null;
  status?: 'REGISTERED' | 'PLAYED' | 'DISQUALIFIED';
  absent?: boolean;
  ready?: boolean;
  evidenceUrl?: string | null;
}

interface ResultRow {
  id: string;
  placement: number | null;
  kills: number | null;
  bonus: number | null;
  penalty: number | null;
  points: number | null;
  finalScore: number | null;
  prizeAmount: Prisma.Decimal | null;
  notes: string | null;
  absent: boolean;
  readyAt: Date | null;
  evidenceUrl: string | null;
  status: string;
  userId: string | null;
  teamId: string | null;
}

/** Recompute finalScore for a participant using the tournament formula. */
function scoreFor(
  row: { placement: number | null; kills: number | null; bonus: number | null; penalty: number | null },
  perKill: number,
  table: number[],
): number | null {
  if (row.placement === null || row.placement === undefined) return null;
  return finalScoreFor({
    placement: row.placement,
    kills: row.kills ?? 0,
    pointsPerKill: perKill,
    table,
    bonus: row.bonus ?? 0,
    penalty: row.penalty ?? 0,
  });
}

/** Staff — save one participant's result row (DRAFT/UNDER_REVIEW only; confirmed rows are frozen). */
export async function saveAdminResult(
  adminId: string,
  matchId: string,
  input: AdminResultRowInput,
  ctx: Ctx = {},
) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true, resultsStatus: true, status: true,
      tournament: { select: { pointsPerKill: true, placementPoints: true, title: true } },
    },
  });
  if (!match) throw notFound('Match not found');
  if (match.resultsStatus === 'PUBLISHED') {
    throw conflict('CONFLICT', 'Results are published and locked. Unpublish first (if permitted) to edit.');
  }

  const participant = await prisma.matchParticipant.findUnique({ where: { id: input.participantId } });
  if (!participant || participant.matchId !== matchId) throw notFound('Participant not found in this match.');

  const table = tableFor(match.tournament);
  const perKill = match.tournament.pointsPerKill;

  const base = {
    placement: input.position ?? participant.placement,
    kills: input.kills ?? participant.kills,
    bonus: input.bonus ?? participant.bonus,
    penalty: input.penalty ?? participant.penalty,
  };
  const finalScore = scoreFor(base, perKill, table);

  const updated = await prisma.$transaction(async (tx) => {
    const prev = await tx.matchParticipant.findUnique({ where: { id: participant.id } });
    const row = await tx.matchParticipant.update({
      where: { id: participant.id },
      data: {
        placement: base.placement,
        kills: base.kills,
        bonus: base.bonus,
        penalty: base.penalty,
        points: base.placement !== null && base.placement !== undefined
          ? placementPointsFor(base.placement, table) + (base.kills ?? 0) * perKill
          : participant.points,
        finalScore,
        prizeAmount: input.prize !== undefined && input.prize !== null
          ? new Prisma.Decimal(input.prize)
          : participant.prizeAmount,
        notes: input.notes !== undefined ? input.notes : participant.notes,
        status: input.status ?? participant.status,
        absent: input.absent ?? participant.absent,
        readyAt: input.ready === true ? new Date() : input.ready === false ? null : participant.readyAt,
        evidenceUrl: input.evidenceUrl !== undefined ? input.evidenceUrl : participant.evidenceUrl,
      },
    });
    // If the participant had verified stats and now changes to a result state,
    // keep PlayerStat in sync for the player-facing leaderboard.
    const previous = prev as unknown as ResultRow;
    const next = row as unknown as ResultRow;
    await syncStatsForResultChange(tx, previous, next, perKill, table);
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'RESULT_ROW_SAVED', entity: 'MatchParticipant', entityId: participant.id,
        before: {
          placement: prev?.placement, kills: prev?.kills, bonus: prev?.bonus, penalty: prev?.penalty,
          points: prev?.points, finalScore: prev?.finalScore ?? null, prize: prev?.prizeAmount ? num(prev.prizeAmount) : null,
          status: prev?.status, absent: prev?.absent,
        },
        after: {
          placement: row.placement, kills: row.kills, bonus: row.bonus, penalty: row.penalty,
          points: row.points, finalScore: row.finalScore ?? null, prize: row.prizeAmount ? num(row.prizeAmount) : null,
          status: row.status, absent: row.absent,
        },
        ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return row;
  }, TX_OPTS);

  return {
    id: updated.id,
    placement: updated.placement,
    kills: updated.kills,
    bonus: updated.bonus,
    penalty: updated.penalty,
    points: updated.points,
    finalScore: updated.finalScore,
    prizeAmount: updated.prizeAmount ? num(updated.prizeAmount) : null,
    status: updated.status,
    absent: updated.absent,
  };
}

/** Keep PlayerStat consistent when an admin move changes a solo participant's verified results. */
async function syncStatsForResultChange(
  tx: Prisma.TransactionClient,
  prev: ResultRow,
  next: ResultRow,
  perKill: number,
  table: number[],
) {
  const targetUserId = next.userId ?? prev.userId;
  if (!targetUserId) return; // team rows are reconciled per-member via winner distribution

  const prevPlayed = prev.status === 'PLAYED' && prev.placement !== null && prev.placement !== undefined;
  const nextPlayed = next.status === 'PLAYED' && next.placement !== null && next.placement !== undefined;
  if (!prevPlayed && !nextPlayed) return;

  const prevScore = prevPlayed
    ? finalScoreFor({ placement: prev.placement!, kills: prev.kills ?? 0, pointsPerKill: perKill, table, bonus: prev.bonus ?? 0, penalty: prev.penalty ?? 0 })
    : 0;
  const nextScore = nextPlayed
    ? finalScoreFor({ placement: next.placement!, kills: next.kills ?? 0, pointsPerKill: perKill, table, bonus: next.bonus ?? 0, penalty: next.penalty ?? 0 })
    : 0;

  const existing = await tx.playerStat.findUnique({ where: { userId: targetUserId } });
  if (!existing) return;

  const patch = {
    matchesPlayed: { increment: nextPlayed && !prevPlayed ? 1 : !nextPlayed && prevPlayed ? -1 : 0 },
    kills: { increment: (next.kills ?? 0) - (prev.kills ?? 0) },
    totalPoints: { increment: nextScore - prevScore },
    wins: { increment: (nextPlayed && next.placement === 1 ? 1 : 0) - (prevPlayed && prev.placement === 1 ? 1 : 0) },
  };
  await tx.playerStat.update({ where: { userId: targetUserId }, data: patch });
}

/** Staff — set the match results workflow state and audit the transition. */
export async function setResultsStatus(
  adminId: string,
  matchId: string,
  status: 'UNDER_REVIEW' | 'CONFIRMED' | 'PUBLISHED' | 'DRAFT',
  ctx: Ctx = {},
) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true, resultsStatus: true, resultsFinalized: true, status: true, tournamentId: true,
      tournament: { select: { title: true } },
    },
  });
  if (!match) throw notFound('Match not found');
  if (match.resultsStatus === 'PUBLISHED' && status !== 'PUBLISHED') {
    throw conflict('CONFLICT', 'Published results cannot be reverted — winners are public and prizes may be credited.');
  }
  if (status !== 'DRAFT' && match.status !== 'COMPLETED') {
    throw badRequest('VALIDATION_ERROR', 'Mark the match COMPLETED before reviewing/publishing results.');
  }
  if (status === 'CONFIRMED' || status === 'PUBLISHED') {
    const rows = await prisma.matchParticipant.count({
      where: { matchId, placement: { not: null }, status: 'PLAYED' },
    });
    if (rows === 0) throw badRequest('VALIDATION_ERROR', 'No scored participants — enter results first.');
  }

  const updated = await prisma.match.update({
    where: { id: matchId },
    data: {
      resultsStatus: status,
      resultsPublishedAt: status === 'PUBLISHED' ? new Date() : null,
      resultsFinalized: status === 'PUBLISHED' ? true : match.resultsFinalized,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: `MATCH_RESULTS_${status}`, entity: 'Match', entityId: matchId,
      before: { resultsStatus: match.resultsStatus },
      after: { resultsStatus: status, publishedAt: updated.resultsPublishedAt },
      ip: ctx.ip, userAgent: ctx.userAgent,
    },
  });

  await prisma.notification.create({
    data: {
      userId: adminId, type: 'ACCOUNT',
      title: `Results ${status.toLowerCase().replace('_', ' ')}`,
      body: `Match results for ${match.tournament.title} are now ${status.toLowerCase().replace('_', ' ')}.`,
      data: { matchId, tournamentId: match.tournamentId },
    },
  });

  return { id: matchId, resultsStatus: updated.resultsStatus, resultsPublishedAt: updated.resultsPublishedAt };
}

/**
 * Calculate prize amounts per participant from the standings (placement prizes
 * only) WITHOUT crediting anything. Called on CONFIRM; PUBLISH persists the
 * computed prize on each row and is the only step that reveals results.
 */
export async function confirmStandings(adminId: string, matchId: string, ctx: Ctx = {}) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true, tournamentId: true, resultsStatus: true,
      tournament: { select: { id: true, type: true, title: true, pointsPerKill: true, placementPoints: true } },
    },
  });
  if (!match) throw notFound('Match not found');

  const [rows, prizes] = await Promise.all([
    prisma.matchParticipant.findMany({ where: { matchId, status: 'PLAYED', absent: false } }),
    prisma.prize.findMany({ where: { tournamentId: match.tournamentId, OR: [{ kind: null }, { kind: 'PLACEMENT' }] }, orderBy: { position: 'asc' } }),
  ]);

  const table = tableFor(match.tournament);
  const perKill = match.tournament.pointsPerKill;
  const scored = rows.map((r) => {
    const score = r.finalScore ?? scoreFor({
      placement: r.placement, kills: r.kills, bonus: r.bonus, penalty: r.penalty,
    }, perKill, table);
    return { ...r, score: score ?? 0 };
  });
  const ranked = rankByScore(scored.map((r) => ({
    key: r.id, score: r.score, kills: r.kills ?? 0, placement: r.placement,
  }))).map((r) => r.key);

  const placementByRank = new Map<string, number>();
  ranked.forEach((id, idx) => placementByRank.set(id, idx + 1));

  const computed = await prisma.$transaction(async (tx) => {
    const updates: Array<{ id: string; placement: number; finalScore: number; prizeAmount: number | null }> = [];
    for (const r of rows) {
      const rank = placementByRank.get(r.id) ?? 0;
      const prize = prizes.find((p) => p.position === rank);
      const amount = prize ? num(prize.amount) : null;
      const finalScore = scoreFor({
        placement: r.placement, kills: r.kills, bonus: r.bonus, penalty: r.penalty,
      }, perKill, table);
      if (finalScore === null) continue;
      await tx.matchParticipant.update({
        where: { id: r.id },
        data: { placement: r.placement, finalScore, prizeAmount: amount !== null ? new Prisma.Decimal(amount) : null },
      });
      updates.push({ id: r.id, placement: r.placement ?? rank, finalScore, prizeAmount: amount });
    }
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'MATCH_RESULTS_CONFIRMED', entity: 'Match', entityId: matchId,
        after: { ranked, scored: updates.map((u) => ({ participantId: u.id, finalScore: u.finalScore, prize: u.prizeAmount })) },
        ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return updates;
  }, TX_OPTS);

  return { matchId, confirmed: computed.length, rows: computed };
}

/** Server-side standings for a match — public only when PUBLISHED. */
export async function matchStandings(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, resultsStatus: true, resultsPublishedAt: true },
  });
  if (!match) throw notFound('Match not found');

  const rows = await prisma.matchParticipant.findMany({
    where: { matchId, status: 'PLAYED', absent: false },
    select: {
      id: true, placement: true, kills: true, bonus: true, penalty: true,
      points: true, finalScore: true, prizeAmount: true, notes: true, status: true,
      user: { select: { username: true, profile: { select: { freeFireIGN: true } } } },
      team: { select: { name: true, tag: true } },
    },
    orderBy: { finalScore: 'desc' },
  });

  return {
    matchId,
    resultsStatus: match.resultsStatus,
    published: match.resultsStatus === 'PUBLISHED',
    rows: rows.map((r, i) => ({
      id: r.id,
      rank: i + 1,
      label: r.team ? `${r.team.name} [${r.team.tag}]` : (r.user?.profile?.freeFireIGN ?? r.user?.username ?? 'Unknown'),
      placement: r.placement,
      kills: r.kills,
      bonus: r.bonus,
      penalty: r.penalty,
      points: r.points,
      finalScore: r.finalScore,
      prizeAmount: r.prizeAmount ? num(r.prizeAmount) : null,
      notes: r.notes,
      status: r.status,
    })),
  };
}
