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
import { moneyTx, prisma } from '../lib/prisma';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { getSetting } from './settings.service';
import { fireCouponAbuse, fireJoinFailure } from './fraud.service';
import { audit } from '../lib/security';
import { moveBalance } from './wallet.service';
import { confirmAbsent, isRetryableTxError, withIdempotentRetry } from '../lib/tx-conflict';

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
  /** Required for SOLO and independently-registered team modes (DUO/SQUAD) — verified at join, synced to the profile. */
  freeFireUID?: string;
  freeFireIGN?: string;
}

export interface ActorCtx { ip?: string; userAgent?: string }

/** Profile completeness for tournament play: UID (digits) + IGN (2-24 chars). */
function validateFFIdentity(uidRaw?: string, ignRaw?: string): { uid: string; ign: string } {
  const uid = (uidRaw ?? '').trim();
  const ign = (ignRaw ?? '').trim();
  if (!/^\d{5,15}$/.test(uid)) {
    throw badRequest('VALIDATION_ERROR', 'A valid Free Fire UID (5-15 digits) is required to join. Update it in your profile.');
  }
  if (ign.length < 2 || ign.length > 24) {
    throw badRequest('VALIDATION_ERROR', 'Your Free Fire nickname (2-24 characters) is required to join.');
  }
  return { uid, ign };
}

/**
 * PHASE 18 — the entry point is wrapped in a transient-conflict retry, not just
 * the join transaction. The inner `runJoinWithRetry` only covers the financial
 * transaction itself, while the preflight reads (account, tournament, profile,
 * settings) run before it — and on the embedded single-writer database (and on
 * a real one, on 40001/40P01) a read can also fail with a transport-level
 * error. Those attempts have written nothing at all, so re-running is safe;
 * without this a player under load sees a 500 instead of a clean result.
 */
export async function joinTournament(userId: string, input: JoinInput, actorIp?: string, actorUa?: string) {
  return withIdempotentRetry(
    () => joinTournamentOnce(userId, input, actorIp, actorUa),
    {
      attempts: 2,
      busyMessage: 'The arena is busy right now. Your entry fee was not charged — please try again.',
    },
  );
}

async function joinTournamentOnce(userId: string, input: JoinInput, actorIp?: string, actorUa?: string) {
  const actor: ActorCtx = { ip: actorIp, userAgent: actorUa };
  // PHASE 18 — a missing tournament or account is confirmed by a second read
  // before it becomes a refusal. A 100-way join burst produced one "Tournament
  // not found" for an event that was on the player's screen: a blank read is
  // indistinguishable from a missing row, and getting it wrong sends a player to
  // their wallet to re-deposit an entry fee that was never due. A stale *positive*
  // is still harmless: the seat is taken by a conditional UPDATE that re-asserts
  // status, deadline and capacity inside the transaction, so nothing here can
  // book a seat that no longer exists.
  const t = await confirmAbsent(() =>
    prisma.tournament.findFirst({ where: { slug: input.tournamentSlug, deletedAt: null } }),
  );
  if (!t || t.status === 'DRAFT') throw notFound('Tournament not found');

  const user = await confirmAbsent(() => prisma.user.findUnique({ where: { id: userId } }));
  if (!user) throw notFound('Account not found');
  if (user.status !== 'ACTIVE') throw forbidden('Account is not active.');
  if (!user.isVerified) throw forbidden('Verify your email before joining tournaments.');

  if (t.status !== 'REGISTRATION_OPEN') throw badRequest('TOURNAMENT_CLOSED', 'Registration is not open for this tournament.');
  if (t.registrationDeadline <= new Date()) throw badRequest('TOURNAMENT_CLOSED', 'Registration deadline has passed.');
  // Guard the start time too. Only the deadline was checked, so a tournament
  // whose start time had already elapsed (but whose deadline was still ticking)
  // stayed joinable — the "closes in 00:03:45 / starts in Now" state.
  if (t.startTime <= new Date()) throw badRequest('TOURNAMENT_CLOSED', 'This tournament has already started.');

  const teamSize = TEAM_SIZE[t.type];
  const feePerPlayer = Number(t.entryFeePerPlayer);

  // Resolve settings BEFORE opening the transaction: reading them inside would
  // use the global client and deadlock the single-writer embedded database.
  const currency = await getSetting('platform.currency', 'PKR');
  const allowIndependentDuo = await getSetting('tournament.allowIndependentDuo', false);
  const allowIndependentSquad = await getSetting('tournament.allowIndependentSquad', false);

  // --- identity requirement -------------------------------------------------
  // SOLO: the joining player must confirm UID + nickname at join time.
  // DUO/SQUAD: every team member needs a saved UID + nickname (profile), unless
  // the platform opt-in lets a team-player register alone and be admin-paired.
  // Independent DUO (admin opt-in): same as SOLO — no team required.
  // Independent SQUAD / Clash Squad (admin opt-in): same path.
  const isTeamJoin = teamSize > 1 && !!input.teamId;
  const isIndependentDuo = t.type === 'DUO' && !input.teamId && allowIndependentDuo === true && teamSize === 2;
  const isIndependentSquad = (t.type === 'SQUAD' || t.type === 'CLASH_SQUAD') && !input.teamId && allowIndependentSquad === true && teamSize === 4;
  const isIndependentTeam = isIndependentDuo || isIndependentSquad;
  // A team mode without a team is only valid when the admin opt-in for that
  // mode is enabled. Never let the backend silently register one player in a
  // DUO/SQUAD event.
  if (teamSize > 1 && !input.teamId && !isIndependentTeam) {
    throw badRequest('VALIDATION_ERROR', `A ${teamSize === 2 ? 'duo' : 'squad'} team is required to register for this tournament.`);
  }
  if (teamSize === 1 || isIndependentTeam) {
    // Join-time identity confirmation: values sent by the client win, but the
    // saved profile is the fallback, so a player who already saved their UID/
    // nickname can still join without retyping it (the UI prefills both).
    // Same rule as every other read that gates a refusal: a blank result is
    // confirmed before it becomes "complete your profile", because a player who
    // HAS saved a UID must not be told they haven't.
    const saved = await confirmAbsent(() =>
      prisma.userProfile.findUnique({ where: { userId }, select: { freeFireUID: true, freeFireIGN: true } }),
    );
    const identity = validateFFIdentity(input.freeFireUID ?? saved?.freeFireUID ?? undefined, input.freeFireIGN ?? saved?.freeFireIGN ?? undefined);
    try {
      await prisma.userProfile.upsert({
        where: { userId },
        create: { userId, fullName: user.username, freeFireUID: identity.uid, freeFireIGN: identity.ign },
        update: { freeFireUID: identity.uid, freeFireIGN: identity.ign },
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'P2002') {
        throw badRequest('VALIDATION_ERROR', 'This Free Fire UID is already linked to another CLUTCHNEX account.');
      }
      throw e;
    }
  }

  // Resolve who is paying: solo = the player; team modes = every member pays
  // their own share (the captain triggers the join on behalf of the team).
  let payerIds: string[] = [userId];
  let flowTeamSize = teamSize;
  if (isTeamJoin) {
    const team = await prisma.team.findUnique({
      where: { id: input.teamId },
      include: { members: { select: { userId: true, user: { select: { status: true, isVerified: true } } } } },
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
    for (const member of team.members) {
      if (member.user.status !== 'ACTIVE' || !member.user.isVerified) {
        throw forbidden('Every team member must have an active, verified account.');
      }
    }
    // Every member must have their Free Fire identity saved.
    const profiles = await prisma.userProfile.findMany({
      where: { userId: { in: team.members.map((m) => m.userId) } },
      select: { userId: true, freeFireUID: true, freeFireIGN: true },
    });
    for (const member of team.members) {
      const profile = profiles.find((p) => p.userId === member.userId);
      if (!profile?.freeFireUID || !profile.freeFireIGN) {
        throw badRequest('VALIDATION_ERROR', `Every team member must set their Free Fire UID and nickname in Profile before the team can register (member ${member.userId.slice(0, 6)}…).`);
      }
    }
    payerIds = team.members.map((m) => m.userId);
  } else if (isIndependentTeam) {
    flowTeamSize = 1; // paid + seated independently; admin pairs later
  }

  try {
    return await runJoinWithRetry(userId, input, t, feePerPlayer, currency, payerIds, flowTeamSize, actor, isIndependentTeam);
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

/**
 * Runs the join transaction, retrying only on transient write conflicts
 * (P2034 / P2039 / 40001 / 40P01 — see `src/lib/tx-conflict.ts`, which is the
 * single classifier shared by the join, withdrawal and transfer paths). Those
 * codes are NOT business rejections: they mean "two writers touched the same
 * rows and this attempt lost", and the whole transaction rolled back, so no
 * seat was taken and no money moved. Without the retry a player racing others
 * for the last seats saw a raw database code leak straight into the UI.
 */
async function runJoinWithRetry(
  ...args: Parameters<typeof runJoin>
): Promise<Awaited<ReturnType<typeof runJoin>>> {
  const MAX_ATTEMPTS = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await runJoin(...args);
    } catch (e) {
      // Business rejections (full, closed, already registered, no funds) are
      // final — never retry those, only genuine contention.
      if (e instanceof ApiError || !isRetryableTxError(e)) throw e;
      lastError = e;
      // Small jittered backoff so retrying callers do not resynchronise.
      await new Promise((r) => setTimeout(r, 15 * attempt + Math.random() * 20));
    }
  }
  // Exhausted retries under sustained contention: report it as a full/closed
  // style conflict rather than leaking an internal database code.
  throw conflict('CONFLICT', 'The tournament is being updated by other players. Please try again.');
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
  independentTeam = false,
) {
  const actorIp = actor.ip;
  // PHASE 18 — the roster this paid seat is locked to. Captured from the
  // LOCKED re-read below (never from the preflight snapshot), so what the
  // players paid for and what prize distribution later pays out can never
  // drift apart. Null for solo/independent entries, which pay by userId.
  let rosterSnapshot: string[] | null = null;
  return moneyTx(async (tx) => {
    // Re-read and lock the roster after the preflight checks. A captain could
    // otherwise remove a member between validation and charging the team.
    if (input.teamId && teamSize > 1) {
      await tx.$queryRaw`SELECT "id" FROM "teams" WHERE "id" = ${input.teamId} FOR UPDATE`;
      const currentTeam = await tx.team.findUnique({
        where: { id: input.teamId },
        include: { members: { select: { userId: true, user: { select: { status: true, isVerified: true } } } } },
      });
      if (!currentTeam || currentTeam.captainId !== userId || currentTeam.type !== (t.type === 'DUO' ? 'DUO' : 'SQUAD')) {
        throw forbidden('The selected team changed. Refresh and try again.');
      }
      if (currentTeam.members.length !== teamSize) {
        throw badRequest('VALIDATION_ERROR', `Team must have exactly ${teamSize} members.`);
      }
      for (const member of currentTeam.members) {
        if (member.user.status !== 'ACTIVE' || !member.user.isVerified) {
          throw forbidden('Every team member must have an active, verified account.');
        }
      }
      const currentIds = currentTeam.members.map((member) => member.userId).sort();
      const requestedIds = [...payerIds].sort();
      if (currentIds.length !== requestedIds.length || currentIds.some((id, i) => id !== requestedIds[i])) {
        throw conflict('CONFLICT', 'The team roster changed. Refresh and try again.');
      }
      // Frozen here: the same ids that are about to be charged.
      rosterSnapshot = currentIds;
    }

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
    // `UPDATE ... RETURNING` is serialized by the row lock (held for the rest
    // of the transaction), so every successful join receives the exact next
    // seat number; two concurrent joins can never observe the same value.
    // Admin-controlled seats (manual assigns, locks) are respected: the
    // smallest free seat 1..maxSlots is chosen, so the board always stays
    // collision-free even when an admin moved players around.
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
    // Row lock is held from the UPDATE above → safe to scan seats here.
    const occupied = await tx.tournamentRegistration.findMany({
      where: { tournamentId: t.id, status: 'CONFIRMED', seatNumber: { not: null } },
      select: { seatNumber: true, slotLocked: true },
    });
    const taken = new Set<number>();
    const lockedSeats = new Set<number>();
    for (const o of occupied) {
      if (o.seatNumber !== null) taken.add(o.seatNumber);
      if (o.slotLocked && o.seatNumber !== null) lockedSeats.add(o.seatNumber);
    }
    let seatNumber: number | null = null;
    for (let s = 1; s <= t.maxSlots; s++) {
      if (!taken.has(s)) { seatNumber = s; break; }
    }
    if (seatNumber === null) {
      throw badRequest('TOURNAMENT_FULL', 'This tournament is full.');
    }

    // 3. Coupon (applies to the joining player's share)
    let discount = 0;
    let couponId: string | undefined;
    if (input.couponCode) {
      const coupon = await tx.coupon.findUnique({ where: { code: input.couponCode.trim().toUpperCase() } });
      if (!coupon || coupon.status !== 'ACTIVE') throw badRequest('VALIDATION_ERROR', 'Coupon not found or inactive');
      if (coupon.startsAt > new Date()) throw badRequest('VALIDATION_ERROR', 'Coupon is not active yet');
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

      const ledgerEntry = await moveBalance(
        tx,
        pid,
        'CASH',
        'DEBIT',
        payable,
        'ENTRY_FEE',
        {
          entityType: 'TournamentRegistration',
          reference: t.slug,
          description: `Entry — ${t.title}`,
        },
        currency,
      );

      // Upsert, not create. `(tournamentId, userId)` is unique, and a
      // cancelled/refunded entry KEEPS its row (status REFUNDED) — so a player
      // who cancelled and wanted back in hit a raw P2002 unique-constraint
      // crash and was permanently locked out of the tournament. Re-registering
      // revives that row and clears the previous cancellation/refund state.
      const regData = {
        teamId: teamSize > 1 && input.teamId ? input.teamId : null,
        entryAmount: new Prisma.Decimal(payable),
        discount: new Prisma.Decimal(isJoiner ? discount : 0),
        couponId: isJoiner ? couponId : null,
        walletTxId: ledgerEntry.id,
        seatNumber,
        // PHASE 18 — immutable paid roster. Every member row of one team entry
        // carries the identical sorted id list, so any of them can be used to
        // reconstruct exactly who the prize money belongs to.
        ...(rosterSnapshot
          ? {
              rosterUserIds: rosterSnapshot as unknown as Prisma.InputJsonValue,
              rosterCapturedAt: new Date(),
            }
          : {}),
      };
      const reg = await tx.tournamentRegistration.upsert({
        where: { tournamentId_userId: { tournamentId: t.id, userId: pid } },
        create: { tournamentId: t.id, userId: pid, ...regData },
        update: {
          ...regData,
          status: 'CONFIRMED',
          cancelledAt: null,
          refundWalletTxId: null,
          slotLocked: false,
          registeredAt: new Date(),
        },
      });
      if (isJoiner && couponId) {
        await tx.couponRedemption.create({
          data: { couponId, userId, registrationId: reg.id, discountAmount: new Prisma.Decimal(discount) },
        });
      }

      await tx.notification.create({
        data: {
          userId: pid, type: 'TOURNAMENT_JOINED',
          title: `You joined ${t.title}`,
          body: `Entry ${currency} ${payable} deducted. Your ${independentTeam ? 'standalone ' : teamSize > 1 ? 'team ' : ''}seat is #${seatNumber}. Room details unlock 30 minutes before start — see My Matches.`,
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
  const t = await prisma.tournament.findFirst({ where: { slug: tournamentSlug, deletedAt: null } });
  if (!t) throw notFound('Tournament not found');

  // Hoisted out of the transaction — settings reads use the global client and
  // would deadlock the embedded single-writer database if performed in tx.
  const currency = await getSetting('platform.currency', 'PKR');

  return moneyTx(async (tx) => {
    // Serialize cancellation against joins and other cancellations for this
    // tournament. The registration rows and wallet rows are then claimed and
    // changed in one atomic unit; a retry cannot issue a second refund.
    await tx.$queryRaw`SELECT "id" FROM "tournaments" WHERE "id" = ${t.id} FOR UPDATE`;
    const current = await tx.tournament.findUnique({ where: { id: t.id } });
    if (!current) throw notFound('Tournament not found');
    if (!['REGISTRATION_OPEN', 'LIVE'].includes(current.status)) {
      throw badRequest('TOURNAMENT_CLOSED', 'This tournament can no longer be cancelled from your side.');
    }
    if (current.status === 'REGISTRATION_OPEN' && current.registrationDeadline <= new Date()) {
      throw badRequest('TOURNAMENT_CLOSED', 'Registration deadline passed — cancellation is handled by support.');
    }

    const mine = await tx.tournamentRegistration.findUnique({
      where: { tournamentId_userId: { tournamentId: current.id, userId } },
      include: { team: true },
    });
    if (!mine || mine.status !== 'CONFIRMED') throw notFound('No confirmed registration found.');

    const teamSize = TEAM_SIZE[current.type];
    const isTeam = teamSize > 1 && mine.teamId !== null;
    if (isTeam && mine.team?.captainId !== userId) {
      throw forbidden('Only the team captain can cancel a team registration.');
    }

    const targets = isTeam
      ? await tx.tournamentRegistration.findMany({
          where: { tournamentId: current.id, teamId: mine.teamId, status: 'CONFIRMED' },
          orderBy: { userId: 'asc' },
        })
      : [mine];
    if (targets.length === 0) throw notFound('No confirmed registration found.');

    const refundPercent = Number(current.refundPercent) / 100;
    let refundedTotal = 0;
    for (const reg of targets) {
      const refundAmount = Math.round(Number(reg.entryAmount) * refundPercent * 100) / 100;
      let refundWalletTxId: string | undefined;
      if (refundAmount > 0) {
        const entry = await moveBalance(
          tx,
          reg.userId,
          'CASH',
          'CREDIT',
          refundAmount,
          'ENTRY_REFUND',
          {
            entityType: 'TournamentRegistration',
            entityId: reg.id,
            description: `Refund (${Math.round(refundPercent * 100)}%) — ${current.title}`,
          },
          currency,
        );
        refundWalletTxId = entry.id;
      }

      await tx.tournamentRegistration.update({
        where: { id: reg.id },
        data: { status: 'REFUNDED', cancelledAt: new Date(), refundWalletTxId },
      });
      await tx.notification.create({
        data: {
          userId: reg.userId, type: 'TOURNAMENT_UPDATE',
          title: `Registration cancelled — ${current.title}`,
          body: `Refund of ${currency} ${refundAmount} credited to your cash balance.`,
        },
      });
      refundedTotal += refundAmount;
    }

    await tx.tournament.update({
      where: { id: current.id },
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
  // Keep the legacy service entry point on the same compare-and-set,
  // transactional cancellation path used by the admin route.
  const { setTournamentStatus } = await import('./admin.service');
  return setTournamentStatus(adminId, tournamentId, 'CANCELLED', {});
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
