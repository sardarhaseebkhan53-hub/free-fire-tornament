// =============================================================================
// Tournament economics — the ONLY place pricing math happens (server-side,
// per security rule: never trust frontend financial values).
//
// Implements brief §24 (profit calculator) and §25 (economic safety):
//   Expected Collection − (Placement + Kill Budget + MVP + Bonuses)
//   − Referral Costs − Payment Costs = Estimated Platform Profit
//
// Kill pools MUST carry a budget cap — unlimited liability is rejected.
// If the configuration estimates a loss, `safe=false` and the admin must
// explicitly confirm before publishing (enforced by the admin API).
// =============================================================================
import { badRequest } from '../lib/errors';
import { getSetting } from './settings.service';

export type PrizeKindInput = 'PLACEMENT' | 'KILL_POOL' | 'MVP' | 'BONUS';

export interface PrizeInput {
  kind: PrizeKindInput;
  amount: number;
  /** KILL_POOL: PKR awarded per kill (e.g. 10). */
  perKill?: number;
  /** KILL_POOL: mandatory budget cap. */
  cap?: number;
  label?: string;
}

export interface EconomicsInput {
  type: 'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD' | 'LONE_WOLF' | 'CLASH_SQUAD_1V1';
  entryFeePerPlayer: number;
  /** Slots in TEAMS (players for SOLO). */
  slots: number;
  prizes: PrizeInput[];
  /** Bonus credited on join, percent of entry (0–100). */
  bonusPercent?: number;
  /** Expected slot fill rate (0–1], default 1 (sold out). */
  fillRate?: number;
  /** Estimated referral payouts for this tournament. */
  referralCostEstimate?: number;
  /** Payment processing cost as percent of collection (e.g. 1). */
  paymentCostPercent?: number;
}

export interface EconomicsResult {
  teamSize: number;
  entryFeePerTeam: number;
  expectedCollection: number;
  placementBudget: number;
  killBudget: number;
  mvpBudget: number;
  bonusBudget: number;
  playerRewardBudget: number;
  platformGross: number;
  referralCost: number;
  paymentCost: number;
  estimatedNetProfit: number;
  /** false when a loss is projected — publishing requires explicit confirmation. */
  safe: boolean;
  warning?: string;
}

export const TEAM_SIZE: Record<EconomicsInput['type'], number> = {
  SOLO: 1,
  DUO: 2,
  SQUAD: 4,
  CLASH_SQUAD: 4,
  LONE_WOLF: 1,
  CLASH_SQUAD_1V1: 1,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function computeEconomics(input: EconomicsInput): Promise<EconomicsResult> {
  if (!(input.entryFeePerPlayer >= 0)) throw badRequest('VALIDATION_ERROR', 'Entry fee must be >= 0');
  if (!(input.slots > 0)) throw badRequest('VALIDATION_ERROR', 'Slots must be positive');
  const fillRate = Math.min(1, Math.max(0.01, input.fillRate ?? 1));

  let placement = 0;
  let kill = 0;
  let mvp = 0;
  let bonus = 0;

  for (const p of input.prizes) {
    if (!(p.amount >= 0)) throw badRequest('VALIDATION_ERROR', 'Prize amounts must be >= 0');
    switch (p.kind) {
      case 'PLACEMENT':
        placement += p.amount;
        break;
      case 'KILL_POOL':
        // §28: tournament kill cap is MANDATORY — never allow unlimited liability.
        if (p.cap === undefined || p.cap <= 0) {
          throw badRequest('VALIDATION_ERROR', 'Kill pool requires a mandatory budget cap');
        }
        if (p.amount > p.cap) {
          throw badRequest('VALIDATION_ERROR', 'Kill pool amount cannot exceed its cap');
        }
        kill += p.cap; // budget worst-case = the cap
        break;
      case 'MVP':
        mvp += p.amount;
        break;
      case 'BONUS':
        bonus += p.amount;
        break;
    }
  }

  const teamSize = TEAM_SIZE[input.type];
  const entryFeePerTeam = input.entryFeePerPlayer * teamSize;
  const expectedCollection = round2(entryFeePerTeam * input.slots * fillRate);

  // Join bonuses as percent of entry (config-driven bonus pool)
  const bonusPercentBudget = round2(((input.bonusPercent ?? 0) / 100) * expectedCollection);
  const bonusBudget = round2(bonus + bonusPercentBudget);

  const playerRewardBudget = round2(placement + kill + mvp + bonusBudget);
  const platformGross = round2(expectedCollection - playerRewardBudget);

  const referralCost = round2(input.referralCostEstimate ?? 0);
  const paymentCostPercent = input.paymentCostPercent ?? 0;
  const paymentCost = round2((paymentCostPercent / 100) * expectedCollection);
  const estimatedNetProfit = round2(platformGross - referralCost - paymentCost);

  const lossThreshold = await getSetting('pricing.lossWarningThreshold', 0);
  const safe = estimatedNetProfit >= -lossThreshold;

  return {
    teamSize,
    entryFeePerTeam,
    expectedCollection,
    placementBudget: round2(placement),
    killBudget: round2(kill),
    mvpBudget: round2(mvp),
    bonusBudget,
    playerRewardBudget,
    platformGross,
    referralCost,
    paymentCost,
    estimatedNetProfit,
    safe,
    ...(safe
      ? {}
      : {
          warning: `⚠️ This tournament configuration creates an estimated loss of PKR ${Math.abs(
            estimatedNetProfit,
          ).toFixed(0)}. Explicit confirmation is required to publish.`,
        }),
  };
}

/** Validate a tier from the admin pricing table before it can be used. */
export function assertTierBalances(tier: {
  collection: number;
  playerRewards: number;
  platformGross: number;
}): void {
  if (tier.collection - tier.playerRewards !== tier.platformGross) {
    throw badRequest(
      'VALIDATION_ERROR',
      `Tier math is inconsistent: ${tier.collection} − ${tier.playerRewards} ≠ ${tier.platformGross}`,
    );
  }
}
