// Authentication + role-based authorization middleware.
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../lib/tokens';
import { forbidden, unauthorized } from '../lib/errors';
import { isLostConnection, isRetryableTxError } from '../lib/tx-conflict';
import type { Role } from '../../generated/prisma';

export interface AuthedUser {
  id: string;
  role: Role;
  username: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthedUser;
    }
  }
}

const loadAccount = (id: string) =>
  prisma.user.findUnique({ where: { id }, select: { id: true, role: true, username: true, status: true } });

/**
 * Requires a valid Bearer access token and a current, active account.
 *
 * Access tokens are intentionally short-lived, but a player can still be
 * suspended or banned while an already-issued token is valid. Never trust the
 * role/status snapshot in that token for a sensitive route: re-read the
 * account and attach the current role and username instead.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized('UNAUTHORIZED', 'Authentication required.'));
  try {
    const payload = verifyAccessToken(token);
    // The account read below is the price of refusing stale bearer tokens (a
    // suspended player must lose access immediately, not at token expiry). Both
    // ways this read can misfire under load — throwing, or coming back blank —
    // are retried once, because a pure read is always safe to repeat and a
    // session must not die (401) or 500 because the pool hiccupped.
    let user: Awaited<ReturnType<typeof loadAccount>>;
    try {
      user = await loadAccount(payload.sub);
      // A blank read here means "this account does not exist", which is also
      // exactly what a torn pooled connection looks like to the caller. A
      // signed, unexpired token must not turn into a forced logout because of
      // infrastructure, so confirm a missing account with one clean re-read
      // before rejecting it. (Suspended/banned accounts are unaffected: the
      // row exists and its status is what rejects them below.)
      if (!user) user = await loadAccount(payload.sub);
    } catch (e) {
      if (!isLostConnection(e) && !isRetryableTxError(e)) throw e;
      user = await loadAccount(payload.sub);
    }
    if (!user || user.status !== 'ACTIVE') {
      return next(unauthorized('UNAUTHORIZED', 'Account is not active.'));
    }
    req.auth = { id: user.id, role: user.role, username: user.username };
    return next();
  } catch (e) {
    return next(e);
  }
}

const RANK: Record<Role, number> = {
  USER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

/** Requires at least the given role (USER < MODERATOR < ADMIN < SUPER_ADMIN). */
export function requireRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized('UNAUTHORIZED', 'Authentication required.'));
    // FAIL CLOSED. This used to be a bare `RANK[req.auth.role] < RANK[min]`.
    // For any role not present in RANK the lookup yields `undefined`, and
    // `undefined < 2` is false in JS — so an unknown or missing role SKIPPED
    // the denial branch and was granted admin access. Resolve both ranks
    // explicitly and reject anything we cannot positively authorise.
    const actual = RANK[req.auth.role];
    const required = RANK[min];
    if (typeof actual !== 'number' || typeof required !== 'number' || actual < required) {
      return next(forbidden('You do not have permission to perform this action.'));
    }
    return next();
  };
}
