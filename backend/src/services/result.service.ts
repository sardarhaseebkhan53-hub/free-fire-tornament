// =============================================================================
// Phase 8 — Results & prize distribution.
//
// Flow: players submit result screenshots for completed matches → staff verify
// (approve / reject / disqualify) → points = placement table + kills × rate →
// winner ranking → IDEMPOTENT prize distribution (placement + capped kill pool
// + MVP) crediting WINNING balances through the immutable ledger.
//
// Every step is audited and notified; the database is the source of truth and
// the (tournamentId, position) unique constraint on Winner is the
// double-distribution defense.
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { getSetting } from './settings.service';
import { moveBalance, TX_OPTS } from './wallet.service';

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;

/** Spec §placement table — consistent with the seed and leaderboard. */
export const PLACEMENT_POINTS = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1];

const KILL_POOL_BASE_POSITION = 100; // Winner.position namespace for kill pools
const MVP_POSITION = 200;

export function pointsFor(placement: number, kills: number, perKill: number): number {
  const base = placement >= 1 && placement <= PLACEMENT_POINTS.length ? PLACEMENT_POINTS[placement - 1]! : 0;
  return base + kills * perKill;
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
      after: { matchId, placement: input.placement, kills: input.kills }, ip: ctx.ip,
    },
  });
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
      select: { id: true, tournamentId: true, tournament: { select: { pointsPerKill: true, title: true } } },
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
        const oldPoints = pointsFor(participant.placement, participant.kills ?? 0, perKill);
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
    const points = pointsFor(placement, kills, perKill);

    // Compensate stats if this participant was already PLAYED (correction).
    if (participant.status === 'PLAYED' && participant.placement !== null) {
      const oldPoints = pointsFor(participant.placement, participant.kills ?? 0, perKill);
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
      data: { status: 'PLAYED', placement, kills, points },
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
