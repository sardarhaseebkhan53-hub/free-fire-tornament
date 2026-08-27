// =============================================================================
// Auth — registration, login, refresh rotation, verification & reset flows.
// RBAC roles: USER < MODERATOR < ADMIN < SUPER_ADMIN (enforced by middleware).
// All secrets server-side; refresh tokens stored hashed & rotated on use.
// =============================================================================
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import {
  ApiError, badRequest, conflict, unauthorized,
} from '../lib/errors';
import {
  findToken, hashToken, issueToken, revokeAllRefreshTokens, revokeToken,
  signAccessToken, type AccessTokenPayload,
} from '../lib/tokens';
import { sendMail, verificationEmail, passwordResetEmail } from './email.service';
import { getSetting } from './settings.service';
import { applyWalletTx } from './wallet.service';
import { fireLoginAbuse, fireRefreshReuse, fireRegistrationFraud } from './fraud.service';
import { audit } from '../lib/security';

/** bcrypt cost — 12 is the current OWASP floor for bcryptjs (≈250ms/hash). */
const BCRYPT_ROUNDS = 12;

const REFRESH_TTL_MS = () => env.JWT_REFRESH_TTL_DAYS * 24 * 3_600_000;
const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 3_600_000;

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
    const reward = await getSetting('referral.rewardAmount', 50);
    await prisma.referralReward.create({
      data: {
        referrerId: referredById,
        referredUserId: user.id,
        rewardAmount: reward,
        qualifyingAction: await getSetting('referral.qualifyingAction', 'FIRST_DEPOSIT_APPROVED'),
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

  return { user, verificationTokenDevOnly: env.NODE_ENV === 'development' ? token : undefined };
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
  return { sent: true, verificationTokenDevOnly: env.NODE_ENV === 'development' ? token : undefined };
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
export async function refreshSession(rawRefresh: string, ctx: RequestContext) {
  const row = await findToken(rawRefresh, 'REFRESH');
  if (!row) {
    // Rotation makes every refresh token single-use, so a token that exists
    // but is already revoked is a REPLAY — treat it as a theft signal.
    const replayed = await prisma.authToken.findFirst({
      where: { tokenHash: hashToken(rawRefresh), type: 'REFRESH', revokedAt: { not: null } },
      select: { userId: true },
    });
    if (replayed) {
      await audit({
        actorId: replayed.userId,
        action: 'REFRESH_TOKEN_REUSED',
        entity: 'AuthToken',
        entityId: null,
        after: { type: 'REFRESH', reason: 'rotated token replayed' },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      fireRefreshReuse(replayed.userId, ctx);
      // Defence in depth: kill every live session for that account.
      await revokeAllRefreshTokens(replayed.userId);
    }
    throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
  }

  // Rotation: old token is single-use.
  await revokeToken(row.id);
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || user.status === 'BANNED' || user.status === 'SUSPENDED') {
    throw unauthorized('UNAUTHORIZED', 'Account is not active.');
  }
  const access = signAccessToken({ sub: user.id, role: user.role, username: user.username });
  const refresh = await issueToken(user.id, 'REFRESH', REFRESH_TTL_MS(), ctx);
  return { accessToken: access, refreshToken: refresh, userId: user.id };
}

export async function logout(rawRefresh?: string) {
  if (rawRefresh) {
    const row = await findToken(rawRefresh, 'REFRESH');
    if (row) await revokeToken(row.id);
  }
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
  return user;
}

// ---------------------------------------------------------------------------
export async function forgotPassword(emailRaw: string, ctx: RequestContext) {
  const email = emailRaw.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Constant-shape response — never reveal account existence.
  if (!user) return { sent: true };
  const token = await issueToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS, ctx);
  await sendMail(passwordResetEmail(email, token));
  return { sent: true, resetTokenDevOnly: env.NODE_ENV === 'development' ? token : undefined };
}

export async function resetPassword(token: string, newPassword: string, ctx: RequestContext = {}) {
  const row = await findToken(token, 'PASSWORD_RESET');
  if (!row) throw badRequest('TOKEN_INVALID', 'Reset link is invalid or has expired.');

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: bcrypt.hashSync(newPassword, BCRYPT_ROUNDS) },
    }),
    prisma.authToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await audit({
    actorId: row.userId,
    action: 'PASSWORD_RESET',
    entity: 'User',
    entityId: row.userId,
    after: { allSessionsRevoked: true },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { reset: true };
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
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: bcrypt.hashSync(newPassword, BCRYPT_ROUNDS) } }),
    prisma.authToken.updateMany({
      where: { userId, type: 'REFRESH', revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await audit({
    actorId: userId,
    action: 'PASSWORD_CHANGED',
    entity: 'User',
    entityId: userId,
    after: { refreshSessionsRevoked: true },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { changed: true };
}

export { hashToken };
export type { AccessTokenPayload };
