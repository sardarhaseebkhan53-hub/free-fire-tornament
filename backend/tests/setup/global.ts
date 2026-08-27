// =============================================================================
// Vitest global setup — boot a private PostgreSQL for the test run.
//
// Uses the same embedded PGlite the dev workflow uses (no Docker, no install),
// on its own port and its own data directory, then applies every migration in
// prisma/migrations. The database is wiped at the start of each run so suites
// never depend on leftovers.
// =============================================================================
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const PORT = Number(process.env.TEST_DB_PORT ?? 55432);
const DATA_DIR = resolve(process.cwd(), '.test-pgdata');
const MIGRATIONS_DIR = resolve(process.cwd(), 'prisma/migrations');
const CONNECTION_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

let server: PGLiteSocketServer | undefined;
let db: PGlite | undefined;

async function waitForPort(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (e) {
      lastError = e;
      await client.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Test database did not come up on :${PORT} — ${String(lastError)}`);
}

/**
 * The rows the application expects to exist: payment destinations and the
 * admin-tunable settings the services read (same keys/values as prisma/seed.ts,
 * minus the demo players — suites create their own).
 */
async function seedBaseline(client: pg.Client) {
  await client.query(
    `INSERT INTO payment_accounts (id, method, label, "accountName", "accountNumber", instructions, "displayOrder", "isActive", "createdAt", "updatedAt")
     VALUES
       (gen_random_uuid()::text, 'JAZZCASH', 'JazzCash', 'CLUTCHNEX', '03001234567', 'Send the exact amount and note the TID.', 1, true, now(), now()),
       (gen_random_uuid()::text, 'EASYPAISA', 'EasyPaisa', 'CLUTCHNEX', '03451234567', 'Send the exact amount and note the TID.', 2, true, now(), now()),
       (gen_random_uuid()::text, 'BANK_TRANSFER', 'Bank Transfer', 'CLUTCHNEX PK', 'PK36MEZN00990012345678', 'IBAN transfer; allow 1 business day.', 3, true, now(), now())`,
  );

  const settings: Array<[string, unknown]> = [
    ['platform.name', 'CLUTCHNEX'],
    ['platform.currency', 'PKR'],
    ['platform.currencySymbol', 'Rs'],
    ['platform.registrationOpen', true],
    ['wallet.minDeposit', 100],
    ['wallet.maxDeposit', 25000],
    ['wallet.minWithdrawal', 100],
    ['wallet.coinConversionRate', 1],
    ['wallet.welcomeBonus', 0],
    ['wallet.depositBonusPercent', 0],
    ['wallet.withdrawalFeePercent', 0],
    ['referral.loginReward', 20],
    ['referral.firstDepositReward', 30],
    ['tournament.startReminderMinutes', 5],
    ['tournament.defaultPointsPerKill', 1],
    ['tournament.roomCredentialsReleaseMinutesBeforeStart', 30],
    ['pricing.lossWarningThreshold', 0],
    ['security.fraudDetectionEnabled', true],
    ['security.maxLoginAttempts', 5],
    ['security.lockoutMinutes', 15],
    ['security.credentialStuffingThreshold', 5],
    ['security.maxUploadDimension', 4096],
    ['security.minUploadDimension', 32],
    ['security.maxUploadsPerUserPerDay', 50],
    ['security.maxDepositsPerHour', 5],
    ['security.depositBurstWindowHours', 1],
    ['security.unusualDepositMultiplier', 5],
    ['security.maxWithdrawalsPerDay', 3],
    ['security.withdrawalChurnHours', 24],
    ['security.newAccountWithdrawalDays', 1],
    ['security.maxRegistrationsPerIpPerDay', 3],
    ['security.registrationBurstWindowHours', 24],
    ['security.maxJoinFailuresPerHour', 10],
    ['security.joinFailureWindowHours', 1],
    ['security.maxCouponFailuresPerHour', 8],
    ['security.couponAbuseWindowHours', 1],
  ];
  for (const [key, value] of settings) {
    await client.query(
      `INSERT INTO settings (id, key, value, description, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2::jsonb, 'test baseline', now(), now())`,
      [key, JSON.stringify(value)],
    );
  }
}

export async function setup() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  db = new PGlite(DATA_DIR);
  server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: '127.0.0.1',
    // Two Prisma pools share this server (the services' client and the test
    // helper's), so give both room plus the concurrency suites' transactions.
    maxConnections: 40,
    idleTimeout: 300_000,
  });
  await server.start();
  await waitForPort(CONNECTION_URL);

  // Apply migrations in order — exactly what `prisma migrate deploy` would do.
  const client = new pg.Client({ connectionString: CONNECTION_URL });
  await client.connect();
  const dirs = readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('.') && d !== 'migration_lock.toml')
    .sort();
  if (dirs.length === 0) throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);
  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  }
  await seedBaseline(client);
  await client.end();

  console.log(`[tests] PostgreSQL ready on :${PORT} (${dirs.length} migration(s) applied, baseline seeded)`);
}

export async function teardown() {
  try {
    await server?.stop();
  } catch {
    /* already down */
  }
  try {
    await db?.close();
  } catch {
    /* already closed */
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(resolve(process.cwd(), '.test-uploads'), { recursive: true, force: true });
}
