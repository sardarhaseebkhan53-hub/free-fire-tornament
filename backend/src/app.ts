// Express application wiring — no business logic lives here.
//
// Phase 14 hardening lives in this file:
//   • helmet with an explicit CSP + HSTS/COEP/COOP (the API returns JSON, so
//     it may never render HTML or be framed)
//   • CORS pinned to the configured origin with an explicit allowed-header list
//   • a small JSON body limit (large payloads belong in multipart uploads)
//   • /uploads is split: private user data is NOT statically served, it is only
//     reachable through the owner-or-staff routes
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'node:path';
import { env, isProd } from './lib/env';
import { apiLimiter } from './middleware/rateLimit';
import { fail, ok } from './lib/respond';
import { PRIVATE_UPLOAD_DIRS, UPLOAD_ROOT } from './lib/upload';
import { authRouter } from './routes/auth.routes';
import { publicRouter } from './routes/public.routes';
import { tournamentRouter } from './routes/tournament.routes';
import { teamRouter } from './routes/team.routes';
import { matchRouter } from './routes/match.routes';
import { walletRouter } from './routes/wallet.routes';
import { adminRouter } from './routes/admin.routes';
import { supportRouter } from './routes/support.routes';
import { nexaRouter } from './routes/nexa.routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // One hop: the Next.js proxy (or a single load balancer) sets X-Forwarded-For.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // A JSON API must never execute or render anything.
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false, // screenshots are <img>-loaded by the app
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      // HSTS only when we are actually serving TLS (behind the prod proxy).
      strictTransportSecurity: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      // Payment screenshots must never be sniffed into HTML/script.
      noSniff: true,
      xssFilter: true,
      dnsPrefetchControl: { allow: false },
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      ieNoOpen: true,
    }),
  );

  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-ClutchNex-Client', 'X-Requested-With'],
      maxAge: 600,
    }),
  );

  // Money payloads are tiny; anything bigger is an attack or a misfiled upload.
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) =>
    ok(res, { status: 'ok', service: 'clutchnex-api', time: new Date().toISOString() }),
  );

  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/tournaments', tournamentRouter);
  app.use('/api/teams', teamRouter);
  app.use('/api/matches', matchRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/support', supportRouter);
  app.use('/api/nexa', nexaRouter);
  app.use('/api/admin', adminRouter);

  // Uploaded files. PRIVATE directories (payment proofs, ticket attachments,
  // result screenshots) are deliberately NOT mounted — they are served only by
  // the owner-or-staff routes. Everything else is public demo/marketing art.
  const privateSet = new Set<string>(PRIVATE_UPLOAD_DIRS);
  app.use(
    '/uploads',
    (req, res, next) => {
      const first = decodeURIComponent(req.path).split('/').filter(Boolean)[0] ?? '';
      if (privateSet.has(first)) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN',
          message: 'This file is private — use the authenticated route.',
        });
      }
      return next();
    },
    express.static(UPLOAD_ROOT, {
      fallthrough: false,
      maxAge: '1h',
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      },
    }),
  );

  // 404 for unknown API routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Endpoint not found' });
  });

  // Central error handler — never leaks stack traces, never echoes user input
  // back as HTML (responses are JSON, and helmet already forbids rendering).
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Body-parser rejections arrive as raw HTTP errors.
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large' || e?.status === 413) {
      return res.status(413).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'That request is too large.',
      });
    }
    if (e?.type === 'entity.parse.failed') {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Malformed JSON body.',
      });
    }
    if (isProd === false) console.warn(`[error] ${req.method} ${req.path}`, (err as Error)?.message);
    return fail(res, err);
  });

  return app;
}

export const UPLOAD_MOUNT_ROOT = path.resolve(UPLOAD_ROOT);
