// =============================================================================
// PHASE 18 — financial race + settlement-immutability regression suite.
//
// These tests exist because a real-money platform is only as safe as its
// WORST interleaving. Each one drives the real services (and therefore the
// real SQL: conditional UPDATEs, row locks, ledger writes) twice at the same
// time and asserts on the DATABASE, not on HTTP statuses:
//
//   1. Two admins approving ONE deposit  → exactly one wallet credit.
//   2. Approval racing a rejection         → one terminal status, ledger agrees.
//   3. Withdrawal approve/reject race      → held funds move exactly once.
//   4. Prize settlement pays the roster that PAID, not the roster on file at
//      payout time (leave/kick/join cannot move prize money).
//   5. Two admins distributing at once     → one set of Winner rows, one credit.
//   6. The publication gate                → prizes refuse to settle while any
//                                            match result is unpublished.
//   7. Scoring freeze                      → the formula behind published
//                                            standings cannot be edited later.
//   8. Roster lock + re-auth               → a paid roster is immutable while
//                                            the entry is live, and a
//                                            suspended account loses its token.
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { createDeposit, requestWithdrawal, reviewDeposit, reviewWithdrawal } from '../../src/services/payment.service';
import { distributePrizes, reviewResult, setResultsStatus, submitResult } from '../../src/services/result.service';
import { createMatch } from '../../src/services/match.service';
import { joinTournament } from '../../src/services/tournament.service';
import { createTeam, joinByCode, leaveTeam, teamJoinCode } from '../../src/services/team.service';
import { createTransfer } from '../../src/services/transfer.service';
import crypto from 'node:crypto';
import { setTournamentStatus, updateTournamentScoring } from '../../src/services/admin.service';
import { changePassword } from '../../src/services/auth.service';
import { signAccessToken } from '../../src/lib/tokens';
import { cleanupUsers, db, ledgerIsConsistent, makeTournament, makeUser, rejectsWithCode, uid, walletOf } from '../helpers/db';

const ctx = { ip: '203.0.113.90', userAgent: 'vitest-phase18' };
const created: string[] = [];
const tournamentIds: string[] = [];
const matchIds: string[] = [];

afterAll(async () => {
  await db.matchParticipant.deleteMany({ where: { matchId: { in: matchIds } } });
  await db.match.deleteMany({ where: { id: { in: matchIds } } });
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await cleanupUsers(created);
  await db.$disconnect();
});

async function admin() {
  const a = await makeUser({ role: 'ADMIN', prefix: 'p18adm' });
  created.push(a.id);
  return a;
}
async function player(opts: Parameters<typeof makeUser>[0] = {}) {
  const u = await makeUser({ prefix: 'p18u', ...opts });
  created.push(u.id);
  return u;
}

/** A PENDING deposit from a fresh player (never auto-credited). */
async function pendingDeposit(amount = 500) {
  const u = await player({ cash: 0 });
  const out = await createDeposit(
    u.id,
    { amount, method: 'JAZZCASH', transactionId: uid('TID').toUpperCase(), senderName: 'Test Player', senderAccount: '03001234567' },
    `/uploads/deposits/${uid('p18')}.png`,
    ctx,
    uid('hash'),
  );
  return { user: u, deposit: out.deposit };
}

/**
 * A DUO tournament whose single match is played, verified and PUBLISHED, with
 * the roster still locked (tournament LIVE) — the exact moment a payout would
 * be settled.
 */
async function publishedDuoArena() {
  const t = await makeTournament({
    type: 'DUO',
    entryFee: 100,
    maxSlots: 4,
    prizes: [{ kind: 'PLACEMENT', amount: 100, label: '1st' }],
  });
  tournamentIds.push(t.id);

  const captain = await player({ cash: 1000 });
  const mate = await player({ cash: 1000 });
  const team = await createTeam(captain.id, { name: `P18 ${uid('team')}`, tag: uid('T').toUpperCase().slice(0, 12), type: 'DUO' });
  const { code } = await teamJoinCode(captain.id, team.id, false);
  await joinByCode(mate.id, code!);
  await joinTournament(captain.id, { tournamentSlug: t.slug, teamId: team.id }, ctx.ip);

  const match = await createMatch({
    tournamentId: t.id,
    matchNumber: 1,
    scheduledAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
  matchIds.push(match.id);
  await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
  await db.tournament.update({ where: { id: t.id }, data: { status: 'LIVE' } });

  const submission = await submitResult(captain.id, match.id, { kills: 3, placement: 1 }, null, ctx);
  const ad = await admin();
  await reviewResult(ad.id, submission.id, 'APPROVE', {}, ctx);
  await setResultsStatus(ad.id, match.id, 'UNDER_REVIEW', ctx);
  await setResultsStatus(ad.id, match.id, 'CONFIRMED', ctx);
  await setResultsStatus(ad.id, match.id, 'PUBLISHED', ctx);

  return { tournament: t, captain, mate, teamId: team.id, matchId: match.id, admin: ad };
}

// ---------------------------------------------------------------------------
describe('deposit review — two reviewers cannot both win', () => {
  it('concurrent approvals credit the wallet exactly once', async () => {
    const { user, deposit } = await pendingDeposit(500);
    const [a, b] = await Promise.all([admin(), admin()]);

    const results = await Promise.allSettled([
      reviewDeposit(a.id, deposit.id, 'APPROVE', 'matched', ctx),
      reviewDeposit(b.id, deposit.id, 'APPROVE', 'matched too', ctx),
    ]);
    const accepted = results.filter((r) => r.status === 'fulfilled').length;
    expect(accepted).toBe(1);

    const credits = await db.walletTransaction.count({
      where: { userId: user.id, type: 'DEPOSIT', direction: 'CREDIT' },
    });
    expect(credits).toBe(1);
    expect((await walletOf(user.id)).cash).toBe(500);
    expect(await db.deposit.count({ where: { id: deposit.id, status: 'APPROVED' } })).toBe(1);
    expect(await ledgerIsConsistent(user.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('an approval racing a rejection leaves ONE terminal status that matches the ledger', async () => {
    const { user, deposit } = await pendingDeposit(400);
    const a = await admin();

    await Promise.allSettled([
      reviewDeposit(a.id, deposit.id, 'APPROVE', 'ok', ctx),
      reviewDeposit(a.id, deposit.id, 'REJECT', 'no such transaction', ctx),
    ]);

    const row = await db.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(['APPROVED', 'REJECTED']).toContain(row.status);
    const movements = await db.walletTransaction.count({
      where: { userId: user.id, entityType: 'Deposit', entityId: deposit.id },
    });
    // A rejected deposit must have moved NOTHING; an approved one exactly one credit.
    expect(movements).toBe(row.status === 'APPROVED' ? 1 : 0);
    expect((await walletOf(user.id)).cash).toBe(row.status === 'APPROVED' ? 400 : 0);
  });

  it('a reviewed deposit can never be reviewed again (sequential double click)', async () => {
    const { deposit } = await pendingDeposit(300);
    const a = await admin();
    await reviewDeposit(a.id, deposit.id, 'APPROVE', '', ctx);
    await rejectsWithCode(() => reviewDeposit(a.id, deposit.id, 'REJECT', 'oops', ctx), 'CONFLICT');
  });
});

// ---------------------------------------------------------------------------
describe('withdrawal review — hold is released exactly once', () => {
  it('APPROVE racing REJECT never pays out AND refunds the same hold', async () => {
    const u = await player({ winning: 1000 });
    const { withdrawal } = await requestWithdrawal(
      u.id,
      { amount: 400, method: 'JAZZCASH', accountName: 'Test Player', accountNumber: '03001234567' },
      ctx,
    );
    // Request-time debit into the holding is already visible.
    expect((await walletOf(u.id)).winning).toBe(600);

    const [a, b] = await Promise.all([admin(), admin()]);
    await Promise.allSettled([
      reviewWithdrawal(a.id, withdrawal.id, 'APPROVE', '', '', ctx),
      reviewWithdrawal(b.id, withdrawal.id, 'REJECT', 'details mismatched', '', ctx),
    ]);

    // Whatever the interleaving, the money is in exactly ONE place: still held
    // (approved/queued for payout) or back with the player (rejected) — and the
    // compensating credit exists only in the second case, written once.
    const row = await db.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
    expect(['APPROVED', 'REJECTED']).toContain(row.status);
    const reversals = await db.walletTransaction.count({
      where: { userId: u.id, type: 'WITHDRAWAL_REVERSAL' },
    });
    expect(reversals).toBe(row.status === 'REJECTED' ? 1 : 0);
    expect((await walletOf(u.id)).winning).toBe(row.status === 'REJECTED' ? 1000 : 600);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });

    // A rejected hold can never be revived: the loser of the race cannot be
    // replayed on top of the winner's decision.
    if (row.status === 'REJECTED') {
      await rejectsWithCode(() => reviewWithdrawal(a.id, withdrawal.id, 'APPROVE', '', '', ctx), 'CONFLICT');
      await rejectsWithCode(() => reviewWithdrawal(a.id, withdrawal.id, 'PAID', '', 'REF-1', ctx), 'CONFLICT');
    }
  });

  it('a rejected hold cannot be approved or marked paid afterwards', async () => {
    const u = await player({ winning: 900 });
    const { withdrawal } = await requestWithdrawal(
      u.id,
      { amount: 300, method: 'EASYPAISA', accountName: 'Test Player', accountNumber: '03001234567' },
      ctx,
    );
    const a = await admin();
    await reviewWithdrawal(a.id, withdrawal.id, 'REJECT', 'unverified account', '', ctx);
    await rejectsWithCode(() => reviewWithdrawal(a.id, withdrawal.id, 'APPROVE', '', '', ctx), 'CONFLICT');
    await rejectsWithCode(() => reviewWithdrawal(a.id, withdrawal.id, 'PAID', '', 'REF-2', ctx), 'CONFLICT');
    // Refunded once, and a second refund is impossible.
    expect((await walletOf(u.id)).winning).toBe(900);
    expect(await db.walletTransaction.count({ where: { userId: u.id, type: 'WITHDRAWAL_REVERSAL' } })).toBe(1);
  });

  it('five parallel requests sharing one idempotency key file ONE payout', async () => {
    // This is the case a naive retry loop gets wrong: the duplicate key can
    // mean "the other attempt has not committed yet", not "double submit".
    const u = await player({ winning: 2000 });
    const key = `p18-${uid('idem')}`;
    const call = () => requestWithdrawal(
      u.id,
      { amount: 500, method: 'JAZZCASH', accountName: 'Test Player', accountNumber: '03007777777', requestId: key },
      ctx,
    );
    const settled = await Promise.allSettled(Array.from({ length: 5 }, call));
    const ok = settled.filter((r) => r.status === 'fulfilled');
    // Every racer that succeeded returns the SAME withdrawal — and no racer
    // ever sees a server error that could hide a second payout.
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(ok.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof requestWithdrawal>>>).value.withdrawal.id));
    expect(ids.size).toBe(1);
    expect(settled.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof Error)).toBe(true);
    for (const r of settled.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
      expect((r.reason as { status?: number }).status).toBe(409);
    }
    expect(await db.withdrawal.count({ where: { userId: u.id } })).toBe(1);
    expect(await db.walletTransaction.count({ where: { userId: u.id, type: 'WITHDRAWAL' } })).toBe(1);
    expect((await walletOf(u.id)).winning).toBe(1500);
  });

  it('two simultaneous approvals still advance the payout by one step only', async () => {
    const u = await player({ winning: 1000 });
    const { withdrawal } = await requestWithdrawal(
      u.id,
      { amount: 500, method: 'JAZZCASH', accountName: 'Test Player', accountNumber: '03001234567' },
      ctx,
    );
    const [a, b] = await Promise.all([admin(), admin()]);
    const settled = await Promise.allSettled([
      reviewWithdrawal(a.id, withdrawal.id, 'APPROVE', '', '', ctx),
      reviewWithdrawal(b.id, withdrawal.id, 'APPROVE', '', '', ctx),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.withdrawal.count({ where: { id: withdrawal.id, status: 'APPROVED' } })).toBe(1);
    // No money moved beyond the original request-time hold.
    expect((await walletOf(u.id)).winning).toBe(500);
    expect(await db.walletTransaction.count({ where: { userId: u.id, type: 'WITHDRAWAL_REVERSAL' } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('one wallet, several doors — cross-route double spending', () => {
  it('the same balance cannot pay for two tournaments at once', async () => {
    // PKR 1000 in Cash, PKR 600 entry fee: at most ONE seat can ever be bought,
    // no matter how many join requests are in flight or which event they target.
    const [t1, t2] = [
      await makeTournament({ entryFee: 600, maxSlots: 8 }),
      await makeTournament({ entryFee: 600, maxSlots: 8 }),
    ];
    tournamentIds.push(t1.id, t2.id);
    const u = await player({ cash: 1000 });

    const settled = await Promise.allSettled([
      joinTournament(u.id, { tournamentSlug: t1.slug }, ctx.ip),
      joinTournament(u.id, { tournamentSlug: t2.slug }, ctx.ip),
      joinTournament(u.id, { tournamentSlug: t1.slug }, ctx.ip),
      joinTournament(u.id, { tournamentSlug: t2.slug }, ctx.ip),
    ]);
    const succeeded = settled.filter((r) => r.status === 'fulfilled');
    expect(succeeded.length).toBe(1);
    // Anything that did not get in must have been REFUSED, not crashed: a
    // business rejection (already registered / no funds / lost the seat race).
    // A raw driver code escaping here would be a 500 for the player.
    for (const r of settled.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
      const reason = r.reason as { code?: string; status?: number; name?: string };
      expect(['ALREADY_REGISTERED', 'INSUFFICIENT_BALANCE', 'CONFLICT', 'TOURNAMENT_FULL']).toContain(reason.code);
      expect(reason.name).not.toBe('PrismaClientKnownRequestError');
    }

    const debited = await db.walletTransaction.aggregate({
      _sum: { amount: true },
      where: { userId: u.id, type: 'ENTRY_FEE', direction: 'DEBIT' },
    });
    expect(Number(debited._sum.amount ?? 0)).toBe(600);
    expect((await walletOf(u.id)).cash).toBe(400);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('opposite transfers between two wallets never mint or destroy money', async () => {
    // Deterministic lock ordering (userId) is what keeps this from deadlocking;
    // the ledger is what proves no PKR appeared or disappeared.
    const [a, b] = [await player({ cash: 800 }), await player({ cash: 800 })];
    const racers = Array.from({ length: 4 }, () => [
      createTransfer(a.id, { recipientUsername: b.username, amount: 500, requestId: crypto.randomUUID() }, { ip: ctx.ip }),
      createTransfer(b.id, { recipientUsername: a.username, amount: 500, requestId: crypto.randomUUID() }, { ip: ctx.ip }),
    ]).flat();

    const settled = await Promise.allSettled(racers);
    const ok = settled.filter((r) => r.status === 'fulfilled').length;
    // Money may legitimately flow both ways (each 500 is covered by the 800 on
    // hand plus what arrives), so the count is not the invariant — conservation
    // and "no negative balance, no raw database error" are.
    expect(ok).toBeGreaterThanOrEqual(1);
    for (const r of settled.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
      const status = (r.reason as { status?: number }).status;
      expect(status, `infrastructure error leaked to the caller: ${(r.reason as Error).name}`).toBeLessThan(500);
    }

    const [wa, wb] = await Promise.all([walletOf(a.id), walletOf(b.id)]);
    expect(wa.cash + wb.cash).toBe(1600);
    expect(await ledgerIsConsistent(a.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
    expect(await ledgerIsConsistent(b.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });
});

// ---------------------------------------------------------------------------
describe('prize settlement — pays the roster that paid', () => {
  it('the frozen snapshot is written on every paid member row', async () => {
    const { tournament, captain, mate } = await publishedDuoArena();
    const regs = await db.tournamentRegistration.findMany({
      where: { tournamentId: tournament.id, status: 'CONFIRMED' },
      orderBy: { userId: 'asc' },
    });
    expect(regs).toHaveLength(2);
    const expected = [captain.id, mate.id].sort();
    for (const r of regs) {
      expect(Array.isArray(r.rosterUserIds)).toBe(true);
      expect([...(r.rosterUserIds as string[])].sort()).toEqual(expected);
      expect(r.rosterCapturedAt).toBeInstanceOf(Date);
    }
  });

  it('a player who left (and a ringer who joined afterwards) cannot change the split', async () => {
    const { tournament, captain, mate, teamId, admin: ad } = await publishedDuoArena();
    const ringer = await player({ cash: 1000 });

    // The settlement window: the event has finished, prizes are not yet paid,
    // and the roster lock no longer applies — this is precisely where the old
    // implementation resolved recipients from LIVE membership.
    await db.tournament.update({ where: { id: tournament.id }, data: { status: 'COMPLETED' } });
    await leaveTeam(mate.id, teamId);
    const { code } = await teamJoinCode(captain.id, teamId, false);
    await joinByCode(ringer.id, code!);

    const before = { mate: await walletOf(mate.id), ringer: await walletOf(ringer.id) };
    const out = await distributePrizes(ad.id, tournament.id, ctx);

    expect(out.recipientSource).toBe('REGISTRATION_SNAPSHOT');
    expect(out.reconciliation).toEqual({ awarded: 100, credited: 100, unassignedRemainder: 0 });

    const creditedIds = out.awards[0]!.credited.map((c) => c.userId).sort();
    expect(creditedIds).toEqual([captain.id, mate.id].sort());
    expect((await walletOf(captain.id)).winning).toBe(50);
    expect((await walletOf(mate.id)).winning).toBe(before.mate.winning + 50);
    // The ringer never paid for this seat and must not be paid out of it.
    expect(await db.walletTransaction.count({ where: { userId: ringer.id, type: 'WINNING' } })).toBe(0);
    expect((await walletOf(ringer.id)).winning).toBe(before.ringer.winning);
  });

  it('concurrent distribution creates one set of Winner rows and one credit', async () => {
    const { tournament, captain, mate, admin: ad } = await publishedDuoArena();
    const other = await admin();

    const settled = await Promise.allSettled([
      distributePrizes(ad.id, tournament.id, ctx),
      distributePrizes(other.id, tournament.id, ctx),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    expect(await db.winner.count({ where: { tournamentId: tournament.id } })).toBe(1);
    // 100 awarded, 50 + 50 credited, nothing doubled.
    expect((await walletOf(captain.id)).winning).toBe(50);
    expect((await walletOf(mate.id)).winning).toBe(50);
    const prizeRows = await db.walletTransaction.count({ where: { type: 'WINNING', direction: 'CREDIT' } });
    expect(prizeRows).toBeGreaterThanOrEqual(2);
    expect(await ledgerIsConsistent(captain.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('refuses to settle while ANY match result is unpublished', async () => {
    const { tournament, admin: ad, matchId } = await publishedDuoArena();
    // A second match exists for the same event but has no published result.
    const second = await createMatch({
      tournamentId: tournament.id,
      matchNumber: 99,
      scheduledAt: new Date(Date.now() - 600_000).toISOString(),
    });
    matchIds.push(second.id);
    await rejectsWithCode(() => distributePrizes(ad.id, tournament.id, ctx), 'CONFLICT');
    expect(await db.winner.count({ where: { tournamentId: tournament.id } })).toBe(0);
    expect(matchId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('registration immutability', () => {
  it('a paid roster cannot change while the entry is live', async () => {
    const { mate, teamId } = await publishedDuoArena();
    // Tournament is LIVE with a CONFIRMED paid entry: leaving is refused, and
    // the refusal names the operator path instead of silently corrupting it.
    await expect(leaveTeam(mate.id, teamId)).rejects.toThrow(/Roster is locked/i);
  });

  it('a suspended account cannot spend its still-valid token on a money route', async () => {
    const u = await player({ cash: 1000 });
    const token = signAccessToken({ sub: u.id, role: 'USER', username: u.username });
    await db.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });

    const { requireAuth } = await import('../../src/middleware/auth');
    const rejected = await new Promise<string | undefined>((resolve) => {
      const req = { headers: { authorization: `Bearer ${token}` } } as never;
      void requireAuth(req, {} as never, (err?: unknown) => {
        resolve((err as { message?: string } | undefined)?.message ?? 'no-error');
      });
    });
    expect(rejected).not.toBe('no-error');
    expect(String(rejected)).toMatch(/not active/i);
  });
});

// ---------------------------------------------------------------------------
describe('tournament lifecycle — the generic admin status endpoint', () => {
  it('cancelling a populated event refunds every paid registration, once', async () => {
    const t = await makeTournament({ entryFee: 100, maxSlots: 4 });
    tournamentIds.push(t.id);
    const [p1, p2] = [await player({ cash: 500 }), await player({ cash: 500 })];
    await joinTournament(p1.id, { tournamentSlug: t.slug }, ctx.ip);
    await joinTournament(p2.id, { tournamentSlug: t.slug }, ctx.ip);
    const ad = await admin();
    await setTournamentStatus(ad.id, t.id, 'LIVE', ctx);

    const out = await setTournamentStatus(ad.id, t.id, 'CANCELLED', ctx);
    expect(out.registrationsRefunded).toBe(2);
    expect(out.refundedTotal).toBe(200);
    // Both players are whole again: −100 entry, +100 refund.
    expect((await walletOf(p1.id)).cash).toBe(500);
    expect((await walletOf(p2.id)).cash).toBe(500);
    expect(await db.tournamentRegistration.count({ where: { tournamentId: t.id, status: 'REFUNDED' } })).toBe(2);
    // The refund is a NEW immutable ledger row per registration — never an edit
    // of the original debit, and the debit link is preserved.
    const refunds = await db.walletTransaction.findMany({
      where: { type: 'ENTRY_REFUND', direction: 'CREDIT' },
      orderBy: { createdAt: 'asc' },
    });
    expect(refunds).toHaveLength(2);
    for (const reg of await db.tournamentRegistration.findMany({ where: { tournamentId: t.id } })) {
      expect(reg.walletTxId).toBeTruthy();
      expect(reg.refundWalletTxId).toBeTruthy();
      expect(reg.refundWalletTxId).not.toBe(reg.walletTxId);
    }
    expect(await ledgerIsConsistent(p1.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('two concurrent cancels cannot refund twice', async () => {
    const t = await makeTournament({ entryFee: 150, maxSlots: 4 });
    tournamentIds.push(t.id);
    const p = await player({ cash: 500 });
    await joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip);
    const [a, b] = await Promise.all([admin(), admin()]);
    await setTournamentStatus(a.id, t.id, 'LIVE', ctx);

    await Promise.allSettled([
      setTournamentStatus(a.id, t.id, 'CANCELLED', ctx),
      setTournamentStatus(b.id, t.id, 'CANCELLED', ctx),
    ]);

    expect(await db.walletTransaction.count({ where: { userId: p.id, type: 'ENTRY_REFUND' } })).toBe(1);
    // The loser of the race never left a half-cancelled tournament behind.
    expect(await db.tournament.count({ where: { id: t.id, status: 'CANCELLED' } })).toBe(1);
    expect((await walletOf(p.id)).cash).toBe(500);
  });

  it('illegal lifecycle transitions are refused instead of silently applied', async () => {
    const t = await makeTournament({ entryFee: 0, maxSlots: 4 });
    tournamentIds.push(t.id);
    const ad = await admin();
    await setTournamentStatus(ad.id, t.id, 'LIVE', ctx);
    await db.tournament.update({ where: { id: t.id }, data: { status: 'COMPLETED' } });
    // A finished event cannot be reopened, and a cancelled one cannot be revived.
    await rejectsWithCode(() => setTournamentStatus(ad.id, t.id, 'REGISTRATION_OPEN', ctx), 'CONFLICT');
    await rejectsWithCode(() => setTournamentStatus(ad.id, t.id, 'CANCELLED', ctx), 'CONFLICT');
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('COMPLETED');
  });
});

// ---------------------------------------------------------------------------
describe('sensitive mutations are audited atomically', () => {
  it('a password change revokes sessions and writes its audit row in one commit', async () => {
    const u = await makeUser({ prefix: 'p18pwd' });
    created.push(u.id);
    await changePassword(u.id, u.password, 'Rotated@Passw0rd', ctx);
    const row = await db.auditLog.findFirst({
      where: { actorId: u.id, action: 'PASSWORD_CHANGED', entity: 'User' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row!.after).toMatchObject({ refreshSessionsRevoked: true });
    expect(await db.authToken.count({ where: { userId: u.id, type: 'REFRESH', revokedAt: null } })).toBe(0);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });
});

// ---------------------------------------------------------------------------
describe('scoring freeze', () => {
  it('the formula behind published results cannot be edited afterwards', async () => {
    const { tournament, admin: ad } = await publishedDuoArena();
    await rejectsWithCode(
      () => updateTournamentScoring(ad.id, tournament.id, {
        pointsPerKill: 9, placementPoints: [100, 90, 80, 70], bonusPoints: 0, penaltyPoints: 0,
      }, ctx),
      'CONFLICT',
    );
    const row = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    expect(Number(row.pointsPerKill)).toBe(1); // untouched
  });

  it('scoring stays editable while no match has been played', async () => {
    const t = await makeTournament({ entryFee: 50, maxSlots: 8 });
    tournamentIds.push(t.id);
    const ad = await admin();
    const out = await updateTournamentScoring(ad.id, t.id, {
      pointsPerKill: 3, placementPoints: [10, 8, 6, 5, 4, 3, 2, 1], bonusPoints: 2, penaltyPoints: 1,
    }, ctx);
    expect(out.pointsPerKill).toBe(3);
  });
});
