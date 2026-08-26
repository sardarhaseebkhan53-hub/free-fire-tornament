// /api/auth — register, login, refresh rotation, logout, verification, reset.
import { Router, type Request, type Response } from 'express';
import * as svc from '../services/auth.service';
import {
  changePasswordSchema, emailSchema, loginSchema, registerSchema,
  resetPasswordSchema, verifyEmailSchema,
} from '../validation/auth.schema';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';
import { ok } from '../lib/respond';
import { isProd } from '../lib/env';
import type { RequestContext } from '../services/auth.service';

export const REFRESH_COOKIE = 'cn_refresh';

const refreshCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/api/auth',
};

function ctxOf(req: Request): RequestContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
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
  return ok(res, out, 'Account created. Please verify your email.', 201);
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { identifier, password } = loginSchema.parse(req.body);
  const out = await svc.login(identifier, password, ctxOf(req));
  const { refreshToken, ...publicOut } = out;
  setRefreshCookie(res, refreshToken, 7);
  return ok(res, publicOut, 'Logged in successfully');
});

authRouter.post('/refresh', async (req, res) => {
  const raw = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? undefined;
  if (!raw) {
    return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'No session.' });
  }
  const out = await svc.refreshSession(raw, ctxOf(req));
  const { refreshToken, ...rest } = out;
  setRefreshCookie(res, refreshToken, 7);
  return ok(res, rest, 'Session refreshed');
});

authRouter.post('/logout', async (req, res) => {
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

authRouter.post('/resend-verification', async (req, res) => {
  const { email } = emailSchema.parse(req.body);
  const out = await svc.resendVerification(email, ctxOf(req));
  return ok(res, out, 'If the account exists and is unverified, a new link was sent.');
});

authRouter.post('/forgot-password', async (req, res) => {
  const { email } = emailSchema.parse(req.body);
  const out = await svc.forgotPassword(email, ctxOf(req));
  return ok(res, out, 'If the account exists, a reset link was sent.');
});

authRouter.post('/reset-password', async (req, res) => {
  const body = resetPasswordSchema.parse(req.body);
  await svc.resetPassword(body.token, body.password);
  return ok(res, { reset: true }, 'Password updated. Please sign in.');
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const body = changePasswordSchema.parse(req.body);
  await svc.changePassword(req.auth!.id, body.currentPassword, body.password);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
  return ok(res, { changed: true }, 'Password changed. Sign in again on other devices.');
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await svc.me(req.auth!.id);
  return ok(res, user);
});
