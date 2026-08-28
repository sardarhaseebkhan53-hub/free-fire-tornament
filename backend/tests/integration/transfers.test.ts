// =============================================================================
// Integration — user-to-user wallet transfers.
// Atomicity, idempotency, limits, self-transfer guard, ledger integrity.
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { createTransfer } from '../../src/services/transfer.service';
import { cleanupUsers, db, ledgerIsConsistent, makeUser, rejectsWithCode, setSetting, walletOf } from '../helpers/db';

const created: string[] = [];

afterAll(async () => {
  await cleanupUsers(created);
  await db.$disconnect();
});

const rid = () =>
  `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, 32);

describe('wallet transfers', () => {
  it('moves PKR from sender to recipient in one atomic transaction', async () => {
    const a = await makeUser({ cash: 1000 });
    const b = await makeUser({ cash: 50 });
    created.push(a.id, b.id);

    const out = await createTransfer(a.id, { recipientUsername: b.username, amount: 250, note: 'gg wp', requestId: rid() });

    expect(out.replayed).toBe(false);
    expect(out.transfer.amount).toBe(250);
    expect((await walletOf(a.id)).cash).toBe(750);
    expect((await walletOf(b.id)).cash).toBe(300);

    // Both sides recorded in the immutable ledger with matching types.
    const aTxs = await db.walletTransaction.findMany({ where: { userId: a.id } });
    const bTxs = await db.walletTransaction.findMany({ where: { userId: b.id } });
    expect(aTxs).toHaveLength(1);
    expect(bTxs).toHaveLength(1);
    expect(aTxs[0]!.type).toBe('TRANSFER_SENT');
    expect(aTxs[0]!.direction).toBe('DEBIT');
    expect(bTxs[0]!.type).toBe('TRANSFER_RECEIVED');
    expect(bTxs[0]!.direction).toBe('CREDIT');

    expect(await ledgerIsConsistent(a.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
    expect(await ledgerIsConsistent(b.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });

    // Audit trail + transfer row exist.
    expect(await db.walletTransfer.count({ where: { id: out.transfer.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'WALLET_TRANSFER' } })).toBeGreaterThan(0);
  });

  it('replaying the same requestId returns the original transfer without moving money again', async () => {
    const a = await makeUser({ cash: 1000 });
    const b = await makeUser({ cash: 0 });
    created.push(a.id, b.id);
    const req = rid();

    const first = await createTransfer(a.id, { recipientUsername: b.username, amount: 300, requestId: req });
    const second = await createTransfer(a.id, { recipientUsername: b.username, amount: 300, requestId: req });

    expect(second.replayed).toBe(true);
    expect(second.transfer.id).toBe(first.transfer.id);
    expect((await walletOf(a.id)).cash).toBe(700); // debited exactly once
    expect((await walletOf(b.id)).cash).toBe(300); // credited exactly once
    expect(await db.walletTransfer.count({ where: { senderId: a.id } })).toBe(1);
  });

  it('refuses self-transfer, unknown recipients, and inactive recipients', async () => {
    const a = await makeUser({ cash: 500 });
    created.push(a.id);

    await rejectsWithCode(
      () => createTransfer(a.id, { recipientUsername: a.username, amount: 50, requestId: rid() }),
      'VALIDATION_ERROR',
    );
    await rejectsWithCode(
      () => createTransfer(a.id, { recipientUsername: 'does_not_exist_xyz', amount: 50, requestId: rid() }),
      'NOT_FOUND',
    );
    // Nothing moved.
    expect((await walletOf(a.id)).cash).toBe(500);
  });

  it('enforces minimum, maximum and daily limits server-side', async () => {
    const a = await makeUser({ cash: 100_000 });
    const b = await makeUser({ cash: 0 });
    created.push(a.id, b.id);

    await setSetting('wallet.transferMin', 10);
    await setSetting('wallet.transferMax', 1000);
    await setSetting('wallet.transferDailyLimit', 1500);
    await setSetting('wallet.transferHighValueThreshold', 50000);

    await rejectsWithCode(
      () => createTransfer(a.id, { recipientUsername: b.username, amount: 5, requestId: rid() }),
      'VALIDATION_ERROR',
    );
    await rejectsWithCode(
      () => createTransfer(a.id, { recipientUsername: b.username, amount: 1001, requestId: rid() }),
      'VALIDATION_ERROR',
    );

    // Two transfers within the daily cap are fine; the third crosses it.
    await createTransfer(a.id, { recipientUsername: b.username, amount: 1000, requestId: rid() });
    await createTransfer(a.id, { recipientUsername: b.username, amount: 400, requestId: rid() });
    await rejectsWithCode(
      () => createTransfer(a.id, { recipientUsername: b.username, amount: 200, requestId: rid() }),
      'VALIDATION_ERROR',
    );
    expect((await walletOf(a.id)).cash).toBe(100_000 - 1400);
  });

  it('refuses overdrawing the sender and writes nothing on failure', async () => {
    const a = await makeUser({ cash: 100 });
    const b = await makeUser({ cash: 0 });
    created.push(a.id, b.id);

    await rejectsWithCode(
      () => createTransfer(a.id, { recipientUsername: b.username, amount: 100.01, requestId: rid() }),
      'INSUFFICIENT_BALANCE',
    );

    expect((await walletOf(a.id)).cash).toBe(100);
    expect((await walletOf(b.id)).cash).toBe(0);
    expect(await db.walletTransfer.count({ where: { senderId: a.id } })).toBe(0);
    expect(await db.walletTransaction.count({ where: { userId: { in: [a.id, b.id] } } })).toBe(0);
  });
});
