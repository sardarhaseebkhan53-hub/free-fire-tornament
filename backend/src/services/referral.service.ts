// =============================================================================
// Referral rewards — referrers earn when their referred players hit milestones:
//   • FIRST_LOGIN              → PKR 20 (referral.loginReward, admin-tunable)
//   • FIRST_DEPOSIT_APPROVED   → PKR 30 (referral.firstDepositReward)
//
// Money is ALWAYS server-side: credits go through the wallet ledger inside a
// transaction, are claimed exactly once (status guard on the reward row), are
// audited, and land in the referrer's BONUS balance. This has nothing to do
// with deposit/payment verification — a referral reward never credits cash the
// referred user deposited.
// =============================================================================
import { prisma } from '../lib/prisma';
import { moveBalance, TX_OPTS } from './wallet.service';
import { getSetting } from './settings.service';

export type ReferralAction = 'FIRST_LOGIN' | 'FIRST_DEPOSIT_APPROVED';

/**
 * Claim + credit a referral reward inside an existing transaction.
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
  // No reward row (user wasn't referred / action not configured) or already handled.
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
    description: `Referral reward — referred player ${action === 'FIRST_LOGIN' ? 'signed in' : 'made their first approved deposit'}`,
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
      body: `PKR ${amount} was added to your bonus balance — your referred player ${
        action === 'FIRST_LOGIN' ? 'signed in for the first time' : 'had their first deposit approved'
      }.`,
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

/** Standalone variant (own transaction) — e.g. from the login flow. */
export async function creditReferralReward(referredUserId: string, action: ReferralAction): Promise<boolean> {
  const currency = await getSetting('platform.currency', 'PKR');
  return prisma.$transaction(
    (tx) => creditReferralRewardTx(tx, referredUserId, action, currency),
    TX_OPTS,
  );
}
