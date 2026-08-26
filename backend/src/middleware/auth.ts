// Authentication + role-based authorization middleware.
import type { NextFunction, Request, Response } from 'express';
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

/** Requires a valid Bearer access token; attaches req.auth. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized('UNAUTHORIZED', 'Authentication required.'));
  try {
    const payload = verifyAccessToken(token);
    req.auth = { id: payload.sub, role: payload.role as Role, username: payload.username };
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
