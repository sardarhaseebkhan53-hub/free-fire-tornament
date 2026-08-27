// =============================================================================
// Rate limiting — per-route budgets (express-rate-limit behind the proxies).
//
// Phase 14 tightened these into three tiers:
//   • global     — a generous ceiling that only stops scraping/DoS
//   • identity   — auth, password reset, verification (account takeover)
//   • financial  — deposits, withdrawals, joins, coupons (money movement)
// Keys are per-IP by default; the financial limiters also key per-USER so one
// shared NAT (a whole hostel on one IP) can't be locked out by a single player.
// =============================================================================
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../lib/env';

const JSON_LIMIT = { success: false, code: 'RATE_LIMITED' } as const;

/** Consistent 429 body + draft-8 headers (Retry-After included). */
const base = {
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
};

const message = (text: string) => ({ ...JSON_LIMIT, message: text });

/** Global ceiling — anti-scrape/DoS only. Sensitive routes have their own. */
export const apiLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: env.RATE_LIMIT_PER_WINDOW,
  message: message('Too many requests — slow down.'),
});

// --- Identity tier -----------------------------------------------------------

export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 10,
  message: message('Too many login attempts. Try again in 15 minutes.'),
});

export const registerLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60_000,
  limit: 5,
  message: message('Too many accounts created from this network.'),
});

/** Password reset — email bombing + token-guessing defence. */
export const passwordResetLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 5,
  message: message('Too many password-reset requests. Try again in 15 minutes.'),
});

/** Verification resends — same abuse class as reset. */
export const resendLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 5,
  message: message('Too many verification emails requested. Try again shortly.'),
});

// --- Financial tier (keyed per user when authed, else per IP) ----------------

/** Money endpoints: one player hammering from a shared IP must not lock the IP. */
const userOrIp = (req: Request) =>
  req.auth?.id ? `user:${req.auth.id}` : ipKeyGenerator(req.ip ?? 'unknown');

export const depositLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60_000,
  limit: 10,
  keyGenerator: userOrIp,
  message: message('Too many deposit submissions this hour — one at a time, please.'),
});

export const withdrawalLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60_000,
  limit: 6,
  keyGenerator: userOrIp,
  message: message('Too many withdrawal requests this hour.'),
});

export const joinLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 30,
  keyGenerator: userOrIp,
  message: message('Too many join attempts — please wait a moment.'),
});

export const couponLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 15,
  keyGenerator: userOrIp,
  message: message('Too many coupon checks — stop guessing codes.'),
});

export const coinConvertLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60_000,
  limit: 20,
  keyGenerator: userOrIp,
  message: message('Too many conversions this hour.'),
});

// --- Content/support tier ----------------------------------------------------

export const ticketCreateLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60_000,
  limit: 10,
  message: message('Too many tickets created — please reply on an existing one.'),
});

export const nexaLimiter = rateLimit({
  ...base,
  windowMs: 5 * 60_000,
  limit: 20,
  message: message('NEXA needs a breath — try again in a few minutes.'),
});

/** Admin writes are rare by nature; a burst means a leaked admin token. */
export const adminWriteLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 240,
  message: message('Too many admin actions — slow down.'),
});
