// =============================================================================
// Auth — registration, login, refresh rotation, verification & reset flows.
// RBAC roles: USER < MODERATOR < ADMIN < SUPER_ADMIN (enforced by middleware).
// All secrets server-side; refresh tokens stored hashed & rotated on use.
// =============================================================================
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { env, devTokenEchoAllowed } from '../lib/env';
import {
  ApiError, badRequest, conflict, unauthorized,
} from '../lib/errors';
import {
  findToken, hashToken, issueToken, newOpaqueToken, revokeToken,
  signAccessToken, type AccessTokenPayload,
} from '../lib/tokens';
import type { Prisma } from '../../generated/prisma';
import { sendMail, verificationEmail, passwordResetEmail, passwordChangedEmail } from './email.service';
import { getSetting } from './settings.service';
import { applyWalletTx } from './wallet.service';
import { fireLoginAbuse, fireRefreshReuse, fireRegistrationFraud } from './fraud.service';
import { audit, auditIn } from '../lib/security';
import { rankFor } from '../lib/rank';

/** bcrypt cost — 12 is the current OWASP floor for bcryptjs (≈250ms/hash). */
const BCRYPT_ROUNDS = 12;

const REFRESH_TTL_MS = () => env.JWT_REFRESH_TTL_DAYS * 24 * 3_600_000;
const VERIFY_TTL_MS = 24 * 3_600_000;
// Spec §6.7 — password reset links expire in 15–30 minutes. A shorter window
// materially shrinks the exposure of a leaked or intercepted reset email.
const RESET_TTL_MS = 30 * 60_000;

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

// In-memory login lockout. Bounded on purpose: an attacker cannot grow this
// map without bound (old, cold keys are evicted on every write) and the
// per-email budget comes from settings, so it is admin-tunable at runtime.
const attempts = new Map<string, { count: number; lockedUntil: number; at: number }>();
const ATTEMPT_TTL_MS = 60 * 60_000;

function evictStaleAttempts() {
  const cutoff = Date.now() - ATTEMPT_TTL_MS;
  for (const [key, a] of attempts) {
    if (a.at < cutoff) attempts.delete(key);
  }
}

async function checkLockout(key: string) {
  const max = await getSetting('security.maxLoginAttempts', 5);
  const lockMin = await getSetting('security.lockoutMinutes', 15);
  const a = attempts.get(key);
  if (a && a.lockedUntil > Date.now()) {
    const waitMin = Math.ceil((a.lockedUntil - Date.now()) / 60000);
    throw new ApiError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${waitMin} minute(s).`);
  }
  return { max, lockMin };
}

/** Returns the running failure count (and whether a lockout just started). */
function recordFailure(key: string, max: number, lockMin: number): { count: number; locked: boolean } {
  evictStaleAttempts();
  const a = attempts.get(key) ?? { count: 0, lockedUntil: 0, at: Date.now() };
  a.count += 1;
  a.at = Date.now();
  let locked = false;
  if (a.count >= max) {
    a.lockedUntil = Date.now() + lockMin * 60000;
    a.count = 0;
    locked = true;
  }
  attempts.set(key, a);
  return { count: a.count || max, locked };
}

function makeReferralCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet.charAt(crypto.randomInt(alphabet.length));
  return `CLUTCH-${out}`;
}

// ---------------------------------------------------------------------------
export interface RegisterInput {
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  password: string;
  freeFireUID?: string;
  freeFireIGN?: string;
  referralCode?: string;
}

export async function register(input: RegisterInput, ctx: RequestContext) {
  const registrationOpen = await getSetting('platform.registrationOpen', true);
  if (!registrationOpen) {
    throw new ApiError(503, 'FORBIDDEN', 'Registrations are temporarily closed.');
  }

  const email = input.email.toLowerCase();
  const username = input.username.toLowerCase();

  const [byEmail, byUsername, byPhone, byFF] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username } }),
    input.phone ? prisma.user.findUnique({ where: { phone: input.phone } }) : null,
    input.freeFireUID
      ? prisma.userProfile.findUnique({ where: { freeFireUID: input.freeFireUID } })
      : null,
  ]);
  if (byEmail) throw conflict('EMAIL_TAKEN', 'This email is already registered.');
  if (byUsername) throw conflict('USERNAME_TAKEN', 'This username is taken.');
  if (byPhone) throw conflict('PHONE_TAKEN', 'This phone number is already registered.');
  if (byFF) throw conflict('FF_UID_TAKEN', 'This Free Fire UID is linked to another account.');

  let referredById: string | undefined;
  if (input.referralCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: input.referralCode } });
    if (!referrer) throw badRequest('REFERRAL_CODE_INVALID', 'Referral code not found.');
    referredById = referrer.id;
  }

  let referralCode = makeReferralCode();
  while (await prisma.user.findUnique({ where: { referralCode } })) {
    referralCode = makeReferralCode();
  }

  // ACCOUNT ACTIVATION IS AUTOMATIC (spec §Account): a user who completes
  // registration is immediately ACTIVE and can log in right away. The
  // PENDING_VERIFICATION status is reserved for legacy rows only.
  // Email verification (isVerified) is a separate, optional track — it never
  // gates login or account features, and it has NOTHING to do with the manual
  // payment verification flow (deposits are always admin-reviewed).
  const user = await prisma.user.create({
    data: {
      username,
      email,
      phone: input.phone,
      passwordHash: bcrypt.hashSync(input.password, BCRYPT_ROUNDS),
      status: 'ACTIVE',
      referralCode,
      referredById,
      profile: {
        create: {
          fullName: input.fullName,
          freeFireUID: input.freeFireUID,
          freeFireIGN: input.freeFireIGN,
        },
      },
      wallet: { create: {} },
    },
    select: { id: true, username: true, email: true, role: true, referralCode: true },
  });

  if (referredById) {
    // ONE referral reward, admin-tunable: PKR 50 when the referred player's
    // FIRST approved deposit is at least referral.minFirstDeposit (PKR 100).
    // The row stays PENDING until payment.service approves that deposit —
    // crediting is server-side and exactly-once (see referral.service).
    const depositReward = await getSetting('referral.firstDepositReward', 50);
    await prisma.referralReward.create({
      data: {
        referrerId: referredById,
        referredUserId: user.id,
        rewardAmount: depositReward,
        qualifyingAction: 'FIRST_DEPOSIT_APPROVED',
      },
    });
  }

  const token = await issueToken(user.id, 'EMAIL_VERIFICATION', VERIFY_TTL_MS, ctx);
  await sendMail(verificationEmail(email, token));

  await audit({
    actorId: user.id,
    action: 'USER_REGISTERED',
    entity: 'User',
    entityId: user.id,
    after: { username: user.username, email: user.email, referredBy: referredById ?? null },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  // Same IP/device registering many accounts is the classic bonus-farming play.
  fireRegistrationFraud(user.id, ctx);

  return { user, verificationTokenDevOnly: devTokenEchoAllowed ? token : undefined };
}

// ---------------------------------------------------------------------------
export async function verifyEmail(token: string) {
  const row = await findToken(token, 'EMAIL_VERIFICATION');
  if (!row) throw badRequest('TOKEN_INVALID', 'Verification link is invalid or has expired.');

  // Email confirmation only flips the isVerified flag (and any legacy
  // PENDING_VERIFICATION row to ACTIVE). Account activation is NOT gated by
  // this — new accounts are ACTIVE from registration. Payment verification is
  // a completely separate admin flow and is never touched here.
  const user = await prisma.user.update({
    where: { id: row.userId },
    data: { isVerified: true, verifiedAt: new Date(), status: 'ACTIVE' },
    select: { id: true, username: true, email: true },
  });
  await revokeToken(row.id);

  // Welcome bonus (admin-configurable; 0 disables it) — tied to the OPTIONAL
  // email-confirmation track. It is not a payment and never auto-approves one.
  const bonus = await getSetting('wallet.welcomeBonus', 0);
  if (bonus > 0) {
    await applyWalletTx(user.id, 'BONUS', 'CREDIT', bonus, 'BONUS_CREDIT', {
      description: 'Welcome bonus — email confirmed',
    });
  }
  await prisma.notification.create({
    data: {
      userId: user.id,
      type: 'ACCOUNT',
      title: 'Email confirmed 🎉',
      body: bonus > 0
        ? `Thanks for confirming your email! A Rs ${bonus} welcome bonus was added to your bonus balance.`
        : 'Thanks for confirming your email — your account now shows the verified badge.',
    },
  });
  return user;
}

export async function resendVerification(emailRaw: string, ctx: RequestContext) {
  const email = emailRaw.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Do not reveal whether the account exists.
  if (!user || user.isVerified) return { sent: true };
  const token = await issueToken(user.id, 'EMAIL_VERIFICATION', VERIFY_TTL_MS, ctx);
  await sendMail(verificationEmail(email, token));
  return { sent: true, verificationTokenDevOnly: devTokenEchoAllowed ? token : undefined };
}

// ---------------------------------------------------------------------------
export async function login(identifierRaw: string, password: string, ctx: RequestContext) {
  const identifier = identifierRaw.toLowerCase().trim();
  const { max, lockMin } = await checkLockout(identifier);

  const user = await prisma.user.findUnique({
    where: identifier.includes('@') ? { email: identifier } : { username: identifier },
  });
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    const { count, locked } = recordFailure(identifier, max, lockMin);
    // Security events are audited even when they fail: this is the trail that
    // shows a brute-force attempt happened, from where, and against whom.
    await audit({
      actorId: user?.id ?? null,
      action: locked ? 'LOGIN_LOCKOUT' : 'LOGIN_FAILED',
      entity: 'User',
      entityId: user?.id ?? null,
      after: { identifier, failures: count, locked, lockoutMinutes: locked ? lockMin : null },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    fireLoginAbuse(identifier, count, ctx, user?.id);
    throw unauthorized('INVALID_CREDENTIALS', 'Incorrect email/username or password.');
  }
  if (user.status === 'BANNED') {
    throw new ApiError(403, 'ACCOUNT_BANNED', user.banReason ?? 'This account has been banned.');
  }
  if (user.status === 'SUSPENDED') {
    throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
  }

  attempts.delete(identifier);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({
    actorId: user.id,
    action: 'LOGIN_SUCCESS',
    entity: 'User',
    entityId: user.id,
    after: { identifier, role: user.role },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const access = signAccessToken({ sub: user.id, role: user.role, username: user.username });
  const refresh = await issueToken(user.id, 'REFRESH', REFRESH_TTL_MS(), ctx);
  return {
    accessToken: access,
    refreshToken: refresh,
    user: {
      id: user.id, username: user.username, email: user.email,
      role: user.role, isVerified: user.isVerified, status: user.status,
    },
  };
}

// ---------------------------------------------------------------------------
/** Window (ms) during which a replayed, just-rotated refresh token is treated
 * as a benign race (parallel refreshes / multiple tabs) and chained onto its
 * successor instead of being treated as a theft. Overridable for tests. */
export const REFRESH_REUSE_GRACE_MS = 60_000;

export async function refreshSession(
  rawRefresh: string,
  ctx: RequestContext,
  graceMs: number = REFRESH_REUSE_GRACE_MS,
) {
  // Everything happens inside ONE transaction that locks the presented token
  // row (SELECT … FOR UPDATE). Parallel refreshes that race with the same
  // cookie therefore serialize: each sees the previous rotation's committed
  // state and chains onto the successor, so no racer is ever left with a
  // "successor vanished" 401 and no benign race can nuke the session.
  const out = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; userId: string; revokedAt: Date | null; createdAt: Date }>>`
      SELECT "id", "userId", "revokedAt", "createdAt"
      FROM "auth_tokens" WHERE "tokenHash" = ${hashToken(rawRefresh)} AND "type" = 'REFRESH'
      FOR UPDATE
    `;
    const tokenRow = locked[0];
    if (!tokenRow) {
      throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
    }

    // Normal path — the token is still live: rotate it (single-use).
    if (!tokenRow.revokedAt) {
      const live = await tx.authToken.findFirst({
        where: { id: tokenRow.id, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, userId: true },
      });
      if (!live) throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
      await tx.authToken.update({ where: { id: live.id }, data: { revokedAt: new Date() } });
      return rotateRefreshChain(tx, live.userId, ctx);
    }

    // Revoked — either a benign rotation race (parallel refreshes / multiple
    // tabs racing the same single-use cookie) or a genuine replay.
    const revokedRecently = Date.now() - tokenRow.revokedAt.getTime() < graceMs;
    if (revokedRecently) {
      // Chain onto the successor token — the one issued by the refresh that
      // won the race. The FOR UPDATE lock means we see the latest committed
      // state, so the chain never skips a step.
      const successor = await tx.authToken.findFirst({
        where: {
          userId: tokenRow.userId,
          type: 'REFRESH',
          revokedAt: null,
          createdAt: { gt: tokenRow.createdAt },
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (successor) {
        await tx.authToken.update({ where: { id: successor.id }, data: { revokedAt: new Date() } });
        return rotateRefreshChain(tx, successor.userId, ctx);
      }
      // The chain already ended (e.g. the user logged out elsewhere) — this
      // is simply an old cookie, not an attack.
      throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
    }

    // Genuine old replay — treat it as a theft signal. The revocations MUST
    // commit, so the error is thrown AFTER the transaction commits (see the
    // .then below), never inside it — otherwise the rollback would undo the
    // session kill.
    await tx.auditLog.create({
      data: {
        actorId: tokenRow.userId,
        action: 'REFRESH_TOKEN_REUSED',
        entity: 'AuthToken',
        entityId: null,
        after: { type: 'REFRESH', reason: 'rotated token replayed after grace window' },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
    // Defence in depth: kill every live session for that account.
    await tx.authToken.updateMany({
      where: { userId: tokenRow.userId, type: 'REFRESH', revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { __replayed: true, userId: tokenRow.userId };
  });

  const replayed = (out as { __replayed?: boolean }).__replayed;
  if (replayed) {
    fireRefreshReuse((out as { userId: string }).userId, ctx);
    throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
  }
  return out as { accessToken: string; refreshToken: string; userId: string };
}

/** Issue a fresh access + refresh pair inside the ongoing transaction. */
async function rotateRefreshChain(
  tx: Prisma.TransactionClient,
  userId: string,
  ctx: RequestContext,
) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.status === 'BANNED' || user.status === 'SUSPENDED') {
    throw unauthorized('UNAUTHORIZED', 'Account is not active.');
  }
  const access = signAccessToken({ sub: user.id, role: user.role, username: user.username });
  const raw = newOpaqueToken();
  await tx.authToken.create({
    data: {
      userId,
      type: 'REFRESH',
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS()),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });
  return { accessToken: access, refreshToken: raw, userId };
}

export async function logout(rawRefresh?: string) {
  if (!rawRefresh) return;
  // SECURITY: resolve the presented cookie WITHOUT the `revokedAt: null`
  // filter that `findToken` applies.
  //
  // Refresh tokens are single-use and rotate on every refresh, and a replay
  // inside the 60s grace window is deliberately chained onto its successor so
  // parallel refreshes do not destroy the session. That means the cookie a tab
  // is holding is very often ALREADY revoked-but-chainable. Looking it up with
  // `findToken` returned null for exactly those cookies, so logout silently
  // did nothing and the "logged out" cookie could still grace-chain straight
  // back into a live session. Resolve the row by hash alone and revoke the
  // whole account's sessions.
  const row = await prisma.authToken.findFirst({
    where: { tokenHash: hashToken(rawRefresh), type: 'REFRESH' },
    select: { id: true, userId: true },
  });
  if (!row) return;
  // Logout ends the session everywhere: revoke the presented token AND every
  // other live refresh token for the account, so a replay of any sibling
  // cookie (e.g. another tab) can never revive the session via grace-chaining.
  await prisma.authToken.updateMany({
    where: { userId: row.userId, type: 'REFRESH', revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, username: true, email: true, phone: true, role: true, avatar: true,
      status: true, isVerified: true, referralCode: true, createdAt: true, lastLoginAt: true,
      profile: true,
      wallet: {
        select: { cashBalance: true, coinBalance: true, winningBalance: true, bonusBalance: true },
      },
      stats: true,
    },
  });
  if (!user) throw unauthorized('UNAUTHORIZED', 'Account no longer exists.');
  // ZP Battle "Skill-Based Ranking" — derive the player's live tier.
  return { ...user, rankInfo: rankFor(user.stats?.totalPoints ?? 0) };
}

// ---------------------------------------------------------------------------
export async function forgotPassword(emailRaw: string, ctx: RequestContext) {
  const email = emailRaw.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Constant-shape response — never reveal account existence.
  if (!user) return { sent: true };
  const token = await issueToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS, ctx);
  await sendMail(passwordResetEmail(email, token));
  return { sent: true, resetTokenDevOnly: devTokenEchoAllowed ? token : undefined };
}

export async function resetPassword(token: string, newPassword: string, ctx: RequestContext = {}) {
  const row = await findToken(token, 'PASSWORD_RESET');
  if (!row) throw badRequest('TOKEN_INVALID', 'Reset link is invalid or has expired.');

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash: bcrypt.hashSync(newPassword, BCRYPT_ROUNDS) },
    });
    await tx.authToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // PHASE 18 — a credential change that also killed every session must not be
    // provable only by the person who did it. The audit row is written INSIDE
    // the transaction: if it cannot be persisted, the reset rolls back instead
    // of committing an untraceable security event. (The mail alert below stays
    // best-effort on purpose — it is a notification, not a record.)
    await auditIn(tx, {
      actorId: row.userId,
      action: 'PASSWORD_RESET',
      entity: 'User',
      entityId: row.userId,
      after: { allSessionsRevoked: true },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  });
  // Out-of-band security alert (spec §6.17). Best-effort: a mail failure must
  // never make the completed password reset look like it failed.
  const resetUser = await prisma.user.findUnique({
    where: { id: row.userId }, select: { email: true },
  });
  if (resetUser?.email) {
    try {
      await sendMail(passwordChangedEmail(resetUser.email, { ip: ctx.ip }));
    } catch { /* alert is best-effort */ }
  }
  return { reset: true };
}

/** Profile edit (spec §20) — updates/creates the profile row; UID uniqueness enforced. */
export async function updateProfile(
  userId: string,
  input: {
    fullName?: string; freeFireUID?: string | null; freeFireIGN?: string | null;
    city?: string | null; bio?: string | null; showPublicProfile?: boolean;
  },
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, profile: { select: { id: true } } },
  });
  if (!user) throw unauthorized('UNAUTHORIZED', 'Account no longer exists.');

  const data = {
    ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
    ...(input.freeFireUID !== undefined ? { freeFireUID: input.freeFireUID || null } : {}),
    ...(input.freeFireIGN !== undefined ? { freeFireIGN: input.freeFireIGN || null } : {}),
    ...(input.city !== undefined ? { city: input.city || null } : {}),
    ...(input.bio !== undefined ? { bio: input.bio || null } : {}),
    ...(input.showPublicProfile !== undefined ? { showPublicProfile: input.showPublicProfile } : {}),
  };

  try {
    const profile = user.profile
      ? await prisma.userProfile.update({ where: { userId }, data })
      : await prisma.userProfile.create({ data: { userId, fullName: input.fullName ?? user.username, ...data } });
    const updated = await me(userId);
    await audit({ actorId: userId, action: 'PROFILE_UPDATED', entity: 'UserProfile', entityId: profile.id, after: data });
    return updated;
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      throw conflict('FF_UID_TAKEN', 'This Free Fire UID is already linked to another CLUTCHNEX account.');
    }
    throw e;
  }
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, ctx: RequestContext = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    await audit({
      actorId: userId,
      action: 'PASSWORD_CHANGE_FAILED',
      entity: 'User',
      entityId: userId,
      after: { reason: 'current password incorrect' },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw unauthorized('INVALID_CREDENTIALS', 'Current password is incorrect.');
  }
  const hash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    await tx.authToken.updateMany({
      where: { userId, type: 'REFRESH', revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // PHASE 18 — same guarantee as the reset flow: the password change, the
    // session revocation and their audit record are one atomic commit.
    await auditIn(tx, {
      actorId: userId,
      action: 'PASSWORD_CHANGED',
      entity: 'User',
      entityId: userId,
      after: { refreshSessionsRevoked: true },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  });
  if (user.email) {
    try {
      await sendMail(passwordChangedEmail(user.email, { ip: ctx.ip }));
    } catch { /* alert is best-effort */ }
  }
  return { changed: true };
}

export { hashToken };
export type { AccessTokenPayload };
