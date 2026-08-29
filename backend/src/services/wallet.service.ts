// =============================================================================
// Wallet ledger core — every balance movement goes through moveBalance.
//
// Rules:
//  - The Wallet row is mirrored state; WalletTransaction rows are the truth.
//  - Debits are rejected before they can overdraw (server-side only; never
//    trust client-supplied balances).
//  - moveBalance runs INSIDE a caller-supplied transaction so composite
//    financial operations (withdrawal request + debit, coin conversion) are
//    atomic: either every ledger entry lands or none do.
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { getSetting } from './settings.service';

export type Bucket = 'CASH' | 'COINS' | 'WINNING' | 'BONUS';
export type Direction = 'CREDIT' | 'DEBIT';
export type TxType =
  | 'DEPOSIT' | 'ENTRY_FEE' | 'ENTRY_REFUND' | 'WINNING' | 'WITHDRAWAL'
  | 'WITHDRAWAL_REVERSAL' | 'BONUS_CREDIT' | 'BONUS_DEBIT' | 'REFERRAL_REWARD'
  | 'COIN_CONVERSION' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT'
  | 'TRANSFER_SENT' | 'TRANSFER_RECEIVED' | 'REFUND';

const COLUMN: Record<Bucket, 'cashBalance' | 'coinBalance' | 'winningBalance' | 'bonusBalance'> = {
  CASH: 'cashBalance',
  COINS: 'coinBalance',
  WINNING: 'winningBalance',
  BONUS: 'bonusBalance',
};

export const TX_OPTS = { timeout: 20_000, maxWait: 10_000 };

export interface LedgerMeta {
  entityType?: string;
  entityId?: string;
  reference?: string;
  description?: string;
  createdById?: string;
}

/** Move money inside an existing transaction. Throws before any write if the
 * debit would overdraw the bucket — the caller's transaction then rolls back.
 * NOTE: no settings reads in here — Phase 5 deadlock fix keeps lookups OUT of
 * financial transactions, so the caller passes the currency in. */
export async function moveBalance(
  tx: Prisma.TransactionClient,
  userId: string,
  bucket: Bucket,
  direction: Direction,
  amount: number,
  type: TxType,
  meta: LedgerMeta = {},
  currency = 'PKR',
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest('VALIDATION_ERROR', 'Amount must be positive');
  }
  // Wallet amounts are stored to cents. Normalize once so the conditional SQL,
  // ledger amount and before/after snapshots all use the same value.
  const normalizedAmount = Math.round(amount * 100) / 100;
  if (!(normalizedAmount > 0)) {
    throw badRequest('VALIDATION_ERROR', 'Amount must be at least 0.01');
  }

  const column = COLUMN[bucket];
  const operator = direction === 'CREDIT' ? Prisma.raw('+') : Prisma.raw('-');
  const delta = new Prisma.Decimal(normalizedAmount);

  // The UPDATE both locks the wallet row and performs the balance check. A
  // find-then-update sequence is not safe when two requests spend the same
  // wallet concurrently. The returned value is the committed balance for this
  // movement, so ledger snapshots cannot be produced from a stale read.
  const rows = await tx.$queryRaw<Array<{ after: Prisma.Decimal }>>`
    UPDATE "wallets"
    SET ${Prisma.raw(`"${column}"`)} = ${Prisma.raw(`"${column}"`)} ${operator} ${delta}
    WHERE "userId" = ${userId}
      AND ${Prisma.raw(`"${column}"`)} ${operator} ${delta} >= 0
    RETURNING ${Prisma.raw(`"${column}"`)} AS "after"
  `;

  if (rows.length === 0) {
    const exists = await tx.wallet.findUnique({ where: { userId }, select: { id: true } });
    if (!exists) throw badRequest('NOT_FOUND', 'Wallet not found');
    throw badRequest('INSUFFICIENT_BALANCE', 'Insufficient balance for this operation');
  }

  const after = Math.round(Number(rows[0]!.after) * 100) / 100;
  const before = Math.round(
    (direction === 'CREDIT' ? after - normalizedAmount : after + normalizedAmount) * 100,
  ) / 100;

  return tx.walletTransaction.create({
    data: {
      userId, bucket, type, direction,
      amount: new Prisma.Decimal(normalizedAmount),
      currency,
      balanceBefore: new Prisma.Decimal(before),
      balanceAfter: new Prisma.Decimal(after),
      entityType: meta.entityType,
      entityId: meta.entityId,
      reference: meta.reference,
      description: meta.description,
      createdById: meta.createdById,
    },
  });
}

/** Single self-contained movement (its own transaction). */
export async function applyWalletTx(
  userId: string,
  bucket: Bucket,
  direction: Direction,
  amount: number,
  type: TxType,
  meta: LedgerMeta = {},
) {
  const currency = await getSetting('platform.currency', 'PKR');
  const entry = await prisma.$transaction(
    (tx) => moveBalance(tx, userId, bucket, direction, amount, type, meta, currency),
    TX_OPTS,
  );
  return { ...entry, currency };
}

// ---------------------------------------------------------------------------
// User-facing wallet reads
// ---------------------------------------------------------------------------

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;

function serializeTx(t: {
  id: string; bucket: string; type: string; direction: string;
  amount: Prisma.Decimal; currency: string; balanceBefore: Prisma.Decimal;
  balanceAfter: Prisma.Decimal; entityType: string | null; entityId: string | null;
  reference: string | null; description: string | null; status: string; createdAt: Date;
}) {
  return {
    id: t.id,
    bucket: t.bucket,
    type: t.type,
    direction: t.direction,
    amount: num(t.amount),
    currency: t.currency,
    balanceBefore: num(t.balanceBefore),
    balanceAfter: num(t.balanceAfter),
    entityType: t.entityType,
    entityId: t.entityId,
    reference: t.reference,
    description: t.description,
    status: t.status,
    createdAt: t.createdAt,
  };
}

/** Wallet page payload: balances, configurable limits, recent ledger rows. */
export async function walletOverview(userId: string) {
  const [wallet, recent, minDeposit, maxDeposit, minWithdrawal, feePct, coinRate, bonusPct, pendingDeposits, pendingWithdrawals] =
    await Promise.all([
      prisma.wallet.findUnique({ where: { userId } }),
      prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      getSetting('wallet.minDeposit', 100),
      getSetting('wallet.maxDeposit', 25000),
      getSetting('wallet.minWithdrawal', 100),
      getSetting('wallet.withdrawalFeePercent', 0),
      getSetting('wallet.coinConversionRate', 1),
      getSetting('wallet.depositBonusPercent', 0),
      prisma.deposit.count({ where: { userId, status: 'PENDING' } }),
      prisma.withdrawal.count({ where: { userId, status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } } }),
    ]);
  if (!wallet) throw badRequest('NOT_FOUND', 'Wallet not found');

  const cash = num(wallet.cashBalance);
  const winning = num(wallet.winningBalance);
  return {
    wallet: {
      cashBalance: cash,
      coinBalance: num(wallet.coinBalance),
      winningBalance: winning,
      bonusBalance: num(wallet.bonusBalance),
      // Primary player-facing balance: one PKR number (deposits + winnings).
      // Buckets remain internally for accounting/withdrawal rules; players
      // see a single wallet.
      balance: Math.round((cash + winning) * 100) / 100,
      withdrawable: winning,
      currency: 'PKR',
    },
    settings: {
      minDeposit: Number(minDeposit),
      maxDeposit: Number(maxDeposit),
      minWithdrawal: Number(minWithdrawal),
      withdrawalFeePercent: Number(feePct),
      coinConversionRate: Number(coinRate),
      depositBonusPercent: Number(bonusPct),
    },
    recentTransactions: recent.map(serializeTx),
    pending: { deposits: pendingDeposits, withdrawals: pendingWithdrawals },
  };
}

export interface TxFilter {
  page: number;
  pageSize: number;
  types?: string[];
  direction?: 'CREDIT' | 'DEBIT';
  bucket?: string;
  search?: string;
  from?: Date;
  to?: Date;
}

function txWhere(userId: string, f: TxFilter) {
  const where: Record<string, unknown> = { userId };
  if (f.types?.length) where.type = { in: f.types };
  if (f.direction) where.direction = f.direction;
  if (f.bucket) where.bucket = f.bucket;
  if (f.from || f.to) {
    where.createdAt = {
      ...(f.from ? { gte: f.from } : {}),
      ...(f.to ? { lte: f.to } : {}),
    };
  }
  if (f.search) {
    where.OR = [
      { reference: { contains: f.search, mode: 'insensitive' } },
      { description: { contains: f.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

/** Paginated ledger with in/out/net totals over the whole (unpaged) filter. */
export async function listTransactions(userId: string, f: TxFilter) {
  const where = txWhere(userId, f);
  const [rows, total, grouped] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.walletTransaction.count({ where }),
    prisma.walletTransaction.groupBy({ by: ['direction'], _sum: { amount: true }, where }),
  ]);
  const inSum = num(grouped.find((g) => g.direction === 'CREDIT')?._sum.amount);
  const outSum = num(grouped.find((g) => g.direction === 'DEBIT')?._sum.amount);
  return {
    items: rows.map(serializeTx),
    page: f.page,
    pageSize: f.pageSize,
    total,
    totalIn: inSum,
    totalOut: outSum,
    net: Math.round((inSum - outSum) * 100) / 100,
  };
}

/** CSV export of the current filter (audit-friendly, spreadsheet-ready). */
export async function transactionsCsv(userId: string, f: TxFilter): Promise<string> {
  const where = txWhere(userId, f);
  const rows = await prisma.walletTransaction.findMany({ where, orderBy: { createdAt: 'desc' } });
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const head = 'Date,Type,Bucket,Direction,Amount,Currency,Balance Before,Balance After,Reference,Description,Status';
  const lines = rows.map((t) =>
    [t.createdAt.toISOString(), t.type, t.bucket, t.direction, num(t.amount), t.currency,
      num(t.balanceBefore), num(t.balanceAfter), t.reference ?? '', t.description ?? '', t.status]
      .map(esc).join(','));
  return [head, ...lines].join('\n');
}

/** Convert CASH → COINS at the admin-set rate. One atomic transaction:
 * two ledger entries, both buckets updated, or nothing changes. */
export async function convertCashToCoins(userId: string, amount: number) {
  const rate = Number(await getSetting('wallet.coinConversionRate', 1));
  if (!(rate > 0)) throw badRequest('VALIDATION_ERROR', 'Coin conversion is disabled.');
  const currency = await getSetting('platform.currency', 'PKR');
  const coins = Math.floor(amount * rate * 100) / 100;

  const out = await prisma.$transaction(async (tx) => {
    const debit = await moveBalance(tx, userId, 'CASH', 'DEBIT', amount, 'COIN_CONVERSION', {
      entityType: 'Wallet',
      reference: `CNV${Date.now()}`,
      description: `Converted ${currency} ${amount} to ${coins} tournament coins`,
    }, currency);
    const credit = await moveBalance(tx, userId, 'COINS', 'CREDIT', coins, 'COIN_CONVERSION', {
      entityType: 'Wallet',
      entityId: debit.id,
      reference: debit.reference ?? undefined,
      description: `${currency} ${amount} converted at ${rate} coins per ${currency}`,
    }, currency);
    return { debit, credit };
  }, TX_OPTS);

  return { cashDebited: amount, coinsCredited: coins, rate, debitId: out.debit.id, creditId: out.credit.id };
}

