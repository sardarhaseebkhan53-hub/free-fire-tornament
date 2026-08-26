// Express application wiring — no business logic lives here.
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './lib/env';
import { apiLimiter } from './middleware/rateLimit';
import { fail, ok } from './lib/respond';
import { authRouter } from './routes/auth.routes';
import { publicRouter } from './routes/public.routes';
import { tournamentRouter } from './routes/tournament.routes';
import { teamRouter } from './routes/team.routes';
import { matchRouter } from './routes/match.routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
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

  // 404 for unknown API routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Endpoint not found' });
  });

  // Central error handler — never leaks stack traces
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    fail(res, err);
  });

  return app;
}
