// =============================================================================
// PHASE 18 — SCALE concurrency suite (§55 / §57 / §87 of the platform brief).
//
// `phase18-races.test.ts` proves the *interleaving* is correct: two writers, one
// loser. This file proves the same guarantees hold when the fan-out is the size
// the brief asks for — 100 joins for 25 seats, 50 withdrawals against 5 wallets,
// 20 simultaneous prize distributions, 10 simultaneous approvals — and it checks
// both halves of a correct concurrency story:
//
//   SAFETY   nothing is ever double-charged, over-sold, over-held or double-paid,
//            no balance goes negative, and the ledger still chains.
//   LIVENESS the event still fills to capacity and the money still lands — a
//            system that refuses everyone is "safe" and useless.
//
// The database is single-writer, so heavy bursts legitimately produce retry
// exhaustion for some clients. That is why each test asserts the invariants
// first, then RE-DRIVES the refused requests once (exactly what a client with a
// "the arena is busy, try again" answer does) and only then asserts the final
// counts. A test that demanded "exactly 25 succeeded on the first attempt" would
// be asserting a scheduling accident, not a guarantee.
//
// Never asserted: DB-wide counts. The database is shared across suites, so every
// query here is scoped to the users/tournament this file created.
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma';
import { joinTournament } from '../../src/services/tournament.service';
import { createDeposit, requestWithdrawal, reviewDeposit, reviewWithdrawal } from '../../src/services/payment.service';
import { distributePrizes, reviewResult, setResultsStatus, submitResult } from '../../src/services/result.service';
import { createMatch } from '../../src/services/match.service';
import { updateProfile } from '../../src/services/auth.service';
import { db, cleanupUsers, ledgerIsConsistent, makeTournament, makeUser, rejectsWithCode, uid, walletOf, type TestUser } from '../helpers/db';

const ctx = { ip: '203.0.113.91', userAgent: 'vitest-phase18-scale' };
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

async function players(count: number, cash: number): Promise<TestUser[]> {
  const out: TestUser[] = [];
  // Chunked so the fixture loop does not itself starve the pool the test measures.
  for (let i = 0; i < count; i += 25) {
    const batch = await Promise.all(Array.from({ length: Math.min(25, count - i) }, () => makeUser({ cash, prefix: 'p18s' })));
    out.push(...batch);
  }
  created.push(...out.map((u) => u.id));
  return out;
}

/** One player, non-optional (the suite runs with noUncheckedIndexedAccess). */
async function player(cash = 0): Promise<TestUser> {
  return (await players(1, cash))[0]!;
}

async function admins(count: number): Promise<string[]> {
  const out = await Promise.all(Array.from({ length: count }, () => makeUser({ role: 'ADMIN', prefix: 'p18sadm' })));
  created.push(...out.map((a) => a.id));
  return out.map((a) => a.id);
}

/** Rejections must be business decisions the client can act on, never raw driver errors. */
const ACCEPTABLE = new Set(['TOURNAMENT_FULL', 'TOURNAMENT_CLOSED', 'INSUFFICIENT_BALANCE', 'ALREADY_REGISTERED', 'CONFLICT', 'VALIDATION_ERROR']);
function assertBusinessRejections(settled: PromiseSettledResult<unknown>[], allow: string[] = [...ACCEPTABLE]) {
  for (const r of settled.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
    const e = r.reason as { code?: string; name?: string; status?: number; message?: string };
    const detail = `${e.name ?? '?'} ${e.code ?? ''} :: ${String(e.message ?? '').split('\n')[0]}`;
    expect(e.name, `infrastructure error escaped to the caller — ${detail}`).not.toBe('PrismaClientKnownRequestError');
    expect(typeof e.status, `error without an HTTP status: ${e.code}`).toBe('number');
    expect(e.status).toBeLessThan(500);
    expect(allow, `unexpected rejection code ${e.code} :: ${String(e.message ?? '').split('\n')[0]}`).toContain(e.code ?? 'NONE');
  }
}

/**
 * Whole-batch ledger audit in two queries: every bucket must chain (each row
 * starts where the previous one for that user+bucket ended), no row may end
 * negative, and the wallet mirror must equal the ledger's final value.
 */
async function auditLedgers(users: TestUser[]) {
  const ids = users.map((u) => u.id);
  const [rows, wallets] = await Promise.all([
    db.walletTransaction.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, bucket: true, direction: true, amount: true, balanceBefore: true, balanceAfter: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.wallet.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, cashBalance: true, winningBalance: true, coinBalance: true, bonusBalance: true },
    }),
  ]);
  const mirror = new Map<string, Record<string, number>>();
  for (const w of wallets) {
    mirror.set(w.userId, {
      CASH: Number(w.cashBalance), WINNING: Number(w.winningBalance), COINS: Number(w.coinBalance), BONUS: Number(w.bonusBalance),
    });
  }
  const last = new Map<string, number>();
  const chainBreaks: string[] = [];
  const negatives: string[] = [];
  for (const r of rows) {
    const key = `${r.userId}:${r.bucket}`;
    const prev = last.get(key);
    if (prev !== undefined && Math.abs(prev - Number(r.balanceBefore)) > 0.005) chainBreaks.push(key);
    if (Number(r.balanceAfter) < -0.0001) negatives.push(key);
    last.set(key, Number(r.balanceAfter));
  }
  const drift: string[] = [];
  for (const [key, final] of last) {
    const [userId, bucket] = key.split(':');
    const actual = mirror.get(userId!)?.[bucket!] ?? 0;
    if (Math.abs(actual - final) > 0.005) drift.push(`${key} ledger=${final} wallet=${actual}`);
  }
  return { rows: rows.length, chainBreaks, negatives, drift };
}

// ---------------------------------------------------------------------------
describe('100 players, 25 seats — capacity under a real burst', () => {
  it('never over-sells, never double-charges, and still fills to capacity', async () => {
    const t = await makeTournament({ type: 'SOLO', entryFee: 100, maxSlots: 25 });
    tournamentIds.push(t.id);
    const field = await players(100, 200); // 200 cash each: exactly one seat affordable

    const burst = async (list: TestUser[]) =>
      Promise.allSettled(list.map((u) => joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip)));

    const first = await burst(field);
    const mid = await db.tournamentRegistration.count({ where: { tournamentId: t.id, status: 'CONFIRMED' } });
    expect(mid, 'capacity was breached by the burst').toBeLessThanOrEqual(25);
    assertBusinessRejections(first);

    // LIVENESS: players who only heard "the arena is busy" ask again — and must get
    // in while seats remain. (Anyone refused because the event is genuinely full
    // simply gets the same clean answer twice.)
    const refused = field.filter((_, i) => first[i]!.status === 'rejected');
    const retry = await burst(refused);

    const confirmed = await db.tournamentRegistration.findMany({
      where: { tournamentId: t.id, status: 'CONFIRMED' },
      select: { userId: true, seatNumber: true, entryAmount: true, rosterUserIds: true },
    });
    expect(confirmed).toHaveLength(25);
    expect(first.filter((r) => r.status === 'fulfilled').length + retry.filter((r) => r.status === 'fulfilled').length)
      .toBeGreaterThanOrEqual(25);

    // Seats: 25 distinct values covering 1..25 — no duplicate seat, no gap, no seat 26.
    const seats = confirmed.map((c) => c.seatNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(new Set(seats).size).toBe(25);
    expect(seats).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(confirmed.map((c) => c.userId)).size).toBe(25);

    // One row per player per event: the unique (tournamentId,userId) index means a
    // retried join can never create a second registration for the same seat.
    expect(await db.tournamentRegistration.groupBy({ by: ['userId'], where: { tournamentId: t.id }, _count: { _all: true } }))
      .toHaveLength(25);

    // Counter vs rows: "registeredSlots" is the number the site displays, so it may
    // never drift from the registrations that actually exist.
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id }, select: { registeredSlots: true } })).registeredSlots).toBe(25);

    // Money: exactly 25 entry fees left the field, and nobody was charged twice.
    const debited = await db.walletTransaction.aggregate({
      _sum: { amount: true }, _count: true,
      where: { userId: { in: field.map((u) => u.id) }, type: 'ENTRY_FEE', direction: 'DEBIT' },
    });
    expect(debited._count).toBe(25);
    expect(Number(debited._sum.amount)).toBe(2500);
    const cash = await db.wallet.aggregate({ _sum: { cashBalance: true }, where: { userId: { in: field.map((u) => u.id) } } });
    expect(Number(cash._sum.cashBalance)).toBe(100 * 200 - 2500);

    const audit = await auditLedgers(field);
    expect(audit.chainBreaks).toEqual([]);
    expect(audit.negatives).toEqual([]);
    expect(audit.drift).toEqual([]);

    // The snapshot is a team-mode concept: a solo entry has no roster to freeze,
    // and must not accidentally borrow one (its own row is the roster).
    expect(confirmed[0]!.rosterUserIds).toBeNull();
  }, 180_000);

  it('a tournament that is full or past its deadline is refused for everyone', async () => {
    const full = await makeTournament({ type: 'SOLO', entryFee: 10, maxSlots: 1 });
    const closed = await makeTournament({ type: 'SOLO', entryFee: 10, maxSlots: 5 });
    tournamentIds.push(full.id, closed.id);
    await db.tournament.update({ where: { id: closed.id }, data: { registrationDeadline: new Date(Date.now() - 60_000) } });
    const a = await player(1000);
    const b = await player(1000);

    await joinTournament(a.id, { tournamentSlug: full.slug }, ctx.ip);
    await rejectsWithCode(() => joinTournament(b.id, { tournamentSlug: full.slug }, ctx.ip), 'TOURNAMENT_FULL');
    await rejectsWithCode(() => joinTournament(b.id, { tournamentSlug: closed.slug }, ctx.ip), 'TOURNAMENT_CLOSED');
    expect(await db.tournamentRegistration.count({ where: { tournamentId: closed.id } })).toBe(0);
    expect((await walletOf(b.id)).cash).toBe(1000); // nothing was held or charged
  });

  it('two accounts cannot both claim one Free Fire UID, however they race', async () => {
    const shared = uid('FF').replace(/[^0-9]/g, '').padEnd(10, '7').slice(0, 10);
    const x = await player(0);
    const y = await player(0);
    await updateProfile(x.id, { fullName: 'X', freeFireUID: shared, freeFireIGN: 'x' });
    const settled = await Promise.allSettled([
      updateProfile(x.id, { freeFireUID: shared }),
      updateProfile(y.id, { freeFireUID: shared }),
    ]);
    assertBusinessRejections(settled, ['FF_UID_TAKEN', 'CONFLICT', 'VALIDATION_ERROR']);
    const holders = await db.userProfile.count({ where: { freeFireUID: shared } });
    expect(holders).toBe(1);
    expect((await db.userProfile.findFirstOrThrow({ where: { userId: y.id } })).freeFireUID).not.toBe(shared);
  });
});

// ---------------------------------------------------------------------------
describe('50 withdrawals against 5 wallets', () => {
  it('holds are never more than the balance, and every hold has one debit', async () => {
    const five = await players(5, 0);
    // 1500 in Winning each: exactly five 300-PKR withdrawals fit per wallet.
    await Promise.all(five.map((u) => db.wallet.update({ where: { userId: u.id }, data: { winningBalance: new Prisma.Decimal(1500) } })));
    const batch = async (users: TestUser[]) =>
      Promise.allSettled(
        users.flatMap((u) => Array.from({ length: 10 }, () =>
          requestWithdrawal(u.id, { amount: 300, method: 'JAZZCASH', accountName: 'Scale Player', accountNumber: '03001234567' }, ctx))),
      );

    const first = await batch(five);
    for (const u of five) {
      const held = await db.withdrawal.count({ where: { userId: u.id, status: 'PENDING' } });
      expect(held, 'more money was held than the wallet ever had').toBeLessThanOrEqual(5);
      expect((await walletOf(u.id)).winning).toBeGreaterThanOrEqual(0);
    }
    assertBusinessRejections(first);

    // Re-drive the refusals once, then assert the settled end state rather than the
    // outcome of any single scheduling accident.
    const retry = await Promise.allSettled(five.flatMap((u) => Array.from({ length: 5 }, () =>
      requestWithdrawal(u.id, { amount: 300, method: 'JAZZCASH', accountName: 'Scale Player', accountNumber: '03001234567' }, ctx))));

    let holds = 0;
    for (const u of five) {
      const held = await db.withdrawal.count({ where: { userId: u.id, status: 'PENDING' } });
      holds += held;
      expect(held).toBe(5);
      expect((await walletOf(u.id)).winning).toBe(0);
      const debits = await db.walletTransaction.aggregate({ _sum: { amount: true }, where: { userId: u.id, type: 'WITHDRAWAL', direction: 'DEBIT' } });
      expect(Number(debits._sum.amount)).toBe(1500);
    }
    expect(holds).toBe(25); // exactly the money that existed is held — not a paisa more
    assertBusinessRejections(retry);
    const audit = await auditLedgers(five);
    expect(audit.chainBreaks).toEqual([]);
    expect(audit.negatives).toEqual([]);
    expect(audit.drift).toEqual([]);
  }, 180_000);

  it('ten admins approving one withdrawal advance it exactly one step', async () => {
    const u = await player(0);
    await db.wallet.update({ where: { userId: u.id }, data: { winningBalance: new Prisma.Decimal(900) } });
    const { withdrawal } = await requestWithdrawal(
      u.id, { amount: 600, method: 'JAZZCASH', accountName: 'Scale Player', accountNumber: '03001234567' }, ctx,
    );
    const crowd = await admins(10);
    const settled = await Promise.allSettled(crowd.map((a) => reviewWithdrawal(a, withdrawal.id, 'APPROVE', 'bulk approve', '', ctx)));
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.withdrawal.count({ where: { id: withdrawal.id, status: 'APPROVED' } })).toBe(1);
    assertBusinessRejections(settled);
    // The hold already exists from the request; approval must not debit a second time.
    const debits = await db.walletTransaction.aggregate({ _sum: { amount: true }, _count: true, where: { userId: u.id, type: 'WITHDRAWAL', direction: 'DEBIT' } });
    expect(debits._count).toBe(1);
    expect(Number(debits._sum.amount)).toBe(600);
    expect(await db.walletTransaction.count({ where: { userId: u.id, type: 'WITHDRAWAL_REVERSAL' } })).toBe(0);
    expect((await walletOf(u.id)).winning).toBe(300);
  });
});

// ---------------------------------------------------------------------------
describe('ten approvals on one deposit, twenty distributions on one event', () => {
  it('a deposit burst credits the wallet once, whatever the admin count', async () => {
    const u = await player(0);
    const { deposit } = await createDeposit(
      u.id,
      { amount: 1200, method: 'JAZZCASH', transactionId: uid('TID').toUpperCase(), senderName: 'Scale Player', senderAccount: '03001234567' },
      `/uploads/deposits/${uid('p18s')}.png`,
      ctx,
      uid('hash'),
    );
    const crowd = await admins(10);
    const settled = await Promise.allSettled(crowd.map((a) => reviewDeposit(a, deposit.id, 'APPROVE', 'verified slip', ctx)));
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    assertBusinessRejections(settled);
    expect((await walletOf(u.id)).cash).toBe(1200);
    expect(await db.walletTransaction.count({ where: { userId: u.id, type: 'DEPOSIT', direction: 'CREDIT' } })).toBe(1);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('twenty simultaneous distributions pay one prize set', async () => {
    const t = await makeTournament({ type: 'SOLO', entryFee: 50, maxSlots: 4, prizes: [{ kind: 'PLACEMENT', amount: 300, label: '1st' }] });
    tournamentIds.push(t.id);
    const champ = await player(500);
    await joinTournament(champ.id, { tournamentSlug: t.slug }, ctx.ip);

    const match = await createMatch({
      tournamentId: t.id, matchNumber: 1, scheduledAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    matchIds.push(match.id);
    await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
    const submission = await submitResult(champ.id, match.id, { kills: 4, placement: 1 }, null, ctx);
    const ref = (await admins(1))[0]!;
    await reviewResult(ref, submission.id, 'APPROVE', {}, ctx);
    await setResultsStatus(ref, match.id, 'UNDER_REVIEW', ctx);
    await setResultsStatus(ref, match.id, 'CONFIRMED', ctx);
    await setResultsStatus(ref, match.id, 'PUBLISHED', ctx);

    const crowd = await admins(20);
    const settled = await Promise.allSettled(crowd.map((a) => distributePrizes(a, t.id, ctx)));
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    assertBusinessRejections(settled);

    expect(await db.winner.count({ where: { tournamentId: t.id } })).toBe(1);
    expect(await db.walletTransaction.count({ where: { userId: champ.id, type: 'WINNING', direction: 'CREDIT' } })).toBe(1);
    expect((await walletOf(champ.id)).winning).toBe(300);
    expect((await walletOf(champ.id)).cash).toBe(450); // 500 - 50 entry fee, untouched by the payout
    expect(await ledgerIsConsistent(champ.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
    // The Winner row is the settlement record: one place, credited once, exact amount.
    const winner = await db.winner.findFirstOrThrow({ where: { tournamentId: t.id } });
    expect(Number(winner.amount)).toBe(300);
    expect(winner.status).toBe('CREDITED');
    expect(winner.userId).toBe(champ.id);
  }, 180_000);
});
