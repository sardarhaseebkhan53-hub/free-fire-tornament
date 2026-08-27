// =============================================================================
// Integration — the wallet ledger core (Phase 7 + the financial safety rules).
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma';
import { applyWalletTx, convertCashToCoins, moveBalance, TX_OPTS, walletOverview } from '../../src/services/wallet.service';
import { cleanupUsers, db, ledgerIsConsistent, makeUser, rejectsWithCode, walletOf } from '../helpers/db';

const created: string[] = [];

afterAll(async () => {
  await cleanupUsers(created);
  await db.$disconnect();
});

describe('moveBalance — the only way money moves', () => {
  it('credits and debits exactly, recording before/after on every row', async () => {
    const u = await makeUser({ cash: 1000 });
    created.push(u.id);

    await applyWalletTx(u.id, 'CASH', 'CREDIT', 250, 'DEPOSIT', { description: 'test credit' });
    expect((await walletOf(u.id)).cash).toBe(1250);

    await applyWalletTx(u.id, 'CASH', 'DEBIT', 300, 'ENTRY_FEE', { description: 'test debit' });
    expect((await walletOf(u.id)).cash).toBe(950);

    const rows = await db.walletTransaction.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(Number(rows[0]!.balanceBefore)).toBe(1000);
    expect(Number(rows[0]!.balanceAfter)).toBe(1250);
    expect(Number(rows[1]!.balanceBefore)).toBe(1250);
    expect(Number(rows[1]!.balanceAfter)).toBe(950);

    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('refuses to overdraw — and writes nothing when it does', async () => {
    const u = await makeUser({ cash: 100 });
    created.push(u.id);

    await rejectsWithCode(
      () => applyWalletTx(u.id, 'CASH', 'DEBIT', 100.01, 'ENTRY_FEE', {}),
      'INSUFFICIENT_BALANCE',
    );

    expect((await walletOf(u.id)).cash).toBe(100);
    expect(await db.walletTransaction.count({ where: { userId: u.id } })).toBe(0);
  });

  it('refuses zero and negative amounts', async () => {
    const u = await makeUser({ cash: 100 });
    created.push(u.id);
    await rejectsWithCode(() => applyWalletTx(u.id, 'CASH', 'CREDIT', 0, 'DEPOSIT', {}), 'VALIDATION_ERROR');
    await rejectsWithCode(() => applyWalletTx(u.id, 'CASH', 'CREDIT', -50, 'DEPOSIT', {}), 'VALIDATION_ERROR');
  });

  it('keeps the four buckets independent', async () => {
    const u = await makeUser({ cash: 500, winning: 500 });
    created.push(u.id);
    await applyWalletTx(u.id, 'WINNING', 'DEBIT', 500, 'WITHDRAWAL', {});
    const w = await walletOf(u.id);
    expect(w.winning).toBe(0);
    expect(w.cash).toBe(500); // untouched
  });

  it('rolls the whole transaction back when one leg fails', async () => {
    const u = await makeUser({ cash: 100 });
    created.push(u.id);

    await expect(
      db.$transaction(async (tx) => {
        await moveBalance(tx, u.id, 'CASH', 'DEBIT', 60, 'COIN_CONVERSION', {}, 'PKR');
        // Second leg cannot be funded → the first must not survive.
        await moveBalance(tx, u.id, 'CASH', 'DEBIT', 60, 'COIN_CONVERSION', {}, 'PKR');
      }, TX_OPTS),
    ).rejects.toBeTruthy();

    expect((await walletOf(u.id)).cash).toBe(100);
    expect(await db.walletTransaction.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe('coin conversion', () => {
  it('moves cash to coins atomically at the configured rate', async () => {
    const u = await makeUser({ cash: 500 });
    created.push(u.id);
    const out = await convertCashToCoins(u.id, 200);
    const w = await walletOf(u.id);
    expect(w.cash).toBe(300);
    expect(w.coins).toBe(out.coinsCredited);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('refuses a conversion the player cannot fund', async () => {
    const u = await makeUser({ cash: 10 });
    created.push(u.id);
    await rejectsWithCode(() => convertCashToCoins(u.id, 500), 'INSUFFICIENT_BALANCE');
    expect((await walletOf(u.id)).cash).toBe(10);
  });
});

describe('wallet overview', () => {
  it('reports the four balances plus recent ledger rows', async () => {
    const u = await makeUser({ cash: 1000, winning: 250, bonus: 50, coins: 10 });
    created.push(u.id);
    await applyWalletTx(u.id, 'CASH', 'DEBIT', 100, 'ENTRY_FEE', {});

    const view = await walletOverview(u.id);
    expect(view.wallet.cashBalance).toBe(900);
    expect(view.wallet.winningBalance).toBe(250);
    expect(Array.isArray(view.recentTransactions)).toBe(true);
    expect(view.recentTransactions.length).toBeGreaterThan(0);
    expect(view.settings.minDeposit).toBeGreaterThan(0);
    expect(view.pending.deposits).toBe(0);
  });

  it('never returns a negative balance', async () => {
    const u = await makeUser({ cash: 0 });
    created.push(u.id);
    const view = await walletOverview(u.id);
    const { cashBalance, coinBalance, winningBalance, bonusBalance } = view.wallet;
    for (const v of [cashBalance, coinBalance, winningBalance, bonusBalance]) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('ledger integrity under repetition', () => {
  it('stays consistent across many small movements', async () => {
    const u = await makeUser({ cash: 10_000 });
    created.push(u.id);
    for (let i = 0; i < 12; i++) {
      await applyWalletTx(u.id, 'CASH', 'DEBIT', 100.5, 'ENTRY_FEE', { reference: `R${i}` });
    }
    expect((await walletOf(u.id)).cash).toBeCloseTo(10_000 - 12 * 100.5, 2);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('stores amounts as exact decimals, not floats', async () => {
    const u = await makeUser({ cash: 0 });
    created.push(u.id);
    await applyWalletTx(u.id, 'CASH', 'CREDIT', 0.1, 'DEPOSIT', {});
    await applyWalletTx(u.id, 'CASH', 'CREDIT', 0.2, 'DEPOSIT', {});
    const row = await db.walletTransaction.findFirst({
      where: { userId: u.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(row!.balanceAfter).toBeInstanceOf(Prisma.Decimal);
    expect(Number(row!.balanceAfter)).toBe(0.3);
  });
});
