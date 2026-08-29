// /api/auth — register, login, refresh rotation, logout, verification, reset.
import { Router, type NextFunction, type Request, type Response } from 'express';
import * as svc from '../services/auth.service';
import {
  changePasswordSchema, emailSchema, loginSchema, registerSchema,
  resetPasswordSchema, updateProfileSchema, verifyEmailSchema,
} from '../validation/auth.schema';
import {
  loginLimiter, passwordResetLimiter, registerLimiter, resendLimiter,
} from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';
import { ok } from '../lib/respond';
import { isProd } from '../lib/env';
import { reqContext } from '../lib/security';
import type { RequestContext } from '../services/auth.service';

export const REFRESH_COOKIE = 'cn_refresh';

const refreshCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/api/auth',
};

function ctxOf(req: Request): RequestContext {
  return reqContext(req);
}

function setRefreshCookie(res: Response, token: string, ttlDays: number) {
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieOptions,
    maxAge: ttlDays * 24 * 3_600_000,
  });
}

export const authRouter = Router();

authRouter.post('/register', registerLimiter, async (req, res) => {
  const body = registerSchema.parse(req.body);
  const { confirmPassword: _omit, ...input } = body;
  const out = await svc.register(input, ctxOf(req));
  return ok(res, out, 'Account created — it is active and ready. You can sign in now.', 201);
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { identifier, password } = loginSchema.parse(req.body);
  const out = await svc.login(identifier, password, ctxOf(req));
  const { refreshToken, ...publicOut } = out;
  setRefreshCookie(res, refreshToken, 7);
  return ok(res, publicOut, 'Logged in successfully');
});

/** Header every first-party client sends on cookie-authenticated calls. */
export const CLIENT_HEADER = 'x-clutchnex-client';

/**
 * CSRF defence for the two cookie-authenticated endpoints (refresh + logout).
 *
 * Everything else is Bearer-token authed, so a cross-site form cannot reach
 * it. These two read an HttpOnly cookie, so they get three independent layers:
 *   1. SameSite=Lax + path=/api/auth → a cross-site POST carries no cookie.
 *   2. CORS pinned to CLIENT_ORIGIN → cross-origin fetch/XHR is refused.
 *   3. This guard → a cross-site request (Sec-Fetch-Site, set by the browser
 *      and not forgeable by script) is refused, and the request must carry our
 *      custom header, which a plain form POST cannot set and a cross-origin
 *      fetch can only set after a CORS preflight that layer 2 rejects.
 */
function csrfGuard(req: Request, res: Response, next: NextFunction) {
  const site = req.headers['sec-fetch-site'];
  const crossSite = site === 'cross-site';
  const firstParty = req.headers[CLIENT_HEADER] !== undefined;

  if (!crossSite && firstParty) return next();

  return res.status(403).json({
    success: false,
    code: 'CSRF_REJECTED',
    message: 'Cross-site request blocked. Please retry from the app.',
  });
}

authRouter.post('/refresh', csrfGuard, async (req, res) => {
  const raw = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? undefined;
  if (!raw) {
    return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'No session.' });
  }
  const out = await svc.refreshSession(raw, ctxOf(req));
  const { refreshToken, ...rest } = out;
  setRefreshCookie(res, refreshToken, 7);
  return ok(res, rest, 'Session refreshed');
});

authRouter.post('/logout', csrfGuard, async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  await svc.logout(raw);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
  return ok(res, { loggedOut: true }, 'Logged out');
});

authRouter.post('/verify-email', async (req, res) => {
  const { token } = verifyEmailSchema.parse(req.body);
  const user = await svc.verifyEmail(token);
  return ok(res, { user }, 'Email verified — welcome to the arena!');
});

authRouter.post('/resend-verification', resendLimiter, async (req, res) => {
  const { email } = emailSchema.parse(req.body);
  const out = await svc.resendVerification(email, ctxOf(req));
  return ok(res, out, 'If the account exists and is unverified, a new link was sent.');
});

authRouter.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  const { email } = emailSchema.parse(req.body);
  const out = await svc.forgotPassword(email, ctxOf(req));
  return ok(res, out, 'If the account exists, a reset link was sent.');
});

authRouter.post('/reset-password', passwordResetLimiter, async (req, res) => {
  const body = resetPasswordSchema.parse(req.body);
  await svc.resetPassword(body.token, body.password, ctxOf(req));
  return ok(res, { reset: true }, 'Password updated. Please sign in.');
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const body = changePasswordSchema.parse(req.body);
  await svc.changePassword(req.auth!.id, body.currentPassword, body.password, ctxOf(req));
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
  return ok(res, { changed: true }, 'Password changed. Sign in again on other devices.');
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await svc.me(req.auth!.id);
  return ok(res, user);
});

// Profile edit (spec §20) — UID/nickname update is also used by the SOLO join flow.
authRouter.put('/profile', requireAuth, async (req, res) => {
  const input = updateProfileSchema.parse(req.body);
  const out = await svc.updateProfile(req.auth!.id, input);
  return ok(res, out, 'Profile updated.');
});
