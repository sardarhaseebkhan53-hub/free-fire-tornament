// Centralized, validated environment access. Never read process.env elsewhere.
//
// Phase 16: in production this module is the gate that stops a half-configured
// deployment from booting. A server that starts with a placeholder JWT secret
// is worse than one that refuses to start — every access token becomes
// forgeable — so the checks below fail fast and loudly instead.
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    // Dev-only fallback: `npm run db:dev` serves an embedded PostgreSQL here.
    // PRODUCTION NEVER SEES THIS DEFAULT — the guard below refuses to boot on
    // a localhost URL, which is what produced the classic
    // `P1001: Can't reach database server at 127.0.0.1:5432`.
    .default('postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=1'),
  // Prisma CLI only (migrations, studio): the DIRECT (unpooled) connection.
  // The runtime API traffic goes through DATABASE_URL, which for Neon must be
  // the POOLED endpoint (host contains `-pooler`). When DIRECT_URL is unset the
  // CLI falls back to DATABASE_URL (see prisma.config.ts).
  DIRECT_URL: z.string().optional(),
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

  // --- Email (transactional: verification + password reset) -----------------
  EMAIL_PROVIDER: z.enum(['log', 'smtp', 'resend', 'postmark']).default('log'),
  EMAIL_FROM: z.string().default('CLUTCHNEX <no-reply@localhost>'),
  EMAIL_REPLY_TO: z.string().optional(),
  EMAIL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  EMAIL_ATTEMPTS: z.coerce.number().int().positive().max(5).default(3),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
});

export const env = schema.parse(process.env);

export const isProd = env.NODE_ENV === 'production';

/** Values that appear in .env.example or the schema defaults — never valid live. */
const PLACEHOLDER_SECRETS = [
  'dev-only-access-secret-change-me',
  'dev-only-refresh-secret-change-me',
  'change-me-access-secret',
  'change-me-refresh-secret',
];

const MIN_SECRET_LENGTH = 32;

function assertSecret(name: string, value: string) {
  const problems: string[] = [];
  if (!value.trim()) problems.push('is empty');
  if (PLACEHOLDER_SECRETS.includes(value)) problems.push('is the shipped placeholder');
  if (/^dev-only/i.test(value) || /change[-_ ]?me/i.test(value)) problems.push('looks like a placeholder');
  if (value.length < MIN_SECRET_LENGTH) problems.push(`is shorter than ${MIN_SECRET_LENGTH} characters`);
  // Low-entropy secrets (all one character, or a repeated word) are forgeable.
  if (new Set(value).size < 8) problems.push('has too little entropy');

  if (problems.length > 0) {
    throw new Error(
      `${name} ${problems.join(', ')}. Generate one with \`openssl rand -hex 64\` ` +
        `and set it in the environment — refusing to start in production.`,
    );
  }
}

if (isProd) {
  assertSecret('JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET);
  assertSecret('JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET);
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
  }
  if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string in production.');
  }
  {
    let host = '';
    try {
      host = new URL(env.DATABASE_URL).hostname;
    } catch {
      /* the scheme check above already reported malformed URLs */
    }
    if (['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'].includes(host)) {
      throw new Error(
        'DATABASE_URL points at localhost — no PostgreSQL runs inside the deploy container. ' +
          'This is the classic `P1001: Can\'t reach database server at 127.0.0.1:5432`. ' +
          'Set DATABASE_URL to your managed Postgres POOLED connection string ' +
          '(Neon host contains `-pooler`), e.g. ' +
          '`postgresql://USER:PASSWORD@ep-…-pooler.REGION.aws.neon.tech/DB?sslmode=require&connection_limit=10`.',
      );
    }
  }
  if (!/^https:\/\//.test(env.PUBLIC_URL)) {
    throw new Error(
      'PUBLIC_URL must be an https:// URL in production (canonical URLs, sitemap, emails). ' +
        'Set it to your deployed https:// origin, e.g. https://clutchnex.gg — ' +
        'for local runs keep NODE_ENV=development.',
    );
  }
  if (!/^https:\/\//.test(env.CLIENT_ORIGIN)) {
    throw new Error('CLIENT_ORIGIN must be an https:// URL in production (CORS is pinned to it).');
  }

  // Email: a live site whose verification and reset mails go nowhere is broken
  // in a way nobody notices until players complain, so refuse to boot.
  if (env.EMAIL_PROVIDER === 'log') {
    throw new Error(
      'EMAIL_PROVIDER=log only prints to stdout — verification and password-reset ' +
        'emails would never reach players. Set EMAIL_PROVIDER to smtp, resend or ' +
        'postmark (see DEPLOYMENT.md).',
    );
  }
  // "CLUTCHNEX <no-reply@clutchnex.gg>" or a bare address — either way the
  // address itself must look real, or every provider will reject the send.
  const fromAddress = env.EMAIL_FROM.includes('<')
    ? (env.EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? '')
    : env.EMAIL_FROM;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress.trim())) {
    throw new Error('EMAIL_FROM must contain a real address, e.g. "CLUTCHNEX <no-reply@clutchnex.gg>".');
  }
}
