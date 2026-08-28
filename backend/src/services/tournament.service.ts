// =============================================================================
// Tournament engine — join flow, coupons, cancellation & refunds.
//
// Join flow (brief §35) inside ONE database transaction:
//   verify auth/status → check deadline → atomic slot guard (conditional
//   UPDATE) → validate coupon → debit ledger(s) → create registration(s) →
//   commit. Any failure rolls back everything. The unique index on
//   (tournamentId, userId) is the final defense against double joins.
//
// All financial math happens here, server-side. Frontend values are never
// trusted.
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { getSetting } from './settings.service';
import { fireCouponAbuse, fireJoinFailure } from './fraud.service';
import { audit } from '../lib/security';

const TEAM_SIZE: Record<'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD', number> = {
  SOLO: 1, DUO: 2, SQUAD: 4, CLASH_SQUAD: 4,
};

// Financial transactions get a generous budget: under load they queue on the
// database writer (especially the embedded dev database); the work itself is small.
const TX_OPTS = { timeout: 30_000, maxWait: 15_000 } as const;

// ---------------------------------------------------------------------------
// Coupon validation (shared by preview + join)
// ---------------------------------------------------------------------------
export async function previewCoupon(
  codeRaw: string,
  tournamentId: string,
  userId: string,
  entryFee: number,
  actor: ActorCtx = {},
) {
  const code = codeRaw.trim().toUpperCase();
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon || coupon.status !== 'ACTIVE') {
    // Code guessing is cheap to try and expensive to ignore — record it.
    await audit({
      actorId: userId, action: 'COUPON_REJECTED', entity: 'Coupon', entityId: null,
      after: { code, reason: 'not found or inactive' }, ip: actor.ip, userAgent: actor.userAgent,
    });
    fireCouponAbuse(userId, code, actor);
    throw badRequest('VALIDATION_ERROR', 'Coupon not found or inactive');
  }
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw badRequest('VALIDATION_ERROR', 'Coupon has expired');
  if (coupon.startsAt > new Date()) throw badRequest('VALIDATION_ERROR', 'Coupon is not active yet');
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw badRequest('VALIDATION_ERROR', 'Coupon usage limit reached');
  }
  if (coupon.appliesTo.length > 0) {
    const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { type: true } });
    if (!t || !coupon.appliesTo.includes(t.type)) {
      throw badRequest('VALIDATION_ERROR', `Coupon not valid for this tournament mode`);
    }
  }
  const existing = await prisma.couponRedemption.findUnique({ where: { couponId_userId: { couponId: coupon.id, userId } } });
  if (existing) throw badRequest('VALIDATION_ERROR', 'You already used this coupon');

  const raw = coupon.type === 'PERCENTAGE'
    ? (entryFee * Number(coupon.value)) / 100
    : Number(coupon.value);
  const capped = coupon.maxDiscount !== null ? Math.min(raw, Number(coupon.maxDiscount)) : raw;
  const discount = Math.round(Math.min(capped, entryFee) * 100) / 100;
  return { code: coupon.code, discount, payable: Math.round((entryFee - discount) * 100) / 100 };
}

// ---------------------------------------------------------------------------
// JOIN — race-safe
// ---------------------------------------------------------------------------
export interface JoinInput {
  tournamentSlug: string;
  teamId?: string;
  couponCode?: string;
}

export interface ActorCtx { ip?: string; userAgent?: string }

export async function joinTournament(userId: string, input: JoinInput, actorIp?: string, actorUa?: string) {
  const actor: ActorCtx = { ip: actorIp, userAgent: actorUa };
  const t = await prisma.tournament.findUnique({ where: { slug: input.tournamentSlug } });
  if (!t || t.status === 'DRAFT') throw notFound('Tournament not found');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Account not found');
  if (user.status !== 'ACTIVE') throw forbidden('Account is not active.');
  if (!user.isVerified) throw forbidden('Verify your email before joining tournaments.');

  if (t.status !== 'REGISTRATION_OPEN') throw badRequest('TOURNAMENT_CLOSED', 'Registration is not open for this tournament.');
  if (t.registrationDeadline <= new Date()) throw badRequest('TOURNAMENT_CLOSED', 'Registration deadline has passed.');

  const teamSize = TEAM_SIZE[t.type];
  const feePerPlayer = Number(t.entryFeePerPlayer);

  // Resolve settings BEFORE opening the transaction: reading them inside would
  // use the global client and deadlock the single-writer embedded database.
  const currency = await getSetting('platform.currency', 'PKR');

  // Resolve who is paying: solo = the player; team modes = every member pays
  // their own share (the captain triggers the join on behalf of the team).
  let payerIds: string[] = [userId];
  if (teamSize > 1) {
    if (!input.teamId) throw badRequest('VALIDATION_ERROR', 'This mode requires a team.');
    const team = await prisma.team.findUnique({
      where: { id: input.teamId },
      include: { members: { select: { userId: true } } },
    });
    if (!team) throw notFound('Team not found');
    if (team.captainId !== userId) throw forbidden('Only the team captain can register the team.');
    const expectedType = t.type === 'DUO' ? 'DUO' : 'SQUAD';
    if (team.type !== expectedType) {
      throw badRequest('VALIDATION_ERROR', `A ${expectedType.toLowerCase()} team is required for this tournament.`);
    }
    if (team.members.length !== teamSize) {
      throw badRequest('VALIDATION_ERROR', `Team must have exactly ${teamSize} members.`);
    }
    payerIds = team.members.map((m) => m.userId);
  }

  try {
    return await runJoin(userId, input, t, feePerPlayer, currency, payerIds, teamSize, actor);
  } catch (e) {
    // Rejections roll their transaction back, so the trail has to be written
    // outside it — this is what makes abuse patterns visible afterwards.
    const code = e instanceof ApiError ? e.code : 'INTERNAL_ERROR';
    if (['TOURNAMENT_FULL', 'TOURNAMENT_CLOSED', 'INSUFFICIENT_BALANCE'].includes(code)) {
      await audit({
        actorId: userId,
        action: 'TOURNAMENT_JOIN_REJECTED',
        entity: 'Tournament',
        entityId: t.id,
        after: { code, slug: t.slug },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      if (code !== 'INSUFFICIENT_BALANCE') {
        fireJoinFailure(userId, code as 'TOURNAMENT_FULL' | 'TOURNAMENT_CLOSED', t.slug, actor);
      }
    }
    throw e;
  }
}

async function runJoin(
  userId: string,
  input: JoinInput,
  t: { id: string; title: string; slug: string; type: 'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD'; status: string; registrationDeadline: Date; startTime: Date; maxSlots: number; refundPercent: unknown },
  feePerPlayer: number,
  currency: string,
  payerIds: string[],
  teamSize: number,
  actor: ActorCtx,
) {
  const actorIp = actor.ip;
  return prisma.$transaction(async (tx) => {
    // 1. Double-join guard (fast path — unique index is the hard guarantee)
    for (const pid of payerIds) {
      const already = await tx.tournamentRegistration.findUnique({
        where: { tournamentId_userId: { tournamentId: t.id, userId: pid } },
      });
      if (already && already.status === 'CONFIRMED') {
        throw conflict('ALREADY_REGISTERED', pid === userId
          ? 'You are already registered for this tournament.'
          : 'A team member is already registered for this tournament.');
      }
    }

    // 2. Atomic slot guard + seat assignment — a single conditional UPDATE.
    // `UPDATE ... RETURNING` is serialized by the row lock, so every
    // successful join receives the exact next seat number; two concurrent
    // joins can never observe the same value. Seat = the slot number the
    // player/team now occupies (1..maxSlots).
    const seatRows = await tx.$queryRaw<Array<{ registeredSlots: number }>>`
      UPDATE "tournaments"
      SET "registeredSlots" = "registeredSlots" + 1
      WHERE "id" = ${t.id}
        AND "status" = 'REGISTRATION_OPEN'
        AND "registrationDeadline" > now()
        AND "registeredSlots" < "maxSlots"
      RETURNING "registeredSlots"
    `;
    if (seatRows.length === 0) {
      // Distinguish full vs closed: re-read latest state outside the race
      const latest = await tx.tournament.findUnique({ where: { id: t.id }, select: { maxSlots: true, registeredSlots: true, status: true } });
      if (latest && latest.registeredSlots >= latest.maxSlots) {
        throw badRequest('TOURNAMENT_FULL', 'This tournament is full.');
      }
      throw badRequest('TOURNAMENT_CLOSED', 'Registration just closed.');
    }
    const seatNumber = seatRows[0]!.registeredSlots;

    // 3. Coupon (applies to the joining player's share)
    let discount = 0;
    let couponId: string | undefined;
    if (input.couponCode) {
      const coupon = await tx.coupon.findUnique({ where: { code: input.couponCode.trim().toUpperCase() } });
      if (!coupon || coupon.status !== 'ACTIVE') throw badRequest('VALIDATION_ERROR', 'Coupon not found or inactive');
      if (coupon.expiresAt && coupon.expiresAt < new Date()) throw badRequest('VALIDATION_ERROR', 'Coupon has expired');
      if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
        throw badRequest('VALIDATION_ERROR', 'Coupon usage limit reached');
      }
      if (coupon.appliesTo.length > 0 && !coupon.appliesTo.includes(t.type)) {
        throw badRequest('VALIDATION_ERROR', 'Coupon not valid for this tournament mode');
      }
      const alreadyUsed = await tx.couponRedemption.findUnique({
        where: { couponId_userId: { couponId: coupon.id, userId } },
      });
      if (alreadyUsed) throw badRequest('VALIDATION_ERROR', 'You already used this coupon');

      const raw = coupon.type === 'PERCENTAGE' ? (feePerPlayer * Number(coupon.value)) / 100 : Number(coupon.value);
      const capped = coupon.maxDiscount !== null ? Math.min(raw, Number(coupon.maxDiscount)) : raw;
      discount = Math.round(Math.min(capped, feePerPlayer) * 100) / 100;
      couponId = coupon.id;

      // Concurrency-safe usage increment
      const inc = await tx.coupon.updateMany({
        where: {
          id: coupon.id,
          usageLimit: coupon.usageLimit === null ? undefined : { gt: coupon.usedCount },
        },
        data: { usedCount: { increment: 1 } },
      });
      if (inc.count === 0) throw badRequest('VALIDATION_ERROR', 'Coupon usage limit reached');
    }


    // 4. Ledger debits + registrations for every payer
    const registrations = [];
    for (const pid of payerIds) {
      const isJoiner = pid === userId;
      const payable = Math.round((feePerPlayer - (isJoiner ? discount : 0)) * 100) / 100;

      const wallet = await tx.wallet.findUnique({ where: { userId: pid } });
      if (!wallet) throw badRequest('NOT_FOUND', 'Wallet not found');
      const before = wallet.cashBalance.toNumber();
      if (before < payable) {
        throw new ApiError(402, 'INSUFFICIENT_BALANCE',
          isJoiner ? 'Insufficient balance to pay the entry fee.' : 'A team member has insufficient balance for their entry share.');
      }
      const after = Math.round((before - payable) * 100) / 100;

      const ledgerEntry = await tx.walletTransaction.create({
        data: {
          userId: pid, bucket: 'CASH', type: 'ENTRY_FEE', direction: 'DEBIT',
          amount: new Prisma.Decimal(payable), currency,
          balanceBefore: new Prisma.Decimal(before), balanceAfter: new Prisma.Decimal(after),
          entityType: 'TournamentRegistration', reference: t.slug,
          description: `Entry — ${t.title}`,
        },
      });

      const reg = await tx.tournamentRegistration.create({
        data: {
          tournamentId: t.id, userId: pid,
          teamId: teamSize > 1 ? input.teamId : undefined,
          entryAmount: new Prisma.Decimal(payable),
          discount: new Prisma.Decimal(isJoiner ? discount : 0),
          couponId: isJoiner ? couponId : undefined,
          walletTxId: ledgerEntry.id,
          seatNumber,
        },
      });
      await tx.wallet.update({ where: { userId: pid }, data: { cashBalance: new Prisma.Decimal(after) } });

      if (isJoiner && couponId) {
        await tx.couponRedemption.create({
          data: { couponId, userId, registrationId: reg.id, discountAmount: new Prisma.Decimal(discount) },
        });
      }

      await tx.notification.create({
        data: {
          userId: pid, type: 'TOURNAMENT_JOINED',
          title: `You joined ${t.title}`,
          body: `Entry ${currency} ${payable} deducted. Your ${teamSize > 1 ? 'team ' : ''}seat is #${seatNumber}. Room details unlock 30 minutes before start — see My Matches.`,
          data: { tournamentId: t.id, slug: t.slug, seatNumber },
        },
      });

      registrations.push(reg);
    }

    // 5. Audit
    await tx.auditLog.create({
      data: {
        actorId: userId, action: 'TOURNAMENT_JOINED', entity: 'Tournament', entityId: t.id,
        after: { players: payerIds.length, entryPerPlayer: feePerPlayer, discount, ip: actorIp },
        ip: actorIp,
      },
    });

    const walletAfter = await tx.wallet.findUnique({ where: { userId }, select: { cashBalance: true } });
    const firstMatch = await tx.match.findFirst({
      where: { tournamentId: t.id },
      orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
      select: { round: true, matchNumber: true, map: true, scheduledAt: true },
    });
    return {
      tournament: { id: t.id, title: t.title, slug: t.slug, startTime: t.startTime },
      registeredPlayers: registrations.length,
      totalPaid: Math.round(registrations.reduce((s, r) => s + Number(r.entryAmount), 0) * 100) / 100,
      discount,
      cashBalanceAfter: walletAfter?.cashBalance ?? null,
      seatNumber,
      assignedSlot: seatNumber,
      match: firstMatch,
    };
  }, TX_OPTS);
}

// ---------------------------------------------------------------------------
// CANCEL (player-initiated) — refunds per tournament refundPercent.
// Team modes: captain cancels the whole team's registration.
// ---------------------------------------------------------------------------
export async function cancelRegistration(userId: string, tournamentSlug: string) {
  const t = await prisma.tournament.findUnique({ where: { slug: tournamentSlug } });
  if (!t) throw notFound('Tournament not found');
  if (!['REGISTRATION_OPEN', 'LIVE'].includes(t.status)) {
    throw badRequest('TOURNAMENT_CLOSED', 'This tournament can no longer be cancelled from your side.');
  }
  if (t.status === 'REGISTRATION_OPEN' && t.registrationDeadline <= new Date()) {
    throw badRequest('TOURNAMENT_CLOSED', 'Registration deadline passed — cancellation is handled by support.');
  }

  const mine = await prisma.tournamentRegistration.findUnique({
    where: { tournamentId_userId: { tournamentId: t.id, userId } },
    include: { team: true },
  });
  if (!mine || mine.status !== 'CONFIRMED') throw notFound('No confirmed registration found.');

  const teamSize = TEAM_SIZE[t.type];
  const isTeam = teamSize > 1 && mine.teamId !== null;
  if (isTeam && mine.team?.captainId !== userId) {
    throw forbidden('Only the team captain can cancel a team registration.');
  }

  // Hoisted out of the transaction — see joinTournament note.
  const currency = await getSetting('platform.currency', 'PKR');

  return prisma.$transaction(async (tx) => {
    const targets = isTeam
      ? await tx.tournamentRegistration.findMany({
          where: { tournamentId: t.id, teamId: mine.teamId, status: 'CONFIRMED' },
        })
      : [mine];

    const refundPercent = Number(t.refundPercent) / 100;
    let refundedTotal = 0;

    for (const reg of targets) {
      const refundAmount = Math.round(Number(reg.entryAmount) * refundPercent * 100) / 100;
      const wallet = await tx.wallet.findUnique({ where: { userId: reg.userId } });
      if (!wallet) continue;
      const before = wallet.cashBalance.toNumber();
      const after = Math.round((before + refundAmount) * 100) / 100;

      const entry = await tx.walletTransaction.create({
        data: {
          userId: reg.userId, bucket: 'CASH', type: 'ENTRY_REFUND', direction: 'CREDIT',
          amount: new Prisma.Decimal(refundAmount), currency,
          balanceBefore: new Prisma.Decimal(before), balanceAfter: new Prisma.Decimal(after),
          entityType: 'TournamentRegistration', entityId: reg.id,
          description: `Refund (${Math.round(refundPercent * 100)}%) — ${t.title}`,
        },
      });

      await tx.wallet.update({ where: { userId: reg.userId }, data: { cashBalance: new Prisma.Decimal(after) } });
      await tx.tournamentRegistration.update({
        where: { id: reg.id },
        data: { status: 'REFUNDED', cancelledAt: new Date(), walletTxId: entry.id },
      });
      await tx.notification.create({
        data: {
          userId: reg.userId, type: 'TOURNAMENT_UPDATE',
          title: `Registration cancelled — ${t.title}`,
          body: `Refund of ${currency} ${refundAmount} credited to your cash balance.`,
        },
      });
      refundedTotal += refundAmount;
    }

    // Free the slot (1 team slot or 1 player slot)
    await tx.tournament.update({
      where: { id: t.id },
      data: { registeredSlots: { decrement: 1 } },
    });

    return {
      cancelled: true,
      registrationsAffected: targets.length,
      refundedTotal: Math.round(refundedTotal * 100) / 100,
    };
  }, TX_OPTS);
}

// ---------------------------------------------------------------------------
// Admin cancellation — refunds everyone per refundPercent, closes the arena.
// (Exposed through the admin panel in Phase 9.)
// ---------------------------------------------------------------------------
export async function adminCancelTournament(adminId: string, tournamentId: string) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!t) throw notFound('Tournament not found');
  if (t.status === 'CANCELLED' || t.status === 'COMPLETED') {
    throw badRequest('VALIDATION_ERROR', 'Tournament is already closed.');
  }

  // Hoisted out of the transaction — see joinTournament note.
  const currency = await getSetting('platform.currency', 'PKR');

  return prisma.$transaction(async (tx) => {
    const regs = await tx.tournamentRegistration.findMany({
      where: { tournamentId, status: 'CONFIRMED' },
    });
    const refundPercent = Number(t.refundPercent) / 100;
    let refunded = 0;

    for (const reg of regs) {
      const amount = Math.round(Number(reg.entryAmount) * refundPercent * 100) / 100;
      const wallet = await tx.wallet.findUnique({ where: { userId: reg.userId } });
      if (!wallet) continue;
      const before = wallet.cashBalance.toNumber();
      const after = Math.round((before + amount) * 100) / 100;
      await tx.walletTransaction.create({
        data: {
          userId: reg.userId, bucket: 'CASH', type: 'ENTRY_REFUND', direction: 'CREDIT',
          amount: new Prisma.Decimal(amount), currency,
          balanceBefore: new Prisma.Decimal(before), balanceAfter: new Prisma.Decimal(after),
          entityType: 'TournamentRegistration', entityId: reg.id,
          description: `Refund — ${t.title} cancelled`,
        },
      });
      await tx.wallet.update({ where: { userId: reg.userId }, data: { cashBalance: new Prisma.Decimal(after) } });
      await tx.tournamentRegistration.update({
        where: { id: reg.id }, data: { status: 'REFUNDED', cancelledAt: new Date() },
      });
      refunded += amount;
    }

    await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'CANCELLED' } });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'TOURNAMENT_CANCELLED', entity: 'Tournament', entityId: tournamentId,
        before: { status: t.status }, after: { status: 'CANCELLED', refundedTotal: refunded },
      },
    });
    return { cancelled: true, registrationsRefunded: regs.length, refundedTotal: refunded };
  }, TX_OPTS);
}

// ---------------------------------------------------------------------------
// My registrations (My Matches page, Phase 6 extends with room credentials)
// ---------------------------------------------------------------------------
export async function myRegistrations(userId: string) {
  const regs = await prisma.tournamentRegistration.findMany({
    where: { userId, status: { in: ['CONFIRMED', 'REFUNDED'] } },
    orderBy: { registeredAt: 'desc' },
    include: {
      tournament: {
        select: {
          id: true, title: true, slug: true, type: true, map: true, status: true,
          startTime: true, registrationDeadline: true, banner: true,
        },
      },
      team: { select: { name: true, tag: true } },
    },
  });
  return regs;
}
