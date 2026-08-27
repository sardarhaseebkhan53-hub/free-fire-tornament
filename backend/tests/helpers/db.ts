// =============================================================================
// Shared test helpers — database access, factories and money assertions.
//
// Every suite gets its own uniquely-named fixtures so files never collide, and
// `ledgerIsConsistent` re-derives balances straight from the immutable ledger
// (the same invariant the seed audit and the verify harnesses check).
// =============================================================================
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../generated/prisma';

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/postgres?connection_limit=5';

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) as never,
});

let seq = 0;
/** Unique, human-readable suffix so parallel-ish fixtures never clash. */
export function uid(prefix = 't'): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`.slice(0, 24);
}

export interface TestUser {
  id: string;
  username: string;
  email: string;
  password: string;
}

/** Create a verified, ACTIVE player with a wallet. Password is returned in
 * clear so auth suites can log in through the real service. */
export async function makeUser(opts: {
  cash?: number;
  winning?: number;
  bonus?: number;
  coins?: number;
  role?: 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';
  verified?: boolean;
  prefix?: string;
} = {}): Promise<TestUser> {
  const name = uid(opts.prefix ?? 'u');
  const password = 'Test@12345';
  // Cost 4 keeps the suite fast; production uses 12 (asserted in auth.test.ts).
  const { hashSync } = await import('bcryptjs');
  const user = await db.user.create({
    data: {
      username: name,
      email: `${name}@example.com`,
      passwordHash: hashSync(password, 4),
      role: opts.role ?? 'USER',
      status: 'ACTIVE',
      isVerified: opts.verified ?? true,
      referralCode: `TST-${name.slice(-6).toUpperCase()}`,
      profile: { create: { fullName: name } },
      wallet: {
        create: {
          cashBalance: new Prisma.Decimal(opts.cash ?? 0),
          winningBalance: new Prisma.Decimal(opts.winning ?? 0),
          bonusBalance: new Prisma.Decimal(opts.bonus ?? 0),
          coinBalance: new Prisma.Decimal(opts.coins ?? 0),
        },
      },
    },
    select: { id: true, username: true, email: true },
  });
  return { ...user, password };
}

export async function walletOf(userId: string) {
  const w = await db.wallet.findUniqueOrThrow({ where: { userId } });
  return {
    cash: Number(w.cashBalance),
    coins: Number(w.coinBalance),
    winning: Number(w.winningBalance),
    bonus: Number(w.bonusBalance),
  };
}

export async function makeTournament(opts: {
  type?: 'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD';
  entryFee?: number;
  maxSlots?: number;
  status?: 'DRAFT' | 'REGISTRATION_OPEN' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  prizes?: Array<{ kind: 'PLACEMENT' | 'KILL_POOL' | 'MVP' | 'BONUS'; amount: number; perKill?: number; cap?: number; label?: string }>;
  startsInHours?: number;
} = {}) {
  const slug = uid('tour');
  const start = new Date(Date.now() + (opts.startsInHours ?? 24) * 3_600_000);
  return db.tournament.create({
    data: {
      title: `Test ${slug}`,
      slug,
      type: opts.type ?? 'SOLO',
      description: 'created by the test suite',
      map: 'Bermuda',
      status: opts.status ?? 'REGISTRATION_OPEN',
      startTime: start,
      registrationDeadline: new Date(start.getTime() - 30 * 60_000),
      maxSlots: opts.maxSlots ?? 10,
      minSlotsToStart: 2,
      entryFeePerPlayer: new Prisma.Decimal(opts.entryFee ?? 50),
      pointsPerKill: 1,
      numWinners: 3,
      refundPercent: new Prisma.Decimal(100),
      prizes: {
        create: (opts.prizes ?? [
          { kind: 'PLACEMENT' as const, amount: 300, label: '1st' },
          { kind: 'PLACEMENT' as const, amount: 200, label: '2nd' },
          { kind: 'PLACEMENT' as const, amount: 100, label: '3rd' },
        ]).map((p, i) => ({
          kind: p.kind,
          position: p.kind === 'PLACEMENT' ? i + 1 : 100 + i,
          amount: new Prisma.Decimal(p.amount),
          perKill: p.perKill !== undefined ? new Prisma.Decimal(p.perKill) : undefined,
          cap: p.cap !== undefined ? new Prisma.Decimal(p.cap) : undefined,
          label: p.label,
        })),
      },
    },
  });
}

export async function setSetting(key: string, value: unknown) {
  await db.setting.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue, description: 'test' },
    update: { value: value as Prisma.InputJsonValue },
  });
  const { invalidateSetting } = await import('../../src/services/settings.service');
  invalidateSetting(key);
}

/**
 * The core financial invariant: the Wallet mirror must equal the ledger's final
 * balance for every bucket, and no row may be negative.
 */
export async function ledgerIsConsistent(userId: string) {
  const rows = await db.walletTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  const finalByBucket: Record<string, number> = {};
  for (const r of rows) {
    // Chain check: each row must start where the previous row for the bucket ended.
    const prev = finalByBucket[r.bucket];
    if (prev !== undefined && Math.abs(prev - Number(r.balanceBefore)) > 0.005) {
      return { ok: false, reason: `chain break in ${r.bucket}: expected ${prev}, got ${Number(r.balanceBefore)}` };
    }
    if (Number(r.balanceAfter) < -0.0001) {
      return { ok: false, reason: `negative balance in ${r.bucket}: ${Number(r.balanceAfter)}` };
    }
    finalByBucket[r.bucket] = Number(r.balanceAfter);
  }
  const w = await walletOf(userId);
  const mirror: Record<string, number> = { CASH: w.cash, COINS: w.coins, WINNING: w.winning, BONUS: w.bonus };
  for (const [bucket, expected] of Object.entries(finalByBucket)) {
    const actual = mirror[bucket] ?? 0;
    if (Math.abs(actual - expected) > 0.005) {
      return { ok: false, reason: `wallet mirror drift in ${bucket}: ledger ${expected}, wallet ${actual}` };
    }
  }
  return { ok: true, reason: 'ledger and wallet agree' };
}

/** Assert a promise rejects with a specific ApiError code. */
export async function rejectsWithCode(fn: () => Promise<unknown>, code: string): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code !== code) {
      throw new Error(`expected error code ${code}, got ${err.code ?? 'none'} (${err.message})`);
    }
    return e as Error;
  }
  throw new Error(`expected rejection with code ${code}, but the call succeeded`);
}

/** Remove everything a suite created (users cascade to wallets/ledger/etc.). */
export async function cleanupUsers(ids: string[]) {
  if (ids.length === 0) return;
  await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await db.fraudAlert.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}
