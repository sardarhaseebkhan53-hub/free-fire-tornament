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
import { prisma } from './lib/prisma';
import { authRouter } from './routes/auth.routes';
import { publicRouter } from './routes/public.routes';
import { tournamentRouter } from './routes/tournament.routes';
import { teamRouter } from './routes/team.routes';
import { matchRouter } from './routes/match.routes';
import { walletRouter } from './routes/wallet.routes';
import { adminRouter } from './routes/admin.routes';
import { supportRouter } from './routes/support.routes';
import { nexaRouter } from './routes/nexa.routes';
import { notificationRouter } from './routes/notification.routes';
import { pushRouter } from './routes/push.routes';

/**
 * One shape for `req.body`, whatever the client did to it.
 *
 * Every route parses `req.body` with zod, and zod expects an OBJECT. Two client
 * mistakes used to defeat that before a single handler ran:
 *
 *   1. a double-serialised payload — the body is a JSON *string* that itself
 *      contains JSON (`"{\"roomId\":\"123\"}"`). Valid JSON, wrong nesting.
 *   2. an object handed straight to `fetch()` without `JSON.stringify`, which
 *      the browser sends as the literal text `[object Object]`.
 *
 * (1) is recoverable, so we unwrap it once and let the route validate normally —
 * the admin room panel, and later the Flutter app, cannot lose a save to it.
 * (2) is not recoverable, but it deserves an answer that names the problem
 * rather than the generic "Malformed JSON body" that sent us hunting.
 */
export function normalizeJsonBody(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const body: unknown = req.body;
  if (body === undefined || body === null) return next();

  if (typeof body === 'string') {
    const raw = body.trim();
    // A JSON body of `""` means the client sent nothing meaningful.
    if (raw === '') {
      req.body = {};
      return next();
    }
    try {
      const unwrapped: unknown = JSON.parse(raw);
      if (unwrapped !== null && typeof unwrapped === 'object') {
        req.body = unwrapped;
        return next();
      }
    } catch {
      /* not JSON-in-a-string — fall through to the honest error below */
    }
    res.status(400).json({
      success: false,
      code: 'MALFORMED_JSON',
      message:
        'The request body arrived as text, not as a JSON object. Send the payload once — `JSON.stringify(payload)`, not a stringified string.',
    });
    return;
  }

  if (typeof body !== 'object') {
    res.status(400).json({
      success: false,
      code: 'MALFORMED_JSON',
      message: 'The request body must be a JSON object.',
    });
    return;
  }

  return next();
}

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
  //
  // `strict: false` is deliberate, and it is NOT a loosening of validation.
  // body-parser's strict mode rejects any top-level JSON value that is not an
  // object/array with `entity.parse.failed` — the SAME error class as genuinely
  // broken bytes — so a client that double-serialised its payload
  //   JSON.stringify(JSON.stringify({ roomId: '123' }))  →  "\"{\\\"roomId\\\"...}\""
  // got the useless answer "Malformed JSON body" even though the JSON was
  // perfectly valid. That is exactly what the admin room panel hit. We now
  // accept the value, unwrap it in `normalizeJsonBody` below, and every route's
  // zod schema still has the final say on the shape.
  //
  // `verify` keeps a short prefix of the raw bytes so the error handler can say
  // WHAT arrived (dev only) instead of leaving an admin staring at a 400.
  app.use(
    express.json({
      limit: '256kb',
      strict: false,
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBodyPreview?: string }).rawBodyPreview = buf
          .subarray(0, 120)
          .toString('utf8');
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(normalizeJsonBody);
  app.use(cookieParser());
  // HEALTH CHECK — mounted BEFORE the rate limiter on purpose. Load balancers,
  // uptime monitors and container orchestrators probe this endpoint from a
  // small number of IPs, several times a minute, forever. Behind `apiLimiter`
  // those probes eventually consume the shared per-IP budget and the platform
  // starts receiving 429s for its own health checks — which reads as an
  // unhealthy service and triggers restarts. It performs a real dependency
  // check (a trivial DB round-trip) but never leaks connection details.
  app.get('/api/health', async (_req, res) => {
    const body = { status: 'ok', service: 'clutchnex-api', time: new Date().toISOString() };
    try {
      await prisma.$queryRaw`SELECT 1`;
      return ok(res, { ...body, database: 'up' });
    } catch {
      // 503 so orchestrators can act on it; no driver message is echoed back.
      return res.status(503).json({
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service dependencies are unavailable.',
      });
    }
  });

  app.use('/api', apiLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/tournaments', tournamentRouter);
  app.use('/api/teams', teamRouter);
  app.use('/api/matches', matchRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/support', supportRouter);
  app.use('/api/nexa', nexaRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/push', pushRouter);

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
    // Body-parser rejections arrive as raw HTTP errors. These get their OWN
    // codes (not VALIDATION_ERROR) so a client can tell "the request itself was
    // broken" apart from "the values failed a rule" — the room panel surfaces a
    // meaningful message instead of hiding every 400 behind "Malformed JSON body".
    const e = err as { type?: string; status?: number; code?: string; message?: string };
    if (e?.type === 'entity.too.large' || e?.status === 413) {
      return res.status(413).json({
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'That request is too large.',
      });
    }
    if (e?.type === 'entity.parse.failed') {
      // Dev gets to SEE what arrived — a 400 with no evidence is what turned a
      // one-line client bug into an afternoon of guessing. Never in production:
      // the preview could echo a credential back into a log.
      const preview = (req as express.Request & { rawBodyPreview?: string }).rawBodyPreview;
      const hint =
        preview && preview.trimStart().startsWith('[object')
          ? ' The client sent an object to fetch() without JSON.stringify().'
          : '';
      return res.status(400).json({
        success: false,
        code: 'MALFORMED_JSON',
        message: `Malformed JSON body — the request payload was not valid JSON.${hint}`,
        ...(isProd || !preview ? {} : { received: preview }),
      });
    }
    // express.static({ fallthrough: false }) forwards ENOENT as a raw error —
    // a missing file must read as 404, never as a 500. Only raw static errors
    // (code ENOENT) are matched here; ApiError 404s keep their own message.
    if (e?.code === 'ENOENT' && e?.status === 404) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'File not found',
      });
    }
    if (isProd === false) console.warn(`[error] ${req.method} ${req.path}`, (err as Error)?.message);
    return fail(res, err);
  });

  return app;
}

export const UPLOAD_MOUNT_ROOT = path.resolve(UPLOAD_ROOT);
