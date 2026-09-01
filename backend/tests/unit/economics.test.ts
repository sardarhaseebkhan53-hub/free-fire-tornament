// =============================================================================
// Unit — tournament economics (the only place pricing math lives).
// Reads the settings table for the loss threshold, so it runs against the test
// database but creates no rows of its own.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { computeEconomics, TEAM_SIZE } from '../../src/services/tournament-economics.service';
import { db, setSetting } from '../helpers/db';
import { rejectsWithCode } from '../helpers/db';

describe('tournament economics', () => {
  it('knows the team size for every mode', () => {
    expect(TEAM_SIZE).toEqual({
      SOLO: 1, DUO: 2, SQUAD: 4, CLASH_SQUAD: 4, LONE_WOLF: 1, CLASH_SQUAD_1V1: 1,
    });
  });

  it('reproduces the Solo Standard master tier to the rupee', async () => {
    const r = await computeEconomics({
      type: 'SOLO',
      entryFeePerPlayer: 50,
      slots: 48,
      prizes: [
        { kind: 'PLACEMENT', amount: 650 },
        { kind: 'PLACEMENT', amount: 400 },
        { kind: 'PLACEMENT', amount: 250 },
        { kind: 'KILL_POOL', amount: 0, perKill: 10, cap: 400 },
        { kind: 'MVP', amount: 100 },
      ],
    });
    expect(r.expectedCollection).toBe(2400); // 50 × 48
    expect(r.playerRewardBudget).toBe(1800); // 650+400+250+400+100
    expect(r.platformGross).toBe(600);
    expect(r.safe).toBe(true);
  });

  it('multiplies the entry fee by the team size in team modes', async () => {
    const r = await computeEconomics({
      type: 'SQUAD',
      entryFeePerPlayer: 100,
      slots: 12,
      prizes: [{ kind: 'PLACEMENT', amount: 1900 }],
    });
    expect(r.entryFeePerTeam).toBe(400);
    expect(r.expectedCollection).toBe(4800); // 100 × 4 players × 12 slots
  });

  it('budgets the kill pool at its cap, not at an open-ended liability', async () => {
    const r = await computeEconomics({
      type: 'SOLO',
      entryFeePerPlayer: 100,
      slots: 48,
      prizes: [{ kind: 'KILL_POOL', amount: 0, perKill: 10, cap: 500 }],
    });
    expect(r.killBudget).toBe(500);
  });

  it('REFUSES an uncapped kill pool', async () => {
    await rejectsWithCode(
      () =>
        computeEconomics({
          type: 'SOLO',
          entryFeePerPlayer: 50,
          slots: 48,
          prizes: [{ kind: 'KILL_POOL', amount: 0, perKill: 10 }],
        }),
      'VALIDATION_ERROR',
    );
  });

  it('refuses a kill pool whose amount exceeds its cap', async () => {
    await rejectsWithCode(
      () =>
        computeEconomics({
          type: 'SOLO',
          entryFeePerPlayer: 50,
          slots: 48,
          prizes: [{ kind: 'KILL_POOL', amount: 900, perKill: 10, cap: 400 }],
        }),
      'VALIDATION_ERROR',
    );
  });

  it('flags a loss-making configuration as unsafe', async () => {
    const r = await computeEconomics({
      type: 'SOLO',
      entryFeePerPlayer: 20,
      slots: 48,
      prizes: [
        { kind: 'PLACEMENT', amount: 900 },
        { kind: 'KILL_POOL', amount: 0, perKill: 10, cap: 400 },
      ],
    });
    expect(r.estimatedNetProfit).toBeLessThan(0);
    expect(r.safe).toBe(false);
    expect(r.warning).toBeTruthy();
  });

  it('honours a partial fill rate', async () => {
    const full = await computeEconomics({ type: 'SOLO', entryFeePerPlayer: 50, slots: 48, prizes: [] });
    const half = await computeEconomics({ type: 'SOLO', entryFeePerPlayer: 50, slots: 48, prizes: [], fillRate: 0.5 });
    expect(half.expectedCollection).toBe(full.expectedCollection / 2);
  });

  it('deducts payment and referral costs from net profit', async () => {
    const r = await computeEconomics({
      type: 'SOLO',
      entryFeePerPlayer: 100,
      slots: 48,
      prizes: [],
      paymentCostPercent: 2,
      referralCostEstimate: 100,
    });
    // 4800 collection − 96 payment cost − 100 referral
    expect(r.paymentCost).toBe(96);
    expect(r.estimatedNetProfit).toBe(4800 - 96 - 100);
  });

  it('rejects nonsense input', async () => {
    await rejectsWithCode(
      () => computeEconomics({ type: 'SOLO', entryFeePerPlayer: -5, slots: 10, prizes: [] }),
      'VALIDATION_ERROR',
    );
    await rejectsWithCode(
      () => computeEconomics({ type: 'SOLO', entryFeePerPlayer: 50, slots: 0, prizes: [] }),
      'VALIDATION_ERROR',
    );
  });

  it('lets an admin move the loss threshold and flips the verdict', async () => {
    const input = {
      type: 'SOLO' as const,
      entryFeePerPlayer: 20,
      slots: 48,
      prizes: [{ kind: 'PLACEMENT' as const, amount: 900 }, { kind: 'KILL_POOL' as const, amount: 0, perKill: 10, cap: 400 }],
    };
    const before = await computeEconomics(input);
    expect(before.safe).toBe(false);

    await setSetting('pricing.lossWarningThreshold', 5000);
    const after = await computeEconomics(input);
    expect(after.safe).toBe(true);

    // Restore so later suites see the documented default.
    await setSetting('pricing.lossWarningThreshold', 0);
    await db.$disconnect().catch(() => undefined);
  });
});
