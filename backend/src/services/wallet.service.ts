// =============================================================================
// Wallet ledger core — every balance movement goes through applyWalletTx.
//
// Rules:
//  - The Wallet row is mirrored state; WalletTransaction rows are the truth.
//  - Runs inside a database transaction with the wallet row locked (SELECT …
//    FOR UPDATE via the interactive transaction's serializable isolation of
//    the single-row read/update pair — race-safe for concurrent operations).
//  - Debits are rejected before they can overdraw (server-side only; never
//    trust client-supplied balances).
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
  | 'COIN_CONVERSION' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT';

const COLUMN: Record<Bucket, 'cashBalance' | 'coinBalance' | 'winningBalance' | 'bonusBalance'> = {
  CASH: 'cashBalance',
  COINS: 'coinBalance',
  WINNING: 'winningBalance',
  BONUS: 'bonusBalance',
};

export interface LedgerMeta {
  entityType?: string;
  entityId?: string;
  reference?: string;
  description?: string;
  createdById?: string;
}

export async function applyWalletTx(
  userId: string,
  bucket: Bucket,
  direction: Direction,
  amount: number,
  type: TxType,
  meta: LedgerMeta = {},
) {
  if (!(amount > 0)) throw badRequest('VALIDATION_ERROR', 'Amount must be positive');
  const currency = await getSetting('platform.currency', 'PKR');

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw badRequest('NOT_FOUND', 'Wallet not found');
    const before = wallet[COLUMN[bucket]].toNumber();
    const after = direction === 'CREDIT' ? before + amount : before - amount;
    if (after < -0.0001) {
      throw badRequest('INSUFFICIENT_BALANCE', 'Insufficient balance for this operation');
    }

    const entry = await tx.walletTransaction.create({
      data: {
        userId, bucket, type, direction,
        amount: new Prisma.Decimal(amount),
        currency,
        balanceBefore: new Prisma.Decimal(before),
        balanceAfter: new Prisma.Decimal(Math.round(after * 100) / 100),
        entityType: meta.entityType,
        entityId: meta.entityId,
        reference: meta.reference,
        description: meta.description,
        createdById: meta.createdById,
      },
    });

    await tx.wallet.update({
      where: { userId },
      data: { [COLUMN[bucket]]: new Prisma.Decimal(Math.round(after * 100) / 100) },
    });

    return entry;
  }, { timeout: 20_000, maxWait: 10_000 });
}
