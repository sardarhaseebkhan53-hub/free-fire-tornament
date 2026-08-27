// Centralized, validated environment access. Never read process.env elsewhere.
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .default('postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=1'),
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().default('dev-only-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().default('dev-only-refresh-secret-change-me'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),
  UPLOAD_DIR: z.string().default('uploads'),
  // Global per-IP ceiling. Deliberately generous: a whole hostel behind one NAT
  // shares this bucket. The routes that matter (auth, deposits, withdrawals,
  // joins, coupons) have their own much tighter budgets in middleware/rateLimit.
  RATE_LIMIT_PER_WINDOW: z.coerce.number().int().positive().default(600),
});

export const env = schema.parse(process.env);

export const isProd = env.NODE_ENV === 'production';

if (isProd && env.JWT_ACCESS_SECRET.startsWith('dev-only')) {
  throw new Error('JWT_ACCESS_SECRET must be set to a strong secret in production.');
}
