// =============================================================================
// Integration — Phase 14 fraud detection. The two properties that matter most:
//   1. real traffic raises the right alert (and repeats dedupe into one row);
//   2. detection NEVER blocks or alters the request it observes.
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import {
  detectDepositFraud, detectIdenticalResultClaims, detectJoinFailure, detectLoginAbuse,
  detectRefreshReuse, detectRejectedDepositTid, detectWithdrawalFraud, listFraudAlerts,
  raiseFraudAlert, reviewFraudAlert,
} from '../../src/services/fraud.service';
import { createDeposit, requestWithdrawal } from '../../src/services/payment.service';
import { cleanupUsers, db, ledgerIsConsistent, makeUser, rejectsWithCode, setSetting, uid, walletOf } from '../helpers/db';

const ctx = { ip: '203.0.113.60', userAgent: 'vitest' };
const created: string[] = [];

const shot = () => `/uploads/deposits/${uid('p')}.png`;
const hashOf = (salt: number) =>
  crypto.createHash('sha256').update(Buffer.from(`proof-${salt}`)).digest('hex');

afterAll(async () => {
  await db.fraudAlert.deleteMany({});
  await cleanupUsers(created);
  await db.$disconnect();
});

async function deposit(userId: string, amount: number, screenshotHash: string, tid = uid('TID').toUpperCase()) {
  return createDeposit(
    userId,
    { amount, method: 'JAZZCASH', transactionId: tid, senderName: 'Fraud Test' },
    shot(),
    ctx,
    screenshotHash,
  );
}

const alertCount = (kind: string, userId?: string) =>
  db.fraudAlert.count({ where: { kind, ...(userId ? { userId } : {}) } });

describe('raiseFraudAlert', () => {
  it('creates one OPEN alert per event and dedupes repeats', async () => {
    const u = await makeUser();
    created.push(u.id);

    const first = await raiseFraudAlert({
      kind: 'DEPOSIT_BURST', severity: 'MEDIUM', userId: u.id, subject: u.id,
      details: { title: 'burst', count: 6 },
    });
    const second = await raiseFraudAlert({
      kind: 'DEPOSIT_BURST', severity: 'MEDIUM', userId: u.id, subject: u.id,
      details: { title: 'burst', count: 6 },
    });

    expect(first).toBeTruthy();
    expect(second).toBe(first); // same row, not a new one
    expect(await alertCount('DEPOSIT_BURST')).toBe(1);

    const row = await db.fraudAlert.findUniqueOrThrow({ where: { id: first! } });
    expect((row.details as { occurrences?: number }).occurrences).toBe(2);
    expect(row.status).toBe('OPEN');
  });

  it('a changed signal is a different event', async () => {
    const u = await makeUser();
    created.push(u.id);
    await raiseFraudAlert({ kind: 'WITHDRAWAL_BURST', severity: 'MEDIUM', userId: u.id, subject: u.id, details: { count: 4 } });
    await raiseFraudAlert({ kind: 'WITHDRAWAL_BURST', severity: 'MEDIUM', userId: u.id, subject: u.id, details: { count: 5 } });
    expect(await alertCount('WITHDRAWAL_BURST')).toBe(2);
  });

  it('the master switch turns detection off', async () => {
    const u = await makeUser();
    created.push(u.id);
    await setSetting('security.fraudDetectionEnabled', false);
    const id = await raiseFraudAlert({ kind: 'DUPLICATE_PROOF', severity: 'HIGH', userId: u.id, subject: 'off', details: {} });
    expect(id).toBeNull();
    expect(await alertCount('DUPLICATE_PROOF')).toBe(0);
    await setSetting('security.fraudDetectionEnabled', true);
  });
});

describe('deposit detectors', () => {
  it('flags a transaction ID claimed by two accounts', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    created.push(a.id, b.id);
    const tid = uid('DTID').toUpperCase();
    await deposit(a.id, 500, hashOf(1), tid);

    await detectRejectedDepositTid(b.id, tid, 'existing-deposit-id', 500, ctx);
    expect(await alertCount('DUPLICATE_TID')).toBeGreaterThan(0);
  });

  it('flags one screenshot used by two accounts', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    created.push(a.id, b.id);
    const shared = hashOf(42);

    const d1 = await deposit(a.id, 400, shared);
    const d2 = await deposit(b.id, 400, shared);
    await detectDepositFraud(d1.deposit.id, ctx);
    await detectDepositFraud(d2.deposit.id, ctx);

    expect(await alertCount('REUSED_PROOF')).toBeGreaterThan(0);
  });

  it('flags one account submitting the same screenshot twice', async () => {
    const u = await makeUser();
    created.push(u.id);
    const same = hashOf(77);
    const d1 = await deposit(u.id, 300, same);
    const d2 = await deposit(u.id, 300, same);
    await detectDepositFraud(d1.deposit.id, ctx);
    await detectDepositFraud(d2.deposit.id, ctx);
    expect(await alertCount('DUPLICATE_PROOF')).toBeGreaterThan(0);
  });

  it('flags a burst of submissions', async () => {
    const u = await makeUser();
    created.push(u.id);
    for (let i = 0; i < 6; i++) await deposit(u.id, 200, hashOf(100 + i));
    const last = await deposit(u.id, 200, hashOf(999));
    await detectDepositFraud(last.deposit.id, ctx);
    expect(await alertCount('DEPOSIT_BURST')).toBeGreaterThan(0);
  });

  it('flags an amount far outside the player’s own history', async () => {
    const u = await makeUser();
    created.push(u.id);
    await deposit(u.id, 200, hashOf(11));
    await deposit(u.id, 200, hashOf(12));
    const whale = await deposit(u.id, 20_000, hashOf(13));
    await detectDepositFraud(whale.deposit.id, ctx);
    expect(await alertCount('UNUSUAL_DEPOSIT_AMOUNT')).toBeGreaterThan(0);
  });
});

describe('withdrawal detectors', () => {
  it('flags deposit-then-withdraw churn', async () => {
    const u = await makeUser({ winning: 5000 });
    created.push(u.id);
    const dep = await deposit(u.id, 1000, hashOf(31));
    await db.deposit.update({ where: { id: dep.deposit.id }, data: { status: 'APPROVED', reviewedAt: new Date() } });

    const wd = await requestWithdrawal(u.id, { amount: 800, method: 'JAZZCASH', accountName: 'Churn', accountNumber: '03001112223' }, ctx);
    await detectWithdrawalFraud(wd.withdrawal.id, ctx);

    expect(await alertCount('DEPOSIT_WITHDRAW_CHURN')).toBeGreaterThan(0);
  });

  it('flags one payout account used by two players', async () => {
    const [a, b] = [await makeUser({ winning: 5000 }), await makeUser({ winning: 5000 })];
    created.push(a.id, b.id);
    const w1 = await requestWithdrawal(a.id, { amount: 500, method: 'JAZZCASH', accountName: 'A', accountNumber: '03007778889' }, ctx);
    const w2 = await requestWithdrawal(b.id, { amount: 500, method: 'JAZZCASH', accountName: 'B', accountNumber: '03007778889' }, ctx);
    await detectWithdrawalFraud(w1.withdrawal.id, ctx);
    await detectWithdrawalFraud(w2.withdrawal.id, ctx);
    expect(await alertCount('SHARED_PAYOUT_ACCOUNT')).toBeGreaterThan(0);
  });

  it('flags a brand-new account cashing out', async () => {
    const u = await makeUser({ winning: 5000 });
    created.push(u.id);
    const wd = await requestWithdrawal(u.id, { amount: 400, method: 'JAZZCASH', accountName: 'New', accountNumber: '03005556667' }, ctx);
    await detectWithdrawalFraud(wd.withdrawal.id, ctx);
    expect(await alertCount('NEW_ACCOUNT_WITHDRAWAL')).toBeGreaterThan(0);
  });
});

describe('auth detectors', () => {
  it('flags credential stuffing past the threshold and not below it', async () => {
    const u = await makeUser();
    created.push(u.id);
    await detectLoginAbuse(u.username, 2, ctx, u.id);
    expect(await alertCount('CREDENTIAL_STUFFING')).toBe(0);

    await detectLoginAbuse(u.username, 5, ctx, u.id);
    expect(await alertCount('CREDENTIAL_STUFFING')).toBeGreaterThan(0);
  });

  it('flags a replayed refresh token', async () => {
    const u = await makeUser();
    created.push(u.id);
    await detectRefreshReuse(u.id, ctx);
    expect(await alertCount('REFRESH_TOKEN_REUSE')).toBeGreaterThan(0);
  });
});

describe('tournament + result detectors', () => {
  it('flags repeated rejected joins once the threshold passes', async () => {
    const u = await makeUser();
    created.push(u.id);
    // The detector counts TOURNAMENT_JOIN_REJECTED audit rows, as production does.
    for (let i = 0; i < 10; i++) {
      await db.auditLog.create({
        data: { actorId: u.id, action: 'TOURNAMENT_JOIN_REJECTED', entity: 'Tournament', after: { code: 'TOURNAMENT_FULL' } },
      });
    }
    await detectJoinFailure(u.id, 'TOURNAMENT_FULL', 'some-tournament', ctx);
    expect(await alertCount('REPEATED_JOIN_FAILURES', u.id)).toBeGreaterThan(0);
  });

  it('ignores insufficient-balance rejections (normal, not abuse)', async () => {
    const u = await makeUser();
    created.push(u.id);
    await detectJoinFailure(u.id, 'INSUFFICIENT_BALANCE', 'some-tournament', ctx);
    expect(await alertCount('REPEATED_JOIN_FAILURES', u.id)).toBe(0);
  });

  it('flags two players filing identical claims for one match', async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    created.push(u1.id, u2.id);

    const t = await db.tournament.create({
      data: {
        title: `Fraud ${uid('t')}`, slug: uid('fraud'), type: 'SOLO', status: 'LIVE',
        startTime: new Date(Date.now() - 3_600_000), registrationDeadline: new Date(Date.now() - 7_200_000),
        maxSlots: 2, minSlotsToStart: 2, entryFeePerPlayer: 0, pointsPerKill: 1, numWinners: 1,
        refundPercent: 100,
        prizes: { create: [{ kind: 'PLACEMENT', position: 1, amount: 100 }] },
      },
    });
    const match = await db.match.create({
      data: { tournamentId: t.id, matchNumber: 1, scheduledAt: new Date(Date.now() - 3_600_000), status: 'COMPLETED' },
    });
    await db.matchParticipant.createMany({
      data: [
        { matchId: match.id, userId: u1.id, status: 'PLAYED' },
        { matchId: match.id, userId: u2.id, status: 'PLAYED' },
      ],
    });
    const subs = await db.resultSubmission.createMany({
      data: [
        { matchId: match.id, submittedById: u1.id, kills: 9, placement: 1 },
        { matchId: match.id, submittedById: u2.id, kills: 9, placement: 1 },
      ],
    });
    const rows = await db.resultSubmission.findMany({ where: { matchId: match.id } });
    expect(subs.count).toBe(2);

    await detectIdenticalResultClaims(match.id, rows[0]!.id);
    expect(await alertCount('IDENTICAL_RESULT_CLAIMS')).toBeGreaterThan(0);

    await db.tournament.deleteMany({ where: { id: t.id } });
  });
});

describe('detection never interferes with the money', () => {
  it('a heavily flagged player still gets exactly one debit and a clean ledger', async () => {
    const u = await makeUser({ winning: 10_000 });
    created.push(u.id);

    const wd = await requestWithdrawal(u.id, { amount: 1000, method: 'JAZZCASH', accountName: 'Flagged', accountNumber: '03001230001' }, ctx);
    await detectWithdrawalFraud(wd.withdrawal.id, ctx);
    await detectWithdrawalFraud(wd.withdrawal.id, ctx);

    expect((await walletOf(u.id)).winning).toBe(9000);
    expect(await db.withdrawal.count({ where: { userId: u.id } })).toBe(1);
    expect(await db.walletTransaction.count({ where: { userId: u.id, type: 'WITHDRAWAL' } })).toBe(1);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('a detector that throws cannot break the request it watches', async () => {
    // Non-existent ids exercise every early-return/guard path.
    await expect(detectDepositFraud('no-such-deposit', ctx)).resolves.toBeUndefined();
    await expect(detectWithdrawalFraud('no-such-withdrawal', ctx)).resolves.toBeUndefined();
    await expect(detectIdenticalResultClaims('no-match', 'no-submission')).resolves.toBeUndefined();
  });
});

describe('review queue', () => {
  it('lists, filters and paginates for staff', async () => {
    const u = await makeUser();
    created.push(u.id);
    await raiseFraudAlert({ kind: 'DUPLICATE_TID', severity: 'HIGH', userId: u.id, subject: uid('q'), details: { title: 'queue test' } });

    const open = await listFraudAlerts({ status: 'OPEN', page: 1, pageSize: 50 });
    expect(open.items.length).toBeGreaterThan(0);
    expect(open.items.every((i) => i.status === 'OPEN')).toBe(true);
    expect(open.statusCounts.OPEN).toBeGreaterThan(0);
    expect(open.items[0]!.label).toBeTruthy();

    const high = await listFraudAlerts({ severity: 'HIGH', page: 1, pageSize: 50 });
    expect(high.items.every((i) => i.severity === 'HIGH')).toBe(true);
  });

  it('reviewing is idempotent and audited', async () => {
    const u = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(u.id, admin.id);
    const id = (await raiseFraudAlert({ kind: 'COUPON_ABUSE', severity: 'MEDIUM', userId: u.id, subject: uid('r'), details: {} }))!;

    const out = await reviewFraudAlert(admin.id, id, 'REVIEWED', 'checked manually', ctx);
    expect(out.status).toBe('REVIEWED');

    await rejectsWithCode(() => reviewFraudAlert(admin.id, id, 'DISMISSED', '', ctx), 'CONFLICT');
    await rejectsWithCode(() => reviewFraudAlert(admin.id, 'no-such-alert', 'REVIEWED', '', ctx), 'NOT_FOUND');

    const audit = await db.auditLog.findFirst({ where: { actorId: admin.id, action: 'FRAUD_ALERT_REVIEWED' } });
    expect(audit).toBeTruthy();
  });
});
