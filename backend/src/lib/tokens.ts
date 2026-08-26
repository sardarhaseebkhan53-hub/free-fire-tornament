// Token issuing/verification helpers. Secrets stay server-side; only SHA-256
// hashes of opaque tokens are persisted (a DB leak never leaks sessions).
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';
import { env } from './env';
import { unauthorized } from './errors';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  username: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload & jwt.JwtPayload;
    return { sub: decoded.sub, role: decoded.role, username: decoded.username };
  } catch {
    throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
  }
}

export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export function newOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Store a hashed token row; returns the raw token to hand to the user. */
export async function issueToken(
  userId: string,
  type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'REFRESH',
  ttlMs: number,
  ctx?: { ip?: string; userAgent?: string },
): Promise<string> {
  const raw = newOpaqueToken();
  await prisma.authToken.create({
    data: {
      userId,
      type,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ttlMs),
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    },
  });
  return raw;
}

/** Find a live (unexpired, unrevoked) token row by raw value. */
export async function findToken(raw: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'REFRESH') {
  return prisma.authToken.findFirst({
    where: {
      tokenHash: hashToken(raw),
      type,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

export async function revokeToken(id: string) {
  await prisma.authToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function revokeAllRefreshTokens(userId: string) {
  await prisma.authToken.updateMany({
    where: { userId, type: 'REFRESH', revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
