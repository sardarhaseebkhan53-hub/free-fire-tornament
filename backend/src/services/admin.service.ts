// =============================================================================
// Admin panel services — dashboard stats, revenue analytics, user management,
// tournament builder, match operations, content (blog/ads/SEO), support,
// settings and audit trail. Every mutation is audited; every list is paged.
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden } from '../lib/errors';
import { getSetting, invalidateSetting } from './settings.service';
import { notifyAllUsers } from './notification.service';
import { computeEconomics, type PrizeInput } from './tournament-economics.service';
import { moveBalance, TX_OPTS } from './wallet.service';
import type { Bucket } from './wallet.service';

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;
const pageOf = (p: number) => (Math.max(1, p) - 1);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function adminStats() {
  const dayAgo = new Date(Date.now() - 86_400_000);

  const [users, activeToday, liveTournaments, openTickets, depAgg, wdAgg, registrations30d, recent, fraud] =
    await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.auditLog.findMany({ where: { createdAt: { gte: dayAgo }, actorId: { not: null } }, select: { actorId: true }, distinct: ['actorId'] }),
      prisma.tournament.count({ where: { status: 'LIVE', deletedAt: null } }),
      prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.deposit.aggregate({ where: { status: 'PENDING' }, _count: true, _sum: { amount: true } }),
      prisma.withdrawal.aggregate({ where: { status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } }, _count: true, _sum: { amount: true } }),
      prisma.tournamentRegistration.count({ where: { registeredAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { actor: { select: { username: true } } },
      }),
      prisma.fraudAlert.findMany({
        where: { status: 'OPEN' },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
    ]);

  return {
    kpis: {
      totalUsers: users,
      activeToday: activeToday.length,
      liveTournaments,
      openTickets,
      pendingDeposits: { count: depAgg._count, amount: num(depAgg._sum.amount) },
      pendingWithdrawals: { count: wdAgg._count, amount: num(wdAgg._sum.amount) },
      registrations30d,
    },
    recentActivity: recent.map((a) => ({
      id: a.id,
      action: a.action,
      entity: a.entity,
      actor: a.actor?.username ?? 'system',
      createdAt: a.createdAt,
    })),
    fraudAlerts: fraud.map((f) => ({
      id: f.id,
      kind: f.kind,
      severity: f.severity,
      details: f.details,
      createdAt: f.createdAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Revenue analytics
// ---------------------------------------------------------------------------

export interface DailyPoint { day: string; deposits: number; withdrawals: number; prizes: number; entries: number; registrations: number }

export async function revenueAnalytics(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [depAgg, wdAgg, prizeAgg, entryAgg] = await Promise.all([
    prisma.deposit.aggregate({ where: { status: 'APPROVED', reviewedAt: { gte: since } }, _sum: { amount: true } }),
    prisma.withdrawal.aggregate({ where: { status: 'PAID', reviewedAt: { gte: since } }, _sum: { amount: true } }),
    prisma.winner.aggregate({ where: { status: 'CREDITED', creditedAt: { gte: since } }, _sum: { amount: true } }),
    prisma.tournamentRegistration.aggregate({ where: { status: 'CONFIRMED', registeredAt: { gte: since } }, _sum: { entryAmount: true }, _count: true }),
  ]);

  const series = await prisma.$queryRaw<Array<{ day: Date; deposits: string; withdrawals: string; prizes: string; entries: string; registrations: string }>>`
    WITH days AS (
      SELECT generate_series(date_trunc('day', now() - (${days} || ' days')::interval), date_trunc('day', now()), '1 day') AS day
    )
    SELECT d.day,
      COALESCE((SELECT SUM(amount) FROM deposits WHERE status='APPROVED' AND date_trunc('day', COALESCE("reviewedAt","createdAt")) = d.day), 0) AS deposits,
      COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status='PAID' AND date_trunc('day', COALESCE("reviewedAt","createdAt")) = d.day), 0) AS withdrawals,
      COALESCE((SELECT SUM(amount) FROM winners WHERE status='CREDITED' AND date_trunc('day', "creditedAt") = d.day), 0) AS prizes,
      COALESCE((SELECT SUM("entryAmount") FROM tournament_registrations WHERE status='CONFIRMED' AND date_trunc('day', "registeredAt") = d.day), 0) AS entries,
      COALESCE((SELECT COUNT(*) FROM tournament_registrations WHERE status='CONFIRMED' AND date_trunc('day', "registeredAt") = d.day), 0) AS registrations
    FROM days d ORDER BY d.day`;

  const totalDeposits = num(depAgg._sum.amount);
  const totalWithdrawals = num(wdAgg._sum.amount);
  const totalPrizes = num(prizeAgg._sum.amount);
  const totalEntries = num(entryAgg._sum.entryAmount);

  return {
    window: { days },
    totals: {
      deposits: totalDeposits,
      withdrawals: totalWithdrawals,
      prizes: totalPrizes,
      entryCollection: totalEntries,
      grossRevenue: totalEntries,
      netRevenue: Math.round((totalEntries - totalPrizes) * 100) / 100,
      registrations: entryAgg._count,
    },
    series: series.map((r) => ({
      day: r.day,
      deposits: num(r.deposits),
      withdrawals: num(r.withdrawals),
      prizes: num(r.prizes),
      entries: num(r.entries),
      registrations: Number(r.registrations),
    })),
  };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listUsers(filter: { q?: string; status?: string; page: number; pageSize: number }) {
  const where: Prisma.UserWhereInput = { deletedAt: null };
  if (filter.q) {
    where.OR = [
      { username: { contains: filter.q, mode: 'insensitive' } },
      { email: { contains: filter.q, mode: 'insensitive' } },
      { profile: { freeFireUID: { contains: filter.q } } },
    ];
  }
  if (filter.status) where.status = filter.status as Prisma.EnumUserStatusFilter['equals'];

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      select: {
        id: true, username: true, email: true, role: true, status: true,
        isVerified: true, createdAt: true, lastLoginAt: true,
        profile: { select: { fullName: true, freeFireUID: true } },
        wallet: { select: { cashBalance: true, coinBalance: true, winningBalance: true, bonusBalance: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return {
    items: rows.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      status: u.status,
      isVerified: u.isVerified,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      ffuid: u.profile?.freeFireUID ?? null,
      wallet: u.wallet
        ? {
            cash: num(u.wallet.cashBalance),
            coins: num(u.wallet.coinBalance),
            winning: num(u.wallet.winningBalance),
            bonus: num(u.wallet.bonusBalance),
          }
        : null,
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function setUserStatus(adminId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'BANNED', reason: string, ctx: { ip?: string }) {
  if (userId === adminId) throw badRequest('VALIDATION_ERROR', 'You cannot change your own status.');
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw badRequest('NOT_FOUND', 'User not found');
  if (target.role === 'SUPER_ADMIN' && status !== 'ACTIVE') {
    throw forbidden('Super admins cannot be suspended or banned.');
  }
  // The status change, the forced session revocation, the player notification
  // and the audit record are ONE transaction: a crash halfway must never leave
  // a banned account with live sessions, or a suspension with no audit trail.
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        status,
        ...(status === 'BANNED' ? { bannedAt: new Date(), banReason: reason || null } : { bannedAt: null, banReason: null }),
      },
    });

    // FORCED LOGOUT. `requireAuth` already refuses a non-ACTIVE account, but
    // the refresh tokens themselves used to survive a suspension — so lifting
    // the suspension silently resurrected every session the offender still had
    // open (including on devices the ban was meant to cut off). Kill them here
    // so restoring an account always requires a fresh, audited sign-in.
    if (status !== 'ACTIVE') {
      await tx.authToken.updateMany({
        where: { userId, type: 'REFRESH', revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await tx.notification.create({
      data: {
        userId, type: 'ACCOUNT',
        title: status === 'ACTIVE' ? 'Account restored' : `Account ${status.toLowerCase()}`,
        body: status === 'ACTIVE' ? 'Your account is active again. Welcome back to the arena.' : `Your account has been ${status.toLowerCase()}.${reason ? ` Reason: ${reason}` : ''}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: `USER_${status}`, entity: 'User', entityId: userId,
        before: { status: target.status }, after: { status, reason: reason || null }, ip: ctx.ip,
      },
    });
    return user;
  });
  return { id: updated.id, status: updated.status };
}

export async function adjustBalance(
  adminId: string,
  userId: string,
  input: { bucket: Bucket; amount: number; note: string },
  ctx: { ip?: string },
) {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw badRequest('VALIDATION_ERROR', 'Adjustment must be a non-zero whole amount.');
  }
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!target) throw badRequest('NOT_FOUND', 'User not found');

  const direction = input.amount > 0 ? 'CREDIT' : 'DEBIT';
  const amount = Math.abs(input.amount);
  const currency = await getSetting('platform.currency', 'PKR');

  const out = await prisma.$transaction(async (tx) => {
    const entry = await moveBalance(tx, userId, input.bucket, direction, amount, direction === 'CREDIT' ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT', {
      entityType: 'Wallet',
      reference: `ADJ${Date.now()}`,
      description: input.note || `Manual ${direction === 'CREDIT' ? 'credit' : 'debit'} by admin`,
      createdById: adminId,
    }, currency);
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'BALANCE_ADJUSTED', entity: 'Wallet', entityId: userId,
        before: { balanceBefore: num(entry.balanceBefore) },
        after: { balanceAfter: num(entry.balanceAfter), bucket: input.bucket, amount: input.amount, note: input.note || null },
        ip: ctx.ip,
      },
    });
    return entry;
  }, TX_OPTS);

  await prisma.notification.create({
    data: {
      userId, type: 'SYSTEM',
      title: 'Wallet adjusted by support',
      body: `${currency} ${input.amount > 0 ? '+' : ''}${input.amount} ${input.bucket} ${input.note ? `— ${input.note}` : ''}`,
    },
  });

  return { entryId: out.id, balanceBefore: num(out.balanceBefore), balanceAfter: num(out.balanceAfter) };
}

// ---------------------------------------------------------------------------
// Tournaments + builder
// ---------------------------------------------------------------------------

/** Admin — reconfigure a tournament's scoring formula (spec §35). Purely
 * scoring-related: prize amounts, entry fees and wallet balances are never
 * touched by this endpoint. */
export async function updateTournamentScoring(
  adminId: string,
  id: string,
  input: { pointsPerKill: number; placementPoints: number[]; bonusPoints: number; penaltyPoints: number },
  ctx: { ip?: string },
) {
  const t = await prisma.tournament.findUnique({ where: { id }, select: { id: true, pointsPerKill: true, placementPoints: true, bonusPoints: true, penaltyPoints: true } });
  if (!t) throw badRequest('NOT_FOUND', 'Tournament not found');

  await prisma.$transaction(async (tx) => {
    await tx.tournament.update({
      where: { id },
      data: {
        pointsPerKill: input.pointsPerKill,
        placementPoints: input.placementPoints as unknown as Prisma.InputJsonValue,
        bonusPoints: input.bonusPoints,
        penaltyPoints: input.penaltyPoints,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'TOURNAMENT_SCORING_UPDATED', entity: 'Tournament', entityId: id,
        before: {
          pointsPerKill: Number(t.pointsPerKill), placementPoints: t.placementPoints,
          bonusPoints: Number(t.bonusPoints), penaltyPoints: Number(t.penaltyPoints),
        },
        after: { ...input },
        ip: ctx.ip,
      },
    });
  });
  return { id, ...input };
}

export async function listTournamentsAdmin(filter: { page: number; pageSize: number }) {
  const where: Prisma.TournamentWhereInput = { deletedAt: null };
  const [rows, total] = await Promise.all([
    prisma.tournament.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      select: {
        id: true, title: true, slug: true, type: true, status: true, isFeatured: true,
        entryFeePerPlayer: true, prizePool: true, maxSlots: true, registeredSlots: true,
        startTime: true, createdAt: true,
      },
    }),
    prisma.tournament.count({ where }),
  ]);
  return {
    items: rows.map((t) => ({
      ...t,
      entryFeePerPlayer: num(t.entryFeePerPlayer),
      prizePool: num(t.prizePool),
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export interface BuilderInput {
  title: string;
  type: 'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD';
  description?: string;
  map?: string;
  startTime: Date | string;
  registrationDeadline: Date | string;
  maxSlots: number;
  minSlotsToStart: number;
  entryFeePerPlayer: number;
  pointsPerKill: number;
  numWinners: number;
  refundPercent?: number;
  prizes: PrizeInput[];
  publish?: boolean;
  confirmLoss?: boolean;
  // Spec §5 — full configuration
  banner?: string;
  rules?: string;
  placementPoints?: number[];
  bonusPoints?: number;
  penaltyPoints?: number;
  roomId?: string;
  roomPassword?: string;
  matchNumber?: number;
  matchMap?: string;
  matchScheduledOffsetMinutes?: number;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tournament';

export async function createTournament(adminId: string, input: BuilderInput, ctx: { ip?: string }) {
  const slots = input.maxSlots; // slots are player/team-wide per mode
  const economics = await computeEconomics({
    type: input.type,
    entryFeePerPlayer: input.entryFeePerPlayer,
    slots,
    prizes: input.prizes,
  });

  if (!economics.safe && !input.confirmLoss) {
    throw badRequest('ECONOMIC_UNSAFE', 'This configuration projects a loss. Enable the loss confirmation to proceed.', economics);
  }

  const base = slugify(input.title);
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

  const placementPoints = input.placementPoints && input.placementPoints.length > 0
    ? input.placementPoints
    : undefined;

  const tournament = await prisma.$transaction(async (tx) => {
    const row = await tx.tournament.create({
      data: {
        title: input.title,
        slug,
        description: input.description || null,
        type: input.type,
        map: input.map || null,
        status: input.publish ? 'REGISTRATION_OPEN' : 'DRAFT',
        entryFeePerPlayer: new Prisma.Decimal(input.entryFeePerPlayer),
        // The advertised prize pool is the sum of the configured prizes.
        // It was never persisted on create, so every new tournament showed
        // "PKR 0" in the admin table and on the public cards.
        prizePool: new Prisma.Decimal(
          input.prizes.reduce((sum, p) => sum + Number(p.amount || 0), 0),
        ),
        maxSlots: input.maxSlots,
        minSlotsToStart: input.minSlotsToStart,
        numWinners: input.numWinners,
        pointsPerKill: input.pointsPerKill,
        startTime: new Date(input.startTime),
        registrationDeadline: new Date(input.registrationDeadline),
        rules: input.rules || null,
        banner: input.banner || null,
        placementPoints: placementPoints as unknown as Prisma.InputJsonValue | undefined,
        bonusPoints: input.bonusPoints ?? 0,
        penaltyPoints: input.penaltyPoints ?? 0,
        prizes: {
          create: input.prizes.map((p, i) => ({
            position: i + 1,
            amount: new Prisma.Decimal(p.amount),
            label: p.label ?? (p.kind === 'PLACEMENT' ? `${i + 1} Place` : p.kind === 'KILL_POOL' ? 'Kill Pool' : p.kind),
            kind: p.kind,
            perKill: p.perKill !== undefined ? new Prisma.Decimal(p.perKill) : null,
            cap: p.cap !== undefined ? new Prisma.Decimal(p.cap) : null,
          })),
        },
      },
    });

    // Optional first match created with the tournament (room credentials pre-set).
    if (input.publish && input.matchNumber) {
      const scheduledAt = new Date(new Date(input.startTime).getTime() + (input.matchScheduledOffsetMinutes ?? 0) * 60_000);
      await tx.match.create({
        data: {
          tournamentId: row.id,
          matchNumber: input.matchNumber,
          round: 1,
          map: input.matchMap || input.map || null,
          scheduledAt,
          roomId: input.roomId || null,
          roomPassword: input.roomPassword || null,
          credentialsReleaseAt: new Date(scheduledAt.getTime() - 30 * 60_000),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'TOURNAMENT_CREATED', entity: 'Tournament', entityId: row.id,
        after: {
          title: input.title, slug, publish: !!input.publish, economics: { ...economics },
          placementPoints, bonusPoints: input.bonusPoints ?? 0, penaltyPoints: input.penaltyPoints ?? 0,
          matchNumber: input.matchNumber ?? null, banner: input.banner || null,
        },
        ip: ctx.ip,
      },
    });
    return row;
  });

  // Announce published tournaments to every active player.
  if (input.publish) await announceTournament(tournament.id, input.title, tournament.slug, input.type, input.entryFeePerPlayer, input.startTime);

  return { id: tournament.id, slug: tournament.slug, status: tournament.status, economics };
}

/** "New tournament" broadcast — shared by create (publish) and status changes to REGISTRATION_OPEN. */
async function announceTournament(
  id: string, title: string, slug: string, type: string, entryFee: number, startTime: string | Date,
) {
  const when = new Date(startTime).toLocaleString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  await notifyAllUsers({
    type: 'TOURNAMENT_UPDATE',
    title: 'New tournament just dropped 🏆',
    body: `${title} (${type.replace('_', ' ')}) — entry PKR ${entryFee}, starts ${when}. Registration is open — lock your slot!`,
    data: { slug, area: 'tournaments', tournamentId: id },
  });
}

export async function setTournamentStatus(adminId: string, id: string, status: string, ctx: { ip?: string }) {
  const t = await prisma.tournament.findUnique({ where: { id } });
  if (!t) throw badRequest('NOT_FOUND', 'Tournament not found');
  if (t.deletedAt) throw badRequest('NOT_FOUND', 'Tournament not found');
  const allowed = ['DRAFT', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED', 'CANCELLED'];
  if (!allowed.includes(status)) throw badRequest('VALIDATION_ERROR', 'Invalid status');

  const transitions: Record<string, string[]> = {
    DRAFT: ['DRAFT', 'REGISTRATION_OPEN', 'CANCELLED'],
    REGISTRATION_OPEN: ['REGISTRATION_OPEN', 'LIVE', 'CANCELLED'],
    LIVE: ['LIVE', 'COMPLETED', 'CANCELLED'],
    COMPLETED: ['COMPLETED'],
    CANCELLED: ['CANCELLED'],
  };
  if (!transitions[t.status]?.includes(status)) {
    throw conflict('CONFLICT', `Cannot move a ${t.status.toLowerCase()} tournament to ${status.toLowerCase()}.`);
  }
  if (status === t.status) return { id, status };

  // Settings are read outside the financial transaction because the embedded
  // database has one writer and settings use the global Prisma client.
  const currency = status === 'CANCELLED' ? await getSetting('platform.currency', 'PKR') : null;

  const result = await prisma.$transaction(async (tx) => {
    // Lock the tournament before inspecting registrations. This serializes
    // cancellation against joins and prevents two admin clicks from refunding
    // the same registration twice.
    await tx.$queryRaw`SELECT "id" FROM "tournaments" WHERE "id" = ${id} FOR UPDATE`;
    const current = await tx.tournament.findUnique({ where: { id } });
    if (!current) throw badRequest('NOT_FOUND', 'Tournament not found');
    if (current.status !== t.status) {
      throw conflict('CONFLICT', 'Tournament status changed; refresh and try again.');
    }

    let refundedTotal = 0;
    let registrationsRefunded = 0;
    if (status === 'CANCELLED') {
      const regs = await tx.tournamentRegistration.findMany({
        where: { tournamentId: id, status: 'CONFIRMED' },
        orderBy: { userId: 'asc' },
      });
      const refundPercent = Number(current.refundPercent) / 100;
      for (const reg of regs) {
        const amount = Math.round(Number(reg.entryAmount) * refundPercent * 100) / 100;
        let refundWalletTxId: string | undefined;
        if (amount > 0) {
          const entry = await moveBalance(
            tx,
            reg.userId,
            'CASH',
            'CREDIT',
            amount,
            'ENTRY_REFUND',
            {
              entityType: 'TournamentRegistration',
              entityId: reg.id,
              description: `Refund — ${current.title} cancelled`,
              createdById: adminId,
            },
            currency ?? 'PKR',
          );
          refundWalletTxId = entry.id;
        }
        await tx.tournamentRegistration.update({
          where: { id: reg.id },
          data: { status: 'REFUNDED', cancelledAt: new Date(), refundWalletTxId },
        });
        await tx.notification.create({
          data: {
            userId: reg.userId,
            type: 'TOURNAMENT_UPDATE',
            title: `Tournament cancelled — ${current.title}`,
            body: amount > 0
              ? `Refund of ${currency ?? 'PKR'} ${amount} credited to your cash balance.`
              : 'Your registration was cancelled. No refund was due for this tournament.',
            data: { tournamentId: id },
          },
        });
        refundedTotal += amount;
        registrationsRefunded += 1;
      }
    }

    await tx.tournament.update({ where: { id }, data: { status: status as never } });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: status === 'CANCELLED' ? 'TOURNAMENT_CANCELLED' : 'TOURNAMENT_STATUS',
        entity: 'Tournament', entityId: id,
        before: { status: current.status },
        after: { status, refundedTotal, registrationsRefunded },
        ip: ctx.ip,
      },
    });
    return { id, status, refundedTotal, registrationsRefunded };
  }, TX_OPTS);

  // First time a draft goes live → announce it to every active player.
  if (status === 'REGISTRATION_OPEN' && t.status === 'DRAFT') {
    await announceTournament(id, t.title, t.slug, t.type, t.entryFeePerPlayer.toNumber(), t.startTime.toISOString());
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export async function listMatchesAdmin(filter: {
  tournamentId?: string; q?: string; status?: string;
  sort?: 'scheduledAt' | 'matchNumber' | 'status'; dir?: 'asc' | 'desc';
  page: number; pageSize: number;
}) {
  const where: Prisma.MatchWhereInput = { deletedAt: null, tournament: { deletedAt: null } };
  if (filter.tournamentId) where.tournamentId = filter.tournamentId;
  if (filter.status) where.status = filter.status as Prisma.EnumMatchStatusFilter['equals'];
  if (filter.q) {
    where.OR = [
      { notes: { contains: filter.q, mode: 'insensitive' } },
      { tournament: { title: { contains: filter.q, mode: 'insensitive' } } },
      { tournament: { slug: { contains: filter.q, mode: 'insensitive' } } },
    ];
  }
  const orderBy = { [filter.sort ?? 'scheduledAt']: filter.dir ?? ('desc' as const) } as Prisma.MatchOrderByWithRelationInput;

  const [rows, total] = await Promise.all([
    prisma.match.findMany({
      where,
      orderBy,
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: {
        tournament: { select: { title: true, slug: true, type: true } },
        _count: { select: { participants: true, resultSubmissions: true } },
      },
    }),
    prisma.match.count({ where }),
  ]);
  return {
    items: rows.map((m) => ({
      id: m.id,
      matchNumber: m.matchNumber,
      round: m.round,
      map: m.map,
      scheduledAt: m.scheduledAt,
      status: m.status,
      resultsFinalized: m.resultsFinalized,
      resultsStatus: m.resultsStatus,
      participants: m._count.participants,
      submissions: m._count.resultSubmissions,
      tournament: m.tournament,
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function setMatchStatus(
  adminId: string,
  id: string,
  status: 'UPCOMING' | 'SCHEDULED' | 'ROOM_CREATED' | 'ROOM_OPEN' | 'CREDENTIALS_RELEASED' | 'LIVE' | 'COMPLETED' | 'CANCELLED',
  ctx: { ip?: string },
) {
  const m = await prisma.match.findUnique({ where: { id } });
  if (!m || m.deletedAt) throw badRequest('NOT_FOUND', 'Match not found');
  if (m.status === status) return { id, status };
  if (m.resultsStatus === 'PUBLISHED' && status !== 'COMPLETED') {
    throw conflict('CONFLICT', 'Published matches are final — only COMPLETED is allowed.');
  }

  const transitions: Record<string, string[]> = {
    UPCOMING: ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['ROOM_CREATED', 'ROOM_OPEN', 'LIVE', 'CANCELLED'],
    ROOM_CREATED: ['ROOM_OPEN', 'CREDENTIALS_RELEASED', 'LIVE', 'CANCELLED'],
    ROOM_OPEN: ['CREDENTIALS_RELEASED', 'LIVE', 'CANCELLED'],
    CREDENTIALS_RELEASED: ['LIVE', 'CANCELLED'],
    LIVE: ['COMPLETED', 'CANCELLED'],
    COMPLETED: ['COMPLETED'],
    CANCELLED: ['CANCELLED'],
  };
  if (!transitions[m.status]?.includes(status)) {
    throw conflict('CONFLICT', `Cannot move a ${m.status.toLowerCase()} match to ${status.toLowerCase()}.`);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "matches" WHERE "id" = ${id} FOR UPDATE`;
    const current = await tx.match.findUnique({ where: { id } });
    if (!current) throw badRequest('NOT_FOUND', 'Match not found');
    if (current.status !== m.status) throw conflict('CONFLICT', 'Match status changed; refresh and try again.');
    if (current.resultsStatus === 'PUBLISHED' && status !== 'COMPLETED') {
      throw conflict('CONFLICT', 'Published matches are final — only COMPLETED is allowed.');
    }

    const updated = await tx.match.update({
      where: { id },
      data: {
        status,
        credentialsReleasedAt: status === 'ROOM_OPEN' || status === 'CREDENTIALS_RELEASED'
          ? (current.credentialsReleasedAt ?? new Date())
          : current.credentialsReleasedAt,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'MATCH_STATUS', entity: 'Match', entityId: id,
        before: { status: current.status }, after: { status }, ip: ctx.ip,
      },
    });
    return { id, status: updated.status };
  }, TX_OPTS);
}

// ---------------------------------------------------------------------------
// Leaderboard admin controls (spec §40) — stats only, NEVER financial rows.
// ---------------------------------------------------------------------------

export async function adjustPlayerStats(
  adminId: string,
  input: {
    userId: string; kills?: number; totalPoints?: number; wins?: number; matchesPlayed?: number;
    note: string;
  },
  ctx: { ip?: string },
) {
  const target = await prisma.user.findUnique({ where: { id: input.userId }, select: { username: true } });
  if (!target) throw badRequest('NOT_FOUND', 'User not found');

  const stat = await prisma.playerStat.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      kills: Math.max(0, input.kills ?? 0),
      totalPoints: Math.max(0, input.totalPoints ?? 0),
      wins: Math.max(0, input.wins ?? 0),
      matchesPlayed: Math.max(0, input.matchesPlayed ?? 0),
    },
    update: {
      ...(input.kills !== undefined ? { kills: { increment: input.kills } } : {}),
      ...(input.totalPoints !== undefined ? { totalPoints: { increment: input.totalPoints } } : {}),
      ...(input.wins !== undefined ? { wins: { increment: input.wins } } : {}),
      ...(input.matchesPlayed !== undefined ? { matchesPlayed: { increment: input.matchesPlayed } } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'LEADERBOARD_ADJUSTED', entity: 'PlayerStat', entityId: stat.id,
      after: { username: target.username, ...input, note: input.note },
      ip: ctx.ip,
    },
  });
  return {
    userId: input.userId,
    matchesPlayed: stat.matchesPlayed,
    wins: stat.wins,
    kills: stat.kills,
    totalPoints: stat.totalPoints,
    earnings: num(stat.earnings),
  };
}

/** Rebuild PlayerStat rows from verified match participants (placement, kills, finalScore). */
export async function recalculateLeaderboard(adminId: string, ctx: { ip?: string }) {
  const participants = await prisma.matchParticipant.findMany({
    // Only published matches are an approved public leaderboard source. Draft
    // and under-review rows may be operationally useful to admins but must not
    // become player-facing ranking history through a rebuild.
    where: { status: 'PLAYED', absent: false, match: { resultsStatus: 'PUBLISHED' } },
    select: {
      userId: true, teamId: true, placement: true, kills: true, finalScore: true,
      match: { select: { scheduledAt: true } },
      team: { select: { members: { select: { userId: true } } } },
    },
  });

  const agg = new Map<string, { matches: number; wins: number; kills: number; points: number; lastPlayedAt: Date }>();
  const add = (userId: string, p: { placement: number | null; kills: number | null; finalScore: number | null; match: { scheduledAt: Date } }, kills: number) => {
    const cur = agg.get(userId) ?? { matches: 0, wins: 0, kills: 0, points: 0, lastPlayedAt: p.match.scheduledAt };
    cur.matches += 1;
    cur.kills += kills;
    cur.points += p.finalScore ?? 0;
    if (p.placement === 1) cur.wins += 1;
    if (p.match.scheduledAt > cur.lastPlayedAt) cur.lastPlayedAt = p.match.scheduledAt;
    agg.set(userId, cur);
  };

  for (const p of participants) {
    if (p.userId) add(p.userId, p, p.kills ?? 0);
    const members = p.team?.members ?? [];
    const teamKills = members.length ? Math.round((p.kills ?? 0) / members.length) : 0;
    for (const m of members) add(m.userId, p, teamKills);
  }

  await prisma.$transaction(async (tx) => {
    for (const [userId, s] of agg) {
      await tx.playerStat.upsert({
        where: { userId },
        create: { userId, matchesPlayed: s.matches, wins: s.wins, kills: s.kills, totalPoints: s.points, lastPlayedAt: s.lastPlayedAt },
        update: { matchesPlayed: s.matches, wins: s.wins, kills: s.kills, totalPoints: s.points, lastPlayedAt: s.lastPlayedAt },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'LEADERBOARD_RECALCULATED', entity: 'PlayerStat', entityId: null,
        after: { usersUpdated: agg.size, basedOn: 'published match participants' },
        ip: ctx.ip,
      },
    });
  });
  return { usersUpdated: agg.size };
}

// ---------------------------------------------------------------------------
// Winners + Teams + Reports (admin sections)
// ---------------------------------------------------------------------------

export async function listWinnersAdmin(filter: { page: number; pageSize: number; tournamentId?: string }) {
  const where: Prisma.WinnerWhereInput = filter.tournamentId ? { tournamentId: filter.tournamentId } : {};
  const [rows, total] = await Promise.all([
    prisma.winner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: {
        user: { select: { username: true, profile: { select: { freeFireIGN: true } } } },
        team: { select: { name: true, tag: true } },
        tournament: { select: { title: true, slug: true, type: true } },
      },
    }),
    prisma.winner.count({ where }),
  ]);
  return {
    items: rows.map((w) => ({
      id: w.id,
      position: w.position,
      amount: num(w.amount),
      status: w.status,
      creditedAt: w.creditedAt,
      createdAt: w.createdAt,
      recipient: w.team ? `${w.team.name} [${w.team.tag}]` : (w.user?.profile?.freeFireIGN ?? w.user?.username),
      tournament: { title: w.tournament.title, slug: w.tournament.slug, type: w.tournament.type },
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function listTeamsAdmin(filter: { q?: string; page: number; pageSize: number }) {
  const where: Prisma.TeamWhereInput = filter.q
    ? { OR: [{ name: { contains: filter.q, mode: 'insensitive' } }, { tag: { contains: filter.q, mode: 'insensitive' } }] }
    : {};
  const [rows, total] = await Promise.all([
    prisma.team.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      select: {
        id: true, name: true, tag: true, type: true, joinCode: true, createdAt: true,
        captain: { select: { username: true } },
        _count: { select: { members: true, registrations: true, winnings: true } },
      },
    }),
    prisma.team.count({ where }),
  ]);
  return {
    items: rows.map((t) => ({
      id: t.id, name: t.name, tag: t.tag, type: t.type, joinCode: t.joinCode,
      captain: t.captain.username, createdAt: t.createdAt,
      members: t._count.members, registrations: t._count.registrations, winnings: t._count.winnings,
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

/** Cross-domain reports: attendance/registration/finance quick views. */
export async function adminReports() {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const [users, activeUsers, registrations, matches, completedMatches, deposits, withdrawals, entries, winners] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { lastLoginAt: { gte: monthAgo } } }),
      prisma.tournamentRegistration.count({ where: { status: 'CONFIRMED', registeredAt: { gte: monthAgo } } }),
      prisma.match.count(),
      prisma.match.count({ where: { status: 'COMPLETED' } }),
      prisma.deposit.aggregate({ where: { status: 'APPROVED', reviewedAt: { gte: monthAgo } }, _sum: { amount: true }, _count: true }),
      prisma.withdrawal.aggregate({ where: { status: 'PAID', paidAt: { gte: monthAgo } }, _sum: { amount: true }, _count: true }),
      prisma.tournamentRegistration.aggregate({ where: { status: 'CONFIRMED', registeredAt: { gte: monthAgo } }, _sum: { entryAmount: true } }),
      prisma.winner.aggregate({ where: { status: 'CREDITED', creditedAt: { gte: monthAgo } }, _sum: { amount: true }, _count: true }),
    ]);
  return {
    window: '30d',
    users: { total: users, active: activeUsers },
    registrations: { count: registrations, revenue: num(entries._sum.entryAmount) },
    matches: { total: matches, completed: completedMatches },
    deposits: { count: deposits._count, amount: num(deposits._sum.amount) },
    withdrawals: { count: withdrawals._count, amount: num(withdrawals._sum.amount) },
    prizes: { count: winners._count, amount: num(winners._sum.amount) },
  };
}

// ---------------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------------

export async function listTickets(filter: { status?: string; page: number; pageSize: number }) {
  const where: Prisma.SupportTicketWhereInput = filter.status
    ? { status: filter.status as Prisma.EnumTicketStatusFilter['equals'] }
    : {};
  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: {
        user: { select: { username: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' }, take: 50, include: { sender: { select: { username: true, role: true } } } },
      },
    }),
    prisma.supportTicket.count({ where }),
  ]);
  return {
    items: rows.map((t) => ({
      id: t.id,
      category: t.category,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      user: t.user,
      messages: t.messages.map((m) => ({
        id: m.id, body: m.body, fromStaff: (m.sender?.role ?? 'USER') !== 'USER', sender: m.sender?.username ?? 'staff', createdAt: m.createdAt,
        attachment: m.attachment ? `/api/support/attachments/${m.id}` : null,
      })),
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function replyTicket(adminId: string, id: string, body: string, close: boolean) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id }, include: { user: { select: { username: true } } } });
  if (!ticket) throw badRequest('NOT_FOUND', 'Ticket not found');
  const message = await prisma.supportMessage.create({
    data: { ticketId: id, senderId: adminId, isStaff: true, body },
  });
  await prisma.supportTicket.update({
    where: { id },
    data: { status: close ? 'RESOLVED' : 'WAITING_USER' },
  });
  await prisma.notification.create({
    data: {
      userId: ticket.userId, type: 'SUPPORT_REPLY',
      title: `Support replied: ${ticket.subject}`,
      body: body.slice(0, 160),
      data: { ticketId: id },
    },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'TICKET_REPLIED', entity: 'SupportTicket', entityId: id, after: { close } },
  });
  return { messageId: message.id, status: close ? 'RESOLVED' : 'WAITING_USER' };
}

// ---------------------------------------------------------------------------
// Blog CMS
// ---------------------------------------------------------------------------

export async function listBlog(filter: { page: number; pageSize: number }) {
  const [rows, total] = await Promise.all([
    prisma.blogPost.findMany({
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: { author: { select: { username: true } } },
    }),
    prisma.blogPost.count(),
  ]);
  return {
    items: rows.map((b) => ({
      id: b.id, title: b.title, slug: b.slug, category: b.category, status: b.status,
      excerpt: b.excerpt, author: b.author.username, publishedAt: b.publishedAt, createdAt: b.createdAt,
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function createBlog(adminId: string, input: { title: string; category: string; excerpt?: string; content: string; publish?: boolean; seoTitle?: string; seoDescription?: string }) {
  const slug = `${slugify(input.title)}-${Math.random().toString(36).slice(2, 5)}`;
  const post = await prisma.blogPost.create({
    data: {
      title: input.title,
      slug,
      excerpt: input.excerpt || input.content.slice(0, 160),
      content: input.content,
      category: input.category as never,
      status: input.publish ? 'PUBLISHED' : 'DRAFT',
      authorId: adminId,
      publishedAt: input.publish ? new Date() : null,
      seoTitle: input.seoTitle || null,
      seoDescription: input.seoDescription || null,
    },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'BLOG_CREATED', entity: 'BlogPost', entityId: post.id, after: { slug, publish: !!input.publish } },
  });
  return { id: post.id, slug: post.slug, status: post.status };
}

export async function setBlogStatus(adminId: string, id: string, publish: boolean) {
  const post = await prisma.blogPost.update({
    where: { id },
    data: { status: publish ? 'PUBLISHED' : 'DRAFT', publishedAt: publish ? new Date() : null },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: publish ? 'BLOG_PUBLISHED' : 'BLOG_UNPUBLISHED', entity: 'BlogPost', entityId: id },
  });
  return { id: post.id, status: post.status };
}

export async function deleteTournament(adminId: string, id: string, ctx: { ip?: string }) {
  const t = await prisma.tournament.findUnique({
    where: { id },
    select: {
      id: true, title: true, slug: true, status: true, registeredSlots: true, deletedAt: true,
      _count: { select: { registrations: true, matches: true, winners: true } },
    },
  });
  if (!t) throw badRequest('NOT_FOUND', 'Tournament not found');
  if (t.deletedAt) return { id: t.id, deleted: true };

  // Active tournaments must be cancelled/refunded first — deleting them silently
  // would strand paid players. Finished history (COMPLETED / CANCELLED) and
  // unused drafts can be archived directly.
  if (t.status === 'REGISTRATION_OPEN' || t.status === 'LIVE') {
    throw conflict('CONFLICT', 'Active tournaments must be cancelled (with refunds) before they can be removed.');
  }
  if (t.status === 'DRAFT' && t._count.registrations > 0) {
    throw conflict('CONFLICT', 'This draft has registrations. Cancel it before removing.');
  }

  // Soft delete: the row, wallet ledger, prize records and winners all stay for
  // reconciliation/audit; it is simply hidden from every admin/public list.
  await prisma.$transaction(async (tx) => {
    await tx.tournament.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'TOURNAMENT_DELETED', entity: 'Tournament', entityId: t.id,
        before: { title: t.title, slug: t.slug, status: t.status, registeredSlots: t.registeredSlots },
        after: { deletedAt: new Date() }, ip: ctx.ip,
      },
    });
  }, TX_OPTS);
  return { id: t.id, deleted: true };
}

/** Archive a single match without touching its results or financial rows. */
export async function deleteMatch(adminId: string, id: string, ctx: { ip?: string }) {
  const m = await prisma.match.findUnique({ where: { id }, select: { id: true, matchNumber: true, deletedAt: true, tournament: { select: { title: true, deletedAt: true } } } });
  if (!m) throw badRequest('NOT_FOUND', 'Match not found');
  if (m.deletedAt) return { id: m.id, deleted: true };
  await prisma.$transaction(async (tx) => {
    await tx.match.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'MATCH_DELETED', entity: 'Match', entityId: m.id,
        before: { matchNumber: m.matchNumber, tournamentTitle: m.tournament.title },
        after: { deletedAt: new Date() }, ip: ctx.ip,
      },
    });
  }, TX_OPTS);
  return { id: m.id, deleted: true };
}

/** Soft-delete/archive a user account. Balances, ledger, tickets and audits are
 * never destroyed; the user is banned and hidden from all admin/user lists. */
export async function deleteUser(adminId: string, userId: string, reason: string, ctx: { ip?: string }) {
  if (userId === adminId) throw badRequest('VALIDATION_ERROR', 'You cannot remove your own account.');
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, role: true, status: true, deletedAt: true },
  });
  if (!target) throw badRequest('NOT_FOUND', 'User not found');
  if (target.deletedAt) return { id: target.id, deleted: true };
  if (target.role === 'SUPER_ADMIN') throw forbidden('Super admins cannot be removed.');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'BANNED',
      bannedAt: new Date(),
      banReason: reason || 'Account removed by admin',
      deletedAt: new Date(),
      lastLoginAt: null,
    },
  });
  await prisma.notification.create({
    data: {
      userId, type: 'ACCOUNT',
      title: 'Account removed',
      body: reason ? `Your account has been removed. Reason: ${reason}` : 'Your account has been removed by an administrator.',
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'USER_DELETED', entity: 'User', entityId: userId,
      before: { username: target.username, email: target.email, role: target.role, status: target.status },
      after: { status: updated.status, reason: reason || null, deletedAt: updated.deletedAt }, ip: ctx.ip,
    },
  });
  return { id: userId, deleted: true, username: target.username };
}

// ---------------------------------------------------------------------------
// Ads + SEO
// ---------------------------------------------------------------------------

export async function listAds() {
  const rows = await prisma.advertisement.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map((a) => ({
    id: a.id, placement: a.placement, name: a.name, targetUrl: a.targetUrl,
    isActive: a.isActive, impressions: a.impressions, clicks: a.clicks, createdAt: a.createdAt,
  }));
}

export async function createAd(adminId: string, input: { placement: string; name: string; targetUrl?: string; embedHtml?: string }) {
  const ad = await prisma.advertisement.create({
    data: {
      placement: input.placement as never,
      name: input.name,
      targetUrl: input.targetUrl || null,
      embedHtml: input.embedHtml || null,
    },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'AD_CREATED', entity: 'Advertisement', entityId: ad.id, after: { name: input.name } },
  });
  return { id: ad.id };
}

export async function toggleAd(adminId: string, id: string, isActive: boolean) {
  await prisma.advertisement.update({ where: { id }, data: { isActive } });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'AD_TOGGLED', entity: 'Advertisement', entityId: id, after: { isActive } },
  });
  return { id, isActive };
}

export async function listSeo() {
  return prisma.seoConfig.findMany({ orderBy: { pageSlug: 'asc' } });
}

export async function upsertSeo(adminId: string, input: { pageSlug: string; title?: string; description?: string; canonicalUrl?: string; keywords?: string }) {
  const row = await prisma.seoConfig.upsert({
    where: { pageSlug: input.pageSlug },
    create: {
      pageSlug: input.pageSlug,
      title: input.title || null,
      description: input.description || null,
      canonicalUrl: input.canonicalUrl || null,
      keywords: input.keywords || null,
    },
    update: {
      title: input.title || null,
      description: input.description || null,
      canonicalUrl: input.canonicalUrl || null,
      keywords: input.keywords || null,
    },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'SEO_UPDATED', entity: 'SeoConfig', entityId: row.id, after: { pageSlug: input.pageSlug } },
  });
  return { id: row.id, pageSlug: row.pageSlug };
}

// ---------------------------------------------------------------------------
// Full wallet ledger (admin)
// ---------------------------------------------------------------------------

export async function listAllTransactions(filter: {
  type?: string; bucket?: string; direction?: 'CREDIT' | 'DEBIT';
  q?: string; from?: Date; to?: Date; page: number; pageSize: number;
}) {
  const where: Prisma.WalletTransactionWhereInput = {};
  if (filter.type) where.type = filter.type as never;
  if (filter.bucket) where.bucket = filter.bucket as never;
  if (filter.direction) where.direction = filter.direction as never;
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  if (filter.q) {
    where.OR = [
      { reference: { contains: filter.q, mode: 'insensitive' } },
      { description: { contains: filter.q, mode: 'insensitive' } },
      { user: { username: { contains: filter.q, mode: 'insensitive' } } },
      { user: { email: { contains: filter.q, mode: 'insensitive' } } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: { user: { select: { username: true, email: true } } },
    }),
    prisma.walletTransaction.count({ where }),
  ]);
  return {
    items: rows.map((t) => ({
      id: t.id,
      userId: t.userId,
      username: t.user.username,
      email: t.user.email,
      type: t.type,
      bucket: t.bucket,
      direction: t.direction,
      amount: num(t.amount),
      currency: t.currency,
      balanceBefore: num(t.balanceBefore),
      balanceAfter: num(t.balanceAfter),
      reference: t.reference,
      description: t.description,
      status: t.status,
      createdAt: t.createdAt,
    })),
    page: filter.page,
    pageSize: filter.pageSize,
    total,
  };
}

/** CSV export for the admin ledger (respects the same filters as the page). */
export async function listAllTransactionsCsv(filter: {
  type?: string; bucket?: string; direction?: 'CREDIT' | 'DEBIT';
  q?: string; from?: Date; to?: Date;
}) {
  const where: Prisma.WalletTransactionWhereInput = {};
  if (filter.type) where.type = filter.type as never;
  if (filter.bucket) where.bucket = filter.bucket as never;
  if (filter.direction) where.direction = filter.direction as never;
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  if (filter.q) {
    where.OR = [
      { reference: { contains: filter.q, mode: 'insensitive' } },
      { description: { contains: filter.q, mode: 'insensitive' } },
      { user: { username: { contains: filter.q, mode: 'insensitive' } } },
      { user: { email: { contains: filter.q, mode: 'insensitive' } } },
    ];
  }
  const rows = await prisma.walletTransaction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { username: true, email: true } } },
  });
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[\",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const head = 'Date,Player,Email,Type,Bucket,Direction,Amount,Currency,Before,After,Reference,Description,Status';
  const lines = rows.map((t) =>
    [t.createdAt.toISOString(), t.user.username, t.user.email, t.type, t.bucket, t.direction,
      num(t.amount), t.currency, num(t.balanceBefore), num(t.balanceAfter),
      t.reference ?? '', t.description ?? '', t.status].map(esc).join(','));
  return [head, ...lines].join('\n');
}

// Settings + audit logs
// ---------------------------------------------------------------------------

export async function listSettings() {
  const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
  return rows.map((r) => ({ key: r.key, value: r.value, description: r.description, updatedAt: r.updatedAt }));
}

export async function updateSetting(adminId: string, key: string, value: unknown, ctx: { ip?: string }) {
  const existing = await prisma.setting.findUnique({ where: { key } });
  if (!existing) throw badRequest('NOT_FOUND', 'Unknown setting key');
  const row = await prisma.setting.update({ where: { key }, data: { value: JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue, updatedById: adminId } });
  invalidateSetting(key);
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'SETTING_UPDATED', entity: 'Setting', entityId: key,
      before: { value: existing.value }, after: { value: JSON.parse(JSON.stringify(value)) }, ip: ctx.ip,
    },
  });
  return { key: row.key, value: row.value };
}

export async function listAuditLogs(filter: { action?: string; entity?: string; page: number; pageSize: number }) {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.action) where.action = { contains: filter.action.toUpperCase() };
  if (filter.entity) where.entity = filter.entity;
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: { actor: { select: { username: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    items: rows.map((a) => ({
      id: a.id, action: a.action, entity: a.entity, entityId: a.entityId,
      actor: a.actor?.username ?? 'system', before: a.before, after: a.after,
      ip: a.ip, createdAt: a.createdAt,
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

// ---------------------------------------------------------------------------
// Fresh start — wipe ALL demo/content data so the platform can go live clean.
// Keeps: admin+ accounts (SUPER_ADMIN/ADMIN/MODERATOR), settings, payment
// accounts, static pages, SEO config and the immutable audit trail (a reset
// entry is appended). Removes: player accounts, wallets & ledger entries,
// deposits/withdrawals/transfers, tournaments, registrations, teams, matches,
// results, prizes, winners, referrals, coupons, notifications, tickets,
// disputes, blogs, FAQs, ads, expenses and player stats.
// ---------------------------------------------------------------------------
export async function resetDemoData(actorId: string, ctx: { ip?: string; userAgent?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const keepRoles = { in: ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'] as const };

    // Content that references users/teams/tournaments — children first.
    await tx.matchParticipant.deleteMany({});
    await tx.resultSubmission.deleteMany({});
    await tx.prize.deleteMany({});
    await tx.winner.deleteMany({});
    await tx.match.deleteMany({});
    await tx.tournamentRegistration.deleteMany({});
    await tx.tournament.deleteMany({});

    await tx.teamInvite.deleteMany({});
    await tx.teamMember.deleteMany({});
    await tx.team.deleteMany({});

    await tx.referralReward.deleteMany({});
    await tx.couponRedemption.deleteMany({});
    await tx.coupon.deleteMany({});

    await tx.withdrawal.deleteMany({});
    await tx.deposit.deleteMany({});
    await tx.walletTransfer.deleteMany({});
    await tx.walletTransaction.deleteMany({});
    await tx.notification.deleteMany({});
    await tx.playerStat.deleteMany({});

    await tx.supportMessage.deleteMany({});
    await tx.dispute.deleteMany({});
    await tx.supportTicket.deleteMany({});

    await tx.blogPost.deleteMany({});
    await tx.faq.deleteMany({});
    await tx.advertisement.deleteMany({});
    await tx.expense.deleteMany({});

    // Wallets/profiles/tokens of PLAYER accounts only — admin accounts and
    // their sessions stay completely intact (no admin gets logged out).
    await tx.wallet.deleteMany({ where: { user: { role: 'USER' } } });
    await tx.userProfile.deleteMany({ where: { user: { role: 'USER' } } });
    await tx.authToken.deleteMany({ where: { user: { role: 'USER' } } });
    await tx.fraudAlert.deleteMany({});

    // The players themselves.
    const deleted = await tx.user.deleteMany({ where: { role: 'USER' } });

    // Append to the (kept) audit trail.
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'DEMO_DATA_RESET',
        entity: 'Platform',
        entityId: null,
        after: { playersDeleted: deleted.count, note: 'Fresh start — demo data wiped; admin accounts, settings, payment accounts, static pages, SEO and audit history kept.' },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });

    return { playersDeleted: deleted.count };
  });
}
