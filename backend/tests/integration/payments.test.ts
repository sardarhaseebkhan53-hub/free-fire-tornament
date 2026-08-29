// =============================================================================
// Integration — manual payments: deposits (never auto-credited) and withdrawals
// (debited at request, reversed on rejection). Phases 7 + 14.
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import {
  cancelWithdrawal, createDeposit, deleteDeposit, listActivePaymentAccounts, reviewDeposit, reviewWithdrawal,
} from '../../src/services/payment.service';
import { png } from '../../scripts/lib/fixtures';
import crypto from 'node:crypto';
import { cleanupUsers, db, ledgerIsConsistent, makeUser, rejectsWithCode, uid, walletOf } from '../helpers/db';

const ctx = { ip: '203.0.113.20', userAgent: 'vitest' };
const created: string[] = [];
const shot = () => `/uploads/deposits/${uid('p')}.png`;
const hash = () => crypto.createHash('sha256').update(png(64, [Math.floor(Math.random() * 255), 7, 9, 255])).digest('hex');

afterAll(async () => {
  await cleanupUsers(created);
  await db.$disconnect();
});

async function deposit(userId: string, amount: number, tid = uid('TID').toUpperCase(), screenshotHash = hash()) {
  return createDeposit(
    userId,
    { amount, method: 'JAZZCASH', transactionId: tid, senderName: 'Test Player', senderAccount: '03001234567' },
    shot(),
    ctx,
    screenshotHash,
  );
}

describe('deposits', () => {
  it('payment destinations are seeded and public-safe', async () => {
    const accounts = await listActivePaymentAccounts();
    expect(accounts.length).toBeGreaterThan(0);
    for (const a of accounts) {
      expect(['JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER']).toContain(a.method);
    }
  });

  it('NEVER auto-credits — the balance only moves on admin approval', async () => {
    const u = await makeUser({ cash: 0 });
    created.push(u.id);
    const out = await deposit(u.id, 750);
    expect(out.deposit.status).toBe('PENDING');
    expect((await walletOf(u.id)).cash).toBe(0);
    expect(await db.walletTransaction.count({ where: { userId: u.id } })).toBe(0);
  });

  it('refuses a duplicate transaction ID, even across different players', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    created.push(a.id, b.id);
    const tid = uid('DUP').toUpperCase();
    await deposit(a.id, 500, tid);
    await rejectsWithCode(() => deposit(b.id, 500, tid), 'DUPLICATE_TRANSACTION');
  });

  it('enforces the configured minimum and maximum', async () => {
    const u = await makeUser();
    created.push(u.id);
    await rejectsWithCode(() => deposit(u.id, 1), 'VALIDATION_ERROR');
    await rejectsWithCode(() => deposit(u.id, 999_999), 'VALIDATION_ERROR');
  });

  it('credits the cash ledger exactly once on approval', async () => {
    const u = await makeUser({ cash: 100 });
    created.push(u.id);
    const { deposit: dep } = await deposit(u.id, 750);

    await reviewDeposit(u.id, dep.id, 'APPROVE', '', ctx);
    expect((await walletOf(u.id)).cash).toBe(850);

    // A second approval must be refused and must not credit again.
    await rejectsWithCode(() => reviewDeposit(u.id, dep.id, 'APPROVE', '', ctx), 'CONFLICT');
    expect((await walletOf(u.id)).cash).toBe(850);

    const credits = await db.walletTransaction.count({ where: { userId: u.id, type: 'DEPOSIT' } });
    expect(credits).toBe(1);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('rejection moves no money at all', async () => {
    const u = await makeUser({ cash: 100 });
    created.push(u.id);
    const { deposit: dep } = await deposit(u.id, 750);

    await reviewDeposit(u.id, dep.id, 'REJECT', 'Screenshot unreadable', ctx);
    expect((await walletOf(u.id)).cash).toBe(100);
    expect(await db.walletTransaction.count({ where: { userId: u.id } })).toBe(0);

    const row = await db.deposit.findUniqueOrThrow({ where: { id: dep.id } });
    expect(row.status).toBe('REJECTED');
    expect(row.adminNote).toBe('Screenshot unreadable');
  });

  it('keeps the content hash used for reused-proof detection', async () => {
    const u = await makeUser();
    created.push(u.id);
    const h = hash();
    const { deposit: dep } = await deposit(u.id, 300, uid('HASH').toUpperCase(), h);
    const row = await db.deposit.findUniqueOrThrow({ where: { id: dep.id } });
    expect(row.screenshotHash).toBe(h);
  });

  it('admin can delete a non-approved deposit and its ledger is untouched', async () => {
    const u = await makeUser();
    created.push(u.id);
    const { deposit: dep } = await deposit(u.id, 250);
    const removed = await deleteDeposit(u.id, dep.id, ctx);
    expect(removed.deleted).toBe(true);
    expect(await db.deposit.findUnique({ where: { id: dep.id } })).toBeNull();
    expect(await db.walletTransaction.count({ where: { userId: u.id, type: 'DEPOSIT' } })).toBe(0);
  });

  it('refuses to delete an approved deposit (money already moved)', async () => {
    const u = await makeUser();
    created.push(u.id);
    const { deposit: dep } = await deposit(u.id, 500);
    await reviewDeposit(u.id, dep.id, 'APPROVE', '', ctx);
    await rejectsWithCode(() => deleteDeposit(u.id, dep.id, ctx), 'CONFLICT');
    expect((await walletOf(u.id)).cash).toBe(500);
  });
});

describe('withdrawals', () => {
  it('REFUSES a withdrawal that exceeds the winning balance', async () => {
    const u = await makeUser({ winning: 500 });
    created.push(u.id);
    await rejectsWithCode(
      () =>
        reviewWithdrawalAndRequest(u.id, 500.01, 'JAZZCASH', '03001234567'),
      'INSUFFICIENT_BALANCE',
    );
    expect((await walletOf(u.id)).winning).toBe(500);
    expect(await db.withdrawal.count({ where: { userId: u.id } })).toBe(0);
  });

  it('can be funded from cash deposits; bonus alone cannot', async () => {
    // A player who added their own money to Cash can withdraw it directly.
    const withCash = await makeUser({ cash: 5000, bonus: 0, winning: 0 });
    created.push(withCash.id);
    const out = await requestWithdrawal(withCash.id, 1000);
    expect(out.withdrawal.status).toBe('PENDING');
    expect((await walletOf(withCash.id)).cash).toBe(4000);

    // Promotional bonus is never a withdrawal source.
    const withBonus = await makeUser({ cash: 0, bonus: 5000, winning: 0 });
    created.push(withBonus.id);
    await rejectsWithCode(
      () => reviewWithdrawalAndRequest(withBonus.id, 1000, 'JAZZCASH', '03001234567'),
      'INSUFFICIENT_BALANCE',
    );
  });

  it('can be split across cash and winning, and cancelling refunds both', async () => {
    const u = await makeUser({ cash: 400, winning: 400 });
    created.push(u.id);
    const { withdrawal } = await requestWithdrawal(u.id, 600);
    const held = await walletOf(u.id);
    expect(held.cash).toBe(0);
    expect(held.winning).toBe(200);

    await cancelWithdrawal(u.id, withdrawal.id, ctx);
    const refunded = await walletOf(u.id);
    expect(refunded.cash).toBe(400);
    expect(refunded.winning).toBe(400);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('debits into a holding at request time', async () => {
    const u = await makeUser({ winning: 1000 });
    created.push(u.id);
    const out = await requestWithdrawal(u.id, 400);
    expect(out.withdrawal.status).toBe('PENDING');
    expect((await walletOf(u.id)).winning).toBe(600);
  });

  it('walks the full approval chain and refuses skipped steps', async () => {
    const u = await makeUser({ winning: 1000 });
    created.push(u.id);
    const { withdrawal } = await requestWithdrawal(u.id, 300);

    // PROCESSING before APPROVED is not allowed.
    await rejectsWithCode(() => reviewWithdrawal(u.id, withdrawal.id, 'PROCESS', '', '', ctx), 'CONFLICT');
    // PAID before PROCESSING is not allowed either.
    await rejectsWithCode(() => reviewWithdrawal(u.id, withdrawal.id, 'PAID', '', 'REF1', ctx), 'CONFLICT');

    await reviewWithdrawal(u.id, withdrawal.id, 'APPROVE', '', '', ctx);
    await reviewWithdrawal(u.id, withdrawal.id, 'PROCESS', '', '', ctx);

    // A payout reference is mandatory to mark as paid.
    await rejectsWithCode(() => reviewWithdrawal(u.id, withdrawal.id, 'PAID', '', '', ctx), 'VALIDATION_ERROR');

    const paid = await reviewWithdrawal(u.id, withdrawal.id, 'PAID', '', 'PAYOUT-123', ctx);
    expect(paid.status).toBe('PAID');
    expect(paid.paidReference).toBe('PAYOUT-123');
    expect((await walletOf(u.id)).winning).toBe(700);
  });

  it('reverses the holding when a withdrawal is rejected', async () => {
    const u = await makeUser({ winning: 1000 });
    created.push(u.id);
    const { withdrawal } = await requestWithdrawal(u.id, 400);
    expect((await walletOf(u.id)).winning).toBe(600);

    await reviewWithdrawal(u.id, withdrawal.id, 'REJECT', 'Account mismatch', '', ctx);
    expect((await walletOf(u.id)).winning).toBe(1000);

    const reversal = await db.walletTransaction.count({ where: { userId: u.id, type: 'WITHDRAWAL_REVERSAL' } });
    expect(reversal).toBe(1);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('reverses the holding when the player cancels', async () => {
    const u = await makeUser({ winning: 1000 });
    created.push(u.id);
    const { withdrawal } = await requestWithdrawal(u.id, 300);
    await cancelWithdrawal(u.id, withdrawal.id, ctx);
    expect((await walletOf(u.id)).winning).toBe(1000);
  });

  it('refuses to cancel once the payout has moved on', async () => {
    const u = await makeUser({ winning: 1000 });
    created.push(u.id);
    const { withdrawal } = await requestWithdrawal(u.id, 300);
    await reviewWithdrawal(u.id, withdrawal.id, 'APPROVE', '', '', ctx);
    await rejectsWithCode(() => cancelWithdrawal(u.id, withdrawal.id, ctx), 'CONFLICT');
  });

  it('refuses to cancel another player\'s withdrawal', async () => {
    const [owner, other] = [await makeUser({ winning: 1000 }), await makeUser()];
    created.push(owner.id, other.id);
    const { withdrawal } = await requestWithdrawal(owner.id, 300);
    await rejectsWithCode(() => cancelWithdrawal(other.id, withdrawal.id, ctx), 'NOT_FOUND');
  });

  it('enforces the minimum withdrawal and validates the payout account', async () => {
    const u = await makeUser({ winning: 5000 });
    created.push(u.id);
    await rejectsWithCode(() => reviewWithdrawalAndRequest(u.id, 1, 'JAZZCASH', '03001234567'), 'VALIDATION_ERROR');
    await rejectsWithCode(() => reviewWithdrawalAndRequest(u.id, 500, 'JAZZCASH', '12345'), 'VALIDATION_ERROR');
    await rejectsWithCode(() => reviewWithdrawalAndRequest(u.id, 500, 'BANK_TRANSFER', 'x'), 'VALIDATION_ERROR');
  });
});

// --- local helpers -----------------------------------------------------------

async function requestWithdrawal(userId: string, amount: number, accountNumber = '03009999999') {
  const { requestWithdrawal: req } = await import('../../src/services/payment.service');
  return req(userId, { amount, method: 'JAZZCASH', accountName: 'Test Player', accountNumber }, ctx);
}

async function reviewWithdrawalAndRequest(userId: string, amount: number, method: 'JAZZCASH' | 'EASYPAISA' | 'BANK_TRANSFER', accountNumber: string) {
  const { requestWithdrawal: req } = await import('../../src/services/payment.service');
  return req(userId, { amount, method, accountName: 'Test Player', accountNumber }, ctx);
}
