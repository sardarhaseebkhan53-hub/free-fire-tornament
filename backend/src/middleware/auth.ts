// Authentication + role-based authorization middleware.
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../lib/tokens';
import { forbidden, unauthorized } from '../lib/errors';
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
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, username: true, status: true },
    });
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
    if (RANK[req.auth.role] < RANK[min]) {
      return next(forbidden('You do not have permission to perform this action.'));
    }
    return next();
  };
}
