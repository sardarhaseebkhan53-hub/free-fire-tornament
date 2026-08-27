// =============================================================================
// Referral rewards — the referrer earns when a referred player makes their
// FIRST APPROVED deposit of at least referral.minFirstDeposit (default PKR 100):
//
//   • FIRST_DEPOSIT_APPROVED (≥ PKR 100) → PKR 50 (referral.firstDepositReward)
//
// Money is ALWAYS server-side: the credit goes through the wallet ledger inside
// the same transaction as the deposit approval, is claimed exactly once
// (atomic PENDING → CREDITED on the reward row), is audited, and lands in the
// referrer's BONUS balance. This is a referral bonus — it is NOT a payment and
// never auto-approves the player's deposit.
// =============================================================================
import { prisma } from '../lib/prisma';
import { moveBalance, TX_OPTS } from './wallet.service';

export type ReferralAction = 'FIRST_DEPOSIT_APPROVED';

/**
 * Claim + credit the referral reward inside an existing transaction.
 * Returns true only when this call performed the credit (exactly once).
 */
export async function creditReferralRewardTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  referredUserId: string,
  action: ReferralAction,
  currency = 'PKR',
): Promise<boolean> {
  const row = await tx.referralReward.findFirst({
    where: { referredUserId, qualifyingAction: action },
    select: { id: true, referrerId: true, rewardAmount: true, status: true },
  });
  // No reward row (player wasn't referred) or already handled.
  if (!row || row.status !== 'PENDING') return false;

  const amount = Number(row.rewardAmount);

  // Reward disabled by admin (amount 0) → close the row so it never retries.
  if (!(amount > 0)) {
    await tx.referralReward.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'REJECTED', qualifiedAt: new Date() },
    });
    return false;
  }

  // Atomic claim: only one caller can flip PENDING → CREDITED.
  const claimed = await tx.referralReward.updateMany({
    where: { id: row.id, status: 'PENDING' },
    data: { status: 'CREDITED', qualifiedAt: new Date(), creditedAt: new Date() },
  });
  if (claimed.count === 0) return false;

  const entry = await moveBalance(tx, row.referrerId, 'BONUS', 'CREDIT', amount, 'REFERRAL_REWARD', {
    entityType: 'ReferralReward',
    entityId: row.id,
    description: 'Referral reward — referred player\u2019s first approved deposit (min PKR 100)',
  }, currency);
  await tx.referralReward.update({
    where: { id: row.id },
    data: { walletTxId: entry.id },
  });

  await tx.notification.create({
    data: {
      userId: row.referrerId,
      type: 'REFERRAL_REWARD',
      title: 'Referral reward earned 🎁',
      body: `PKR ${amount} was added to your bonus balance — your referred player\u2019s first deposit was approved.`,
      data: { referralRewardId: row.id, action },
    },
  });
  await tx.auditLog.create({
    data: {
      actorId: row.referrerId,
      action: 'REFERRAL_REWARD_CREDITED',
      entity: 'ReferralReward',
      entityId: row.id,
      after: { amount, action, referredUserId },
    },
  });
  return true;
}

/** Exported for reuse; the deposit-approval path passes its own transaction. */
export const REFERRAL_TX_OPTS = TX_OPTS;
