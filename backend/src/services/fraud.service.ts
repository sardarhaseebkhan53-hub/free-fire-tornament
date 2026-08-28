// =============================================================================
// Phase 14 — fraud & abuse detection.
//
// Design rules:
//   • DETECTION ONLY. Nothing in this module moves money, changes a status or
//     blocks a request — it writes `FraudAlert` rows for human review in the
//     admin panel. A false positive must never lock a paying player out.
//   • FIRE-AND-FORGET. Every entry point is `void detectX(...)`: a slow or
//     failing check can never turn a deposit into a 500.
//   • NEVER INSIDE A TRANSACTION. Checks run after the caller's transaction
//     commits (they use the global client, which would deadlock the
//     single-writer dev database — the Phase 5 rule).
//   • DEDUPLICATED. One OPEN alert per (kind, subject, fingerprint); repeated
//     events accumulate into the existing alert instead of flooding the queue.
//   • ADMIN-TUNABLE. Every threshold is a `security.*` setting.
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { conflict, notFound } from '../lib/errors';
import { getSetting } from './settings.service';

export type FraudSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Stable alert taxonomy — the admin UI and audits key off these strings. */
export const FRAUD_KINDS = {
  DUPLICATE_TID: 'DUPLICATE_TID',
  REUSED_PROOF: 'REUSED_PROOF',
  DUPLICATE_PROOF: 'DUPLICATE_PROOF',
  DEPOSIT_BURST: 'DEPOSIT_BURST',
  UNUSUAL_DEPOSIT_AMOUNT: 'UNUSUAL_DEPOSIT_AMOUNT',
  WITHDRAWAL_BURST: 'WITHDRAWAL_BURST',
  DEPOSIT_WITHDRAW_CHURN: 'DEPOSIT_WITHDRAW_CHURN',
  NEW_ACCOUNT_WITHDRAWAL: 'NEW_ACCOUNT_WITHDRAWAL',
  SHARED_PAYOUT_ACCOUNT: 'SHARED_PAYOUT_ACCOUNT',
  MULTI_ACCOUNT_REGISTRATION: 'MULTI_ACCOUNT_REGISTRATION',
  CREDENTIAL_STUFFING: 'CREDENTIAL_STUFFING',
  REFRESH_TOKEN_REUSE: 'REFRESH_TOKEN_REUSE',
  REPEATED_JOIN_FAILURES: 'REPEATED_JOIN_FAILURES',
  COUPON_ABUSE: 'COUPON_ABUSE',
  IDENTICAL_RESULT_CLAIMS: 'IDENTICAL_RESULT_CLAIMS',
  HIGH_VALUE_TRANSFER: 'HIGH_VALUE_TRANSFER',
} as const;

export type FraudKind = (typeof FRAUD_KINDS)[keyof typeof FRAUD_KINDS];

export const FRAUD_KIND_LABEL: Record<string, string> = {
  DUPLICATE_TID: 'Deposit transaction ID reused by another account',
  REUSED_PROOF: 'Same payment screenshot submitted by more than one account',
  DUPLICATE_PROOF: 'Same payment screenshot submitted twice by one account',
  DEPOSIT_BURST: 'Deposit burst — many submissions in a short window',
  UNUSUAL_DEPOSIT_AMOUNT: 'Deposit far above this player’s usual amount',
  WITHDRAWAL_BURST: 'Withdrawal burst — many payout requests in a short window',
  DEPOSIT_WITHDRAW_CHURN: 'Funds withdrawn almost immediately after depositing',
  NEW_ACCOUNT_WITHDRAWAL: 'Withdrawal requested by a brand-new account',
  SHARED_PAYOUT_ACCOUNT: 'One payout account used by several players',
  MULTI_ACCOUNT_REGISTRATION: 'Multiple accounts registered from one IP/device',
  CREDENTIAL_STUFFING: 'Repeated failed logins — possible credential stuffing',
  REFRESH_TOKEN_REUSE: 'A rotated refresh token was replayed (possible session theft)',
  REPEATED_JOIN_FAILURES: 'Player keeps hitting full/closed tournaments',
  COUPON_ABUSE: 'Repeated invalid coupon attempts — possible code guessing',
  IDENTICAL_RESULT_CLAIMS: 'Two players submitted identical match results',
  HIGH_VALUE_TRANSFER: 'Wallet transfer at/above the high-value threshold',
};

interface Ctx {
  ip?: string;
  userAgent?: string;
}

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

// ---------------------------------------------------------------------------
// Core writer
// ---------------------------------------------------------------------------

async function enabled(): Promise<boolean> {
  return Boolean(await getSetting('security.fraudDetectionEnabled', true));
}

export interface RaiseInput {
  kind: FraudKind;
  severity: FraudSeverity;
  userId?: string | null;
  /** What the alert is about — user id, deposit id, IP… used for dedupe. */
  subject: string;
  details?: Record<string, unknown>;
}

/**
 * Create (or refresh) an OPEN alert. Returns the alert id, or null when the
 * detector is disabled. Dedupe: same kind + subject + detail fingerprint while
 * still OPEN → occurrences++ instead of a new row.
 */
export async function raiseFraudAlert(input: RaiseInput): Promise<string | null> {
  if (!(await enabled())) return null;

  const fingerprintBase = `${input.kind}|${input.subject}|${JSON.stringify(input.details ?? {})}`;
  const fingerprint = Buffer.from(fingerprintBase).subarray(0, 120).toString('base64url');

  try {
    // Look across the OPEN alerts of this kind (bounded) for the same event —
    // JSON fields can't be indexed, and this keeps the queue one row per event.
    const open = await prisma.fraudAlert.findMany({
      where: { kind: input.kind, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    const match = open.find(
      (a) => (a.details as { fingerprint?: string } | null)?.fingerprint === fingerprint,
    );

    if (match) {
      const details = (match.details ?? {}) as Record<string, unknown>;
      await prisma.fraudAlert.update({
        where: { id: match.id },
        data: {
          severity: input.severity,
          details: {
            ...details,
            ...input.details,
            fingerprint,
            occurrences: Number(details.occurrences ?? 1) + 1,
            lastSeenAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      return match.id;
    }

    const created = await prisma.fraudAlert.create({
      data: {
        kind: input.kind,
        severity: input.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        userId: input.userId ?? null,
        status: 'OPEN',
        details: {
          subject: input.subject,
          fingerprint,
          occurrences: 1,
          ...(input.details ?? {}),
        } as Prisma.InputJsonValue,
      },
    });
    console.warn(`[fraud] ${input.kind} (${input.severity}) — ${input.subject}`);
    return created.id;
  } catch (e) {
    // Detection must never break the request it observes.
    console.error('[fraud] detection failed', input.kind, e);
    return null;
  }
}

/** Wrap a detector so it can be fired without awaiting and never throws. */
function fire(fn: () => Promise<unknown>): void {
  void fn().catch((e) => console.error('[fraud] detector crashed', e));
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

/**
 * Runs after a deposit row is committed.
 * Covers: TID reuse by another account, screenshot reuse (same or other
 * account), submission bursts, and amounts far outside the player's history.
 */
export async function detectDepositFraud(depositId: string, ctx: Ctx = {}): Promise<void> {
  const dep = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: {
      id: true, userId: true, amount: true, method: true, transactionId: true,
      screenshotHash: true, senderAccount: true, createdAt: true,
    },
  });
  if (!dep) return;

  // 1. Same transaction ID submitted by a DIFFERENT account (the unique index
  //    blocks the insert, so this catches the attempt we already rejected).
  const tidClash = await prisma.deposit.findFirst({
    where: { transactionId: dep.transactionId, userId: { not: dep.userId } },
    select: { id: true, userId: true, amount: true, createdAt: true },
  });
  if (tidClash) {
    await raiseFraudAlert({
      kind: 'DUPLICATE_TID',
      severity: 'HIGH',
      userId: dep.userId,
      subject: dep.transactionId,
      details: {
        title: `TID ${dep.transactionId} claimed by more than one account`,
        depositId: dep.id,
        existingDepositId: tidClash.id,
        amount: num(dep.amount),
        method: dep.method,
        ip: ctx.ip,
      },
    });
  }

  // 2. Reused payment proof (identical bytes) — per-account and cross-account.
  if (dep.screenshotHash) {
    const sameImage = await prisma.deposit.findMany({
      where: { screenshotHash: dep.screenshotHash, id: { not: dep.id } },
      select: { id: true, userId: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    const otherAccounts = sameImage.filter((d) => d.userId !== dep.userId);
    if (otherAccounts.length > 0) {
      await raiseFraudAlert({
        kind: 'REUSED_PROOF',
        severity: 'CRITICAL',
        userId: dep.userId,
        subject: dep.screenshotHash,
        details: {
          title: 'One payment screenshot is being used by several accounts',
          depositId: dep.id,
          hash: dep.screenshotHash.slice(0, 16),
          accountsInvolved: otherAccounts.length + 1,
          depositIds: sameImage.map((d) => d.id),
          ip: ctx.ip,
        },
      });
    } else if (sameImage.length > 0) {
      await raiseFraudAlert({
        kind: 'DUPLICATE_PROOF',
        severity: 'HIGH',
        userId: dep.userId,
        subject: `${dep.userId}:${dep.screenshotHash}`,
        details: {
          title: 'The same screenshot was submitted for more than one deposit',
          depositId: dep.id,
          hash: dep.screenshotHash.slice(0, 16),
          earlierDepositIds: sameImage.map((d) => d.id),
          ip: ctx.ip,
        },
      });
    }
  }

  // 3. Submission burst
  const burstMax = Number(await getSetting('security.maxDepositsPerHour', 5));
  const burstWindow = Number(await getSetting('security.depositBurstWindowHours', 1));
  const recent = await prisma.deposit.count({
    where: { userId: dep.userId, createdAt: { gte: hoursAgo(burstWindow) } },
  });
  if (recent > burstMax) {
    await raiseFraudAlert({
      kind: 'DEPOSIT_BURST',
      severity: 'MEDIUM',
      userId: dep.userId,
      subject: dep.userId,
      details: {
        title: `${recent} deposit submissions in the last ${burstWindow}h (limit ${burstMax})`,
        count: recent,
        windowHours: burstWindow,
        latestDepositId: dep.id,
        ip: ctx.ip,
      },
    });
  }

  // 4. Amount far outside this player's own history
  const outlier = Number(await getSetting('security.unusualDepositMultiplier', 5));
  const prior = await prisma.deposit.findMany({
    where: { userId: dep.userId, id: { not: dep.id }, status: { in: ['APPROVED', 'PENDING'] } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { amount: true },
  });
  if (prior.length >= 2) {
    const avg = prior.reduce((s, d) => s + Number(d.amount), 0) / prior.length;
    if (avg > 0 && Number(dep.amount) >= avg * outlier) {
      await raiseFraudAlert({
        kind: 'UNUSUAL_DEPOSIT_AMOUNT',
        severity: 'MEDIUM',
        userId: dep.userId,
        subject: dep.id,
        details: {
          title: `Deposit of PKR ${num(dep.amount)} is ${Math.round(Number(dep.amount) / avg)}× this player's average (PKR ${num(avg)})`,
          amount: num(dep.amount),
          average: num(avg),
          depositId: dep.id,
          ip: ctx.ip,
        },
      });
    }
  }
}

export const fireDepositFraud = (depositId: string, ctx: Ctx = {}) =>
  fire(() => detectDepositFraud(depositId, ctx));

/**
 * A deposit that was REFUSED because another account already claimed the TID.
 * No row is written for it, so the attempt would otherwise be invisible.
 */
export async function detectRejectedDepositTid(
  userId: string,
  transactionId: string,
  existingDepositId: string,
  amount: number,
  ctx: Ctx = {},
): Promise<void> {
  await raiseFraudAlert({
    kind: 'DUPLICATE_TID',
    severity: 'HIGH',
    userId,
    subject: transactionId,
    details: {
      title: `TID ${transactionId} claimed by more than one account`,
      transactionId,
      existingDepositId,
      amount: num(amount),
      ip: ctx.ip,
    },
  });
}

export const fireRejectedDepositTid = (
  userId: string,
  transactionId: string,
  existingDepositId: string,
  amount: number,
  ctx: Ctx = {},
) => fire(() => detectRejectedDepositTid(userId, transactionId, existingDepositId, amount, ctx));

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

export async function detectWithdrawalFraud(withdrawalId: string, ctx: Ctx = {}): Promise<void> {
  const wd = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    select: {
      id: true, userId: true, amount: true, method: true, accountNumber: true,
      accountName: true, createdAt: true,
      user: { select: { id: true, username: true, createdAt: true, isVerified: true } },
    },
  });
  if (!wd) return;

  // 1. Bursts
  const burstMax = Number(await getSetting('security.maxWithdrawalsPerDay', 3));
  const recent = await prisma.withdrawal.count({
    where: { userId: wd.userId, createdAt: { gte: hoursAgo(24) } },
  });
  if (recent > burstMax) {
    await raiseFraudAlert({
      kind: 'WITHDRAWAL_BURST',
      severity: 'MEDIUM',
      userId: wd.userId,
      subject: wd.userId,
      details: {
        title: `${recent} withdrawal requests in 24h (limit ${burstMax})`,
        count: recent,
        windowHours: 24,
        latestWithdrawalId: wd.id,
        ip: ctx.ip,
      },
    });
  }

  // 2. Deposit → immediate withdrawal (classic laundering / stolen-card pattern)
  const churnHours = Number(await getSetting('security.withdrawalChurnHours', 24));
  const depositsInWindow = await prisma.deposit.aggregate({
    where: { userId: wd.userId, status: 'APPROVED', reviewedAt: { gte: hoursAgo(churnHours) } },
    _sum: { amount: true },
    _count: true,
  });
  const deposited = Number(depositsInWindow._sum.amount ?? 0);
  if (depositsInWindow._count > 0 && Number(wd.amount) > 0 && Number(wd.amount) <= deposited) {
    await raiseFraudAlert({
      kind: 'DEPOSIT_WITHDRAW_CHURN',
      severity: 'HIGH',
      userId: wd.userId,
      subject: wd.id,
      details: {
        title: `PKR ${num(wd.amount)} withdrawn within ${churnHours}h of depositing PKR ${num(deposited)}`,
        withdrawalId: wd.id,
        amount: num(wd.amount),
        depositedInWindow: num(deposited),
        windowHours: churnHours,
        ip: ctx.ip,
      },
    });
  }

  // 3. Brand-new accounts cashing out
  const newDays = Number(await getSetting('security.newAccountWithdrawalDays', 1));
  const ageMs = Date.now() - wd.user.createdAt.getTime();
  if (ageMs < newDays * 86_400_000) {
    await raiseFraudAlert({
      kind: 'NEW_ACCOUNT_WITHDRAWAL',
      severity: 'MEDIUM',
      userId: wd.userId,
      subject: wd.id,
      details: {
        title: `Account ${wd.user.username} is ${Math.max(1, Math.round(ageMs / 3_600_000))}h old and requested PKR ${num(wd.amount)}`,
        withdrawalId: wd.id,
        amount: num(wd.amount),
        accountAgeHours: Math.round(ageMs / 3_600_000),
        ip: ctx.ip,
      },
    });
  }

  // 4. One payout account shared by several players
  const shared = await prisma.withdrawal.findMany({
    where: { accountNumber: wd.accountNumber, userId: { not: wd.userId }, status: { not: 'CANCELLED' } },
    select: { userId: true, id: true },
    distinct: ['userId'],
    take: 5,
  });
  if (shared.length > 0) {
    await raiseFraudAlert({
      kind: 'SHARED_PAYOUT_ACCOUNT',
      severity: 'HIGH',
      userId: wd.userId,
      subject: wd.accountNumber,
      details: {
        title: `Payout account ••••${wd.accountNumber.slice(-4)} is used by ${shared.length + 1} different players`,
        withdrawalId: wd.id,
        method: wd.method,
        otherUsers: shared.length,
        ip: ctx.ip,
      },
    });
  }
}

export const fireWithdrawalFraud = (withdrawalId: string, ctx: Ctx = {}) =>
  fire(() => detectWithdrawalFraud(withdrawalId, ctx));

// ---------------------------------------------------------------------------
// Registration & auth
// ---------------------------------------------------------------------------

export async function detectRegistrationFraud(userId: string, ctx: Ctx = {}): Promise<void> {
  if (!ctx.ip) return;
  const windowHours = Number(await getSetting('security.registrationBurstWindowHours', 24));
  const max = Number(await getSetting('security.maxRegistrationsPerIpPerDay', 3));

  const peers = await prisma.authToken.findMany({
    where: { type: 'EMAIL_VERIFICATION', ip: ctx.ip, createdAt: { gte: hoursAgo(windowHours) } },
    select: { userId: true, userAgent: true },
    distinct: ['userId'],
    take: 20,
  });
  if (peers.length <= max) return;

  const sameDevice = peers.filter((p) => p.userAgent && p.userAgent === ctx.userAgent).length;
  await raiseFraudAlert({
    kind: 'MULTI_ACCOUNT_REGISTRATION',
    severity: sameDevice >= max ? 'HIGH' : 'MEDIUM',
    userId,
    subject: ctx.ip,
    details: {
      title: `${peers.length} accounts registered from ${ctx.ip} in ${windowHours}h`,
      ip: ctx.ip,
      accounts: peers.length,
      sameUserAgent: sameDevice,
      windowHours,
    },
  });
}

export const fireRegistrationFraud = (userId: string, ctx: Ctx = {}) =>
  fire(() => detectRegistrationFraud(userId, ctx));

/** Repeated failed logins for one identifier → credential-stuffing alert. */
export async function detectLoginAbuse(
  identifier: string,
  failures: number,
  ctx: Ctx = {},
  userId?: string,
): Promise<void> {
  const threshold = Number(await getSetting('security.credentialStuffingThreshold', 5));
  if (failures < threshold) return;
  await raiseFraudAlert({
    kind: 'CREDENTIAL_STUFFING',
    severity: failures >= threshold * 2 ? 'HIGH' : 'MEDIUM',
    userId: userId ?? null,
    subject: `${identifier}|${ctx.ip ?? 'unknown'}`,
    details: {
      title: `${failures} failed logins for "${identifier}" from ${ctx.ip ?? 'unknown IP'}`,
      identifier,
      failures,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });
}

export const fireLoginAbuse = (identifier: string, failures: number, ctx: Ctx = {}, userId?: string) =>
  fire(() => detectLoginAbuse(identifier, failures, ctx, userId));

/** A rotated (already-revoked) refresh token was replayed. */
export async function detectRefreshReuse(userId: string, ctx: Ctx = {}): Promise<void> {
  await raiseFraudAlert({
    kind: 'REFRESH_TOKEN_REUSE',
    severity: 'CRITICAL',
    userId,
    subject: userId,
    details: {
      title: 'A used refresh token was replayed — sessions for this account should be reviewed',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });
}

export const fireRefreshReuse = (userId: string, ctx: Ctx = {}) => fire(() => detectRefreshReuse(userId, ctx));

// ---------------------------------------------------------------------------
// Tournament engine
// ---------------------------------------------------------------------------

/**
 * Rejected joins: hitting a full/closed tournament repeatedly is either a
 * confused client or a bot probing slot availability.
 */
export async function detectJoinFailure(
  userId: string,
  reason: 'TOURNAMENT_FULL' | 'TOURNAMENT_CLOSED' | 'INSUFFICIENT_BALANCE',
  tournamentSlug: string,
  ctx: Ctx = {},
): Promise<void> {
  if (reason === 'INSUFFICIENT_BALANCE') return; // normal, not suspicious
  const windowHours = Number(await getSetting('security.joinFailureWindowHours', 1));
  const max = Number(await getSetting('security.maxJoinFailuresPerHour', 10));

  const since = hoursAgo(windowHours);
  const attempts = await prisma.auditLog.count({
    where: {
      actorId: userId,
      action: 'TOURNAMENT_JOIN_REJECTED',
      createdAt: { gte: since },
    },
  });
  if (attempts + 1 < max) return;

  await raiseFraudAlert({
    kind: 'REPEATED_JOIN_FAILURES',
    severity: 'LOW',
    userId,
    subject: userId,
    details: {
      title: `${attempts + 1} rejected joins in ${windowHours}h (last: ${reason} on ${tournamentSlug})`,
      attempts: attempts + 1,
      lastReason: reason,
      tournamentSlug,
      ip: ctx.ip,
    },
  });
}

export const fireJoinFailure = (
  userId: string,
  reason: 'TOURNAMENT_FULL' | 'TOURNAMENT_CLOSED' | 'INSUFFICIENT_BALANCE',
  tournamentSlug: string,
  ctx: Ctx = {},
) => fire(() => detectJoinFailure(userId, reason, tournamentSlug, ctx));

/** Coupon code guessing. */
export async function detectCouponAbuse(userId: string, code: string, ctx: Ctx = {}): Promise<void> {
  const windowHours = Number(await getSetting('security.couponAbuseWindowHours', 1));
  const max = Number(await getSetting('security.maxCouponFailuresPerHour', 8));

  const attempts = await prisma.auditLog.count({
    where: { actorId: userId, action: 'COUPON_REJECTED', createdAt: { gte: hoursAgo(windowHours) } },
  });
  if (attempts + 1 < max) return;

  await raiseFraudAlert({
    kind: 'COUPON_ABUSE',
    severity: 'MEDIUM',
    userId,
    subject: userId,
    details: {
      title: `${attempts + 1} invalid coupon attempts in ${windowHours}h (last: ${code})`,
      attempts: attempts + 1,
      lastCode: code,
      ip: ctx.ip,
    },
  });
}

export const fireCouponAbuse = (userId: string, code: string, ctx: Ctx = {}) =>
  fire(() => detectCouponAbuse(userId, code, ctx));

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Two participants of one match filing byte-identical claims. */
export async function detectIdenticalResultClaims(matchId: string, submissionId: string): Promise<void> {
  const mine = await prisma.resultSubmission.findUnique({
    where: { id: submissionId },
    select: { placement: true, kills: true, submittedById: true },
  });
  // Placement-less claims carry no information, so they can match by accident.
  if (!mine || mine.placement === null || mine.kills === null) return;

  const twins = await prisma.resultSubmission.findMany({
    where: {
      matchId,
      id: { not: submissionId },
      submittedById: { not: mine.submittedById },
      placement: mine.placement,
      kills: mine.kills,
    },
    select: { id: true, submittedById: true, createdAt: true },
    take: 3,
  });
  if (twins.length === 0) return;

  await raiseFraudAlert({
    kind: 'IDENTICAL_RESULT_CLAIMS',
    severity: 'MEDIUM',
    userId: mine.submittedById,
    subject: `${matchId}:${mine.placement}:${mine.kills}`,
    details: {
      title: `Identical result claims for one match (placement ${mine.placement}, ${mine.kills} kills)`,
      matchId,
      submissionId,
      twinSubmissionIds: twins.map((t) => t.id),
      placement: mine.placement,
      kills: mine.kills,
    },
  });
}

export const fireIdenticalResultClaims = (matchId: string, submissionId: string) =>
  fire(() => detectIdenticalResultClaims(matchId, submissionId));

// ---------------------------------------------------------------------------
// Admin review queue
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function severityRank(s: string) {
  return SEVERITY_ORDER[s] ?? 4;
}

export async function listFraudAlerts(filter: {
  status?: string;
  severity?: string;
  kind?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.FraudAlertWhereInput = {};
  if (filter.status) where.status = filter.status as 'OPEN' | 'REVIEWED' | 'DISMISSED';
  if (filter.severity) where.severity = filter.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  if (filter.kind) where.kind = filter.kind;

  const [rows, total, counts] = await Promise.all([
    prisma.fraudAlert.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (Math.max(1, filter.page) - 1) * filter.pageSize,
      take: filter.pageSize,
    }),
    prisma.fraudAlert.count({ where }),
    prisma.fraudAlert.groupBy({ by: ['status'], _count: true }),
  ]);

  // FraudAlert stores a bare userId (no FK), so resolve the players separately.
  const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, email: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const sorted = rows.sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.createdAt.getTime() - a.createdAt.getTime(),
  );

  return {
    items: sorted.map((f) => ({
      id: f.id,
      kind: f.kind,
      label: FRAUD_KIND_LABEL[f.kind] ?? f.kind,
      severity: f.severity,
      status: f.status,
      details: f.details,
      user: f.userId ? userById.get(f.userId) ?? null : null,
      reviewedAt: f.reviewedAt,
      createdAt: f.createdAt,
    })),
    page: filter.page,
    pageSize: filter.pageSize,
    total,
    statusCounts: counts.reduce<Record<string, number>>((acc, c) => {
      acc[c.status] = c._count;
      return acc;
    }, {}),
  };
}

export async function reviewFraudAlert(
  adminId: string,
  id: string,
  action: 'REVIEWED' | 'DISMISSED',
  note: string,
  ctx: Ctx = {},
) {
  const alert = await prisma.fraudAlert.findUnique({ where: { id } });
  if (!alert) throw notFound('Fraud alert not found');
  if (alert.status !== 'OPEN') {
    throw conflict('CONFLICT', `This alert was already ${alert.status.toLowerCase()}.`);
  }

  const updated = await prisma.fraudAlert.update({
    where: { id },
    data: {
      status: action,
      reviewedById: adminId,
      reviewedAt: new Date(),
      details: {
        ...((alert.details ?? {}) as Record<string, unknown>),
        reviewNote: note || undefined,
      } as Prisma.InputJsonValue,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: `FRAUD_ALERT_${action}`,
      entity: 'FraudAlert',
      entityId: id,
      before: { status: alert.status },
      after: { status: action, kind: alert.kind, note: note || null },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });

  return {
    id: updated.id,
    kind: updated.kind,
    status: updated.status,
    severity: updated.severity,
    reviewedAt: updated.reviewedAt,
  };
}
