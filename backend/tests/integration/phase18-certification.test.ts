// =============================================================================
// PHASE 18 — CERTIFICATION suite. Three questions the scale tier could not ask:
//
//   §A  what happens when ONE player's request arrives twice — and can the loser of
//       that race ever re-seat or re-charge the winner?
//   §B  once a team has paid, is the roster it paid with still the roster the
//       platform honours after membership changes underneath it?
//   §C  after a full lifecycle (deposit → entry fee → prize → withdrawal) does every
//       wallet equal its own ledger, and is platform cash conserved?
//
// Why this file exists: the 100-way surge run against a REAL multi-backend
// PostgreSQL (PHASE18_CERTIFICATION.md) exposed a double-charge that the embedded
// single-writer dev engine cannot produce — the double-join guard evaluated outside
// the tournament row lock, so two tabs both passed the guard, both debited the entry
// fee, one registration row survived, and the loser's upsert re-seated the winner.
// One seat sold, two charged, `registeredSlots` counting a phantom entry. The lock is
// now taken first and the row is created-or-revived, never overwritten. The tests
// below pin the INVARIANT so it cannot quietly come back with a future refactor.
//
// Never asserted: DB-wide counts. The database is shared between suites, so every
// query is scoped to the users and tournaments this file created.
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { joinTournament } from '../../src/services/tournament.service';
import { setTournamentStatus } from '../../src/services/admin.service';
import { createDeposit, requestWithdrawal, reviewDeposit, reviewWithdrawal } from '../../src/services/payment.service';
import { distributePrizes, reviewResult, setResultsStatus, submitResult } from '../../src/services/result.service';
import { createMatch } from '../../src/services/match.service';
import { createTeam, joinByCode, teamJoinCode } from '../../src/services/team.service';
import { cleanupUsers, db, ledgerIsConsistent, makeTournament, makeUser, rejectsWithCode, uid, walletOf, type TestUser } from '../helpers/db';

const ctx = { ip: '203.0.113.92', userAgent: 'vitest-phase18-certification' };
const created: string[] = [];
const tournamentIds: string[] = [];
const matchIds: string[] = [];
const teamIds: string[] = [];

async function player(cash: number, role: 'USER' | 'ADMIN' = 'USER'): Promise<TestUser> {
  const u = await makeUser({ cash, role, prefix: role === 'ADMIN' ? 'p18ca' : 'p18c' });
  created.push(u.id);
  return u;
}

afterAll(async () => {
  await db.matchParticipant.deleteMany({ where: { matchId: { in: matchIds } } });
  await db.match.deleteMany({ where: { id: { in: matchIds } } });
  if (teamIds.length) await db.team.deleteMany({ where: { id: { in: teamIds } } });
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await cleanupUsers(created);
  await db.$disconnect();
});

/** Signed cash total for a set of users: what the ledger says they hold. */
async function ledgerSum(userIds: string[]): Promise<number> {
  const rows = await db.$queryRaw<Array<{ s: number }>>`
    SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)::float AS s
      FROM "wallet_transactions" WHERE "userId" = ANY(${userIds}::text[])
  `;
  return Math.round(Number(rows[0]!.s) * 100) / 100;
}

/** Wallet total across every bucket for the same users. */
async function walletSum(userIds: string[]): Promise<number> {
  const rows = await db.$queryRaw<Array<{ s: number }>>`
    SELECT COALESCE(SUM("cashBalance" + "winningBalance" + "coinBalance" + "bonusBalance"), 0)::float AS s
      FROM "wallets" WHERE "userId" = ANY(${userIds}::text[])
  `;
  return Math.round(Number(rows[0]!.s) * 100) / 100;
}

// ---------------------------------------------------------------------------
describe('§A one player, two simultaneous requests', () => {
  it('charges once, seats once, and counts one slot', async () => {
    const p = await player(500);
    const t = await makeTournament({ entryFee: 100, maxSlots: 10 });
    tournamentIds.push(t.id);

    const settled = await Promise.allSettled([
      joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip),
      joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip),
    ]);
    const accepted = settled.filter((r) => r.status === 'fulfilled').length;
    // Exactly one may succeed; the other must be refused for a reason the player can
    // read (already registered / full / busy) — never a second seat, never a 500.
    expect(accepted).toBe(1);
    const refused = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    expect(['ALREADY_REGISTERED', 'CONFLICT', 'SERVICE_BUSY']).toContain(
      (refused?.reason as { code?: string } | undefined)?.code ?? 'ALREADY_REGISTERED',
    );

    const regs = await db.tournamentRegistration.findMany({ where: { tournamentId: t.id, userId: p.id } });
    expect(regs).toHaveLength(1);
    expect(regs[0]!.status).toBe('CONFIRMED');
    expect(regs[0]!.seatNumber).not.toBeNull();

    const fees = await db.walletTransaction.count({
      where: { userId: p.id, type: 'ENTRY_FEE', direction: 'DEBIT', reference: t.slug },
    });
    expect(fees).toBe(1);
    const fresh = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(fresh.registeredSlots).toBe(1); // no phantom seat burned from capacity
    expect((await walletOf(p.id)).cash).toBe(400); // 500 − one 100 fee
    expect(await ledgerIsConsistent(p.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('a later request cannot re-seat or re-price a paid entry', async () => {
    const p = await player(500);
    const t = await makeTournament({ entryFee: 100, maxSlots: 10 });
    tournamentIds.push(t.id);
    await joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip);

    // Move the seat by hand, the way the buggy upsert used to: the row now says 7.
    await db.tournamentRegistration.update({
      where: { tournamentId_userId: { tournamentId: t.id, userId: p.id } },
      data: { seatNumber: 7 },
    });

    await rejectsWithCode(() => joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip), 'ALREADY_REGISTERED');

    const after = await db.tournamentRegistration.findUniqueOrThrow({
      where: { tournamentId_userId: { tournamentId: t.id, userId: p.id } },
    });
    expect(after.seatNumber).toBe(7); // refused → untouched
    expect(Number(after.entryAmount)).toBe(100);
    expect(await db.walletTransaction.count({ where: { userId: p.id, type: 'ENTRY_FEE', reference: t.slug } })).toBe(1);
  });

  it('a cancelled entry can still be revived, once, at a fresh charge', async () => {
    // The upsert existed to support cancel → re-join. The create-or-revive rewrite
    // must keep that behaviour, or the fix would lock players out of an event they
    // legitimately left.
    const { cancelRegistration } = await import('../../src/services/tournament.service');
    const p = await player(500);
    const t = await makeTournament({ entryFee: 100, maxSlots: 10 });
    tournamentIds.push(t.id);

    await joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip);
    await cancelRegistration(p.id, t.slug);
    expect((await walletOf(p.id)).cash).toBe(500); // refunded in full (refundPercent 100)

    await joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip);
    const regs = await db.tournamentRegistration.findMany({ where: { tournamentId: t.id, userId: p.id } });
    expect(regs).toHaveLength(1); // revived in place, not duplicated
    expect(regs[0]!.status).toBe('CONFIRMED');
    expect((await walletOf(p.id)).cash).toBe(400);
    expect(await ledgerIsConsistent(p.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });
});

// ---------------------------------------------------------------------------
describe('§B the roster a team paid with is the roster that gets paid', () => {
  it('pays every paid member after membership drifts underneath the entry', async () => {
    const t = await makeTournament({
      type: 'DUO', entryFee: 100, maxSlots: 4,
      prizes: [{ kind: 'PLACEMENT', amount: 100, label: '1st' }],
    });
    tournamentIds.push(t.id);

    const captain = await player(1000);
    const mate = await player(1000);
    const team = await createTeam(captain.id, { name: `Cert ${uid('team')}`, tag: uid('CT').toUpperCase().slice(0, 12), type: 'DUO' });
    teamIds.push(team.id);
    const { code } = await teamJoinCode(captain.id, team.id, false);
    await joinByCode(mate.id, code!);

    await joinTournament(captain.id, { tournamentSlug: t.slug, teamId: team.id }, ctx.ip);
    const snapshot = (await db.tournamentRegistration.findMany({
      where: { tournamentId: t.id }, select: { rosterUserIds: true, userId: true },
    })).map((r) => r.rosterUserIds as unknown as string[]);
    expect(snapshot.every((ids) => ids.length === 2 && ids.includes(captain.id) && ids.includes(mate.id))).toBe(true);

    // Settle the event so prizes can be distributed.
    const match = await createMatch({ tournamentId: t.id, matchNumber: 1, scheduledAt: new Date(Date.now() - 3_600_000).toISOString() });
    matchIds.push(match.id);
    await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
    await db.tournament.update({ where: { id: t.id }, data: { status: 'LIVE' } });
    const submission = await submitResult(captain.id, match.id, { kills: 3, placement: 1 }, null, ctx);
    const ad = await player(0, 'ADMIN');
    await reviewResult(ad.id, submission.id, 'APPROVE', {}, ctx);
    for (const next of ['UNDER_REVIEW', 'CONFIRMED', 'PUBLISHED'] as const) {
      await setResultsStatus(ad.id, match.id, next, ctx);
    }

    // Now remove the mate from the TEAM, bypassing every guard — the state the
    // immutable snapshot exists for. A live-membership read would now see one player.
    await db.teamMember.deleteMany({ where: { teamId: team.id, userId: mate.id } });
    expect(await db.teamMember.count({ where: { teamId: team.id } })).toBe(1);

    await distributePrizes(ad.id, t.id, ctx);

    // The mate is paid: the prize follows the paid roster, not the live team.
    expect((await walletOf(captain.id)).winning).toBe(50);
    expect((await walletOf(mate.id)).winning).toBe(50);
    // ONE winner row for the placement, split across the paid roster (the winner row
    // is the entry; the ledger rows are the people).
    expect(await db.winner.count({ where: { tournamentId: t.id } })).toBe(1);
    const paid = await db.walletTransaction.findMany({
      where: { type: 'WINNING', direction: 'CREDIT', userId: { in: [captain.id, mate.id] } },
      select: { userId: true },
    });
    expect(paid.map((p) => p.userId).sort()).toEqual([captain.id, mate.id].sort());
    // And nothing double-paid while the roster was in flux.
    expect(await db.walletTransaction.count({ where: { type: 'WINNING', userId: { in: [captain.id, mate.id] } } })).toBe(2);
  });

  it('refuses to let the paid roster be edited while the entry is live', async () => {
    const t = await makeTournament({ type: 'DUO', entryFee: 100, maxSlots: 4 });
    tournamentIds.push(t.id);
    const captain = await player(1000);
    const mate = await player(1000);
    const team = await createTeam(captain.id, { name: `Cert ${uid('team')}`, tag: uid('CT').toUpperCase().slice(0, 12), type: 'DUO' });
    teamIds.push(team.id);
    const { code } = await teamJoinCode(captain.id, team.id, false);
    await joinByCode(mate.id, code!);
    await joinTournament(captain.id, { tournamentSlug: t.slug, teamId: team.id }, ctx.ip);
    await db.tournament.update({ where: { id: t.id }, data: { status: 'LIVE' } });

    const { removeMember } = await import('../../src/services/team.service');
    await expect(removeMember(captain.id, team.id, mate.id)).rejects.toThrow(/Roster is locked/i);
    expect(await db.teamMember.count({ where: { teamId: team.id } })).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('§C reconciliation after the whole lifecycle', () => {
  it('every wallet equals its own ledger, and the platform neither mints nor loses money', async () => {
    // Opening balances are ZERO and every paisa of funding is an approved deposit, so
    // "wallet == Σcredits − Σdebits" is a real audit rather than a tautology: any write
    // that touches a wallet without a ledger row (or the reverse) breaks it.
    const p = await player(0);
    const mate = await player(0);
    const ad = await player(0, 'ADMIN');
    const t = await makeTournament({
      type: 'DUO', entryFee: 100, maxSlots: 4,
      prizes: [{ kind: 'PLACEMENT', amount: 800, label: '1st' }],
    });
    tournamentIds.push(t.id);

    // 1 — deposits, reviewed by an admin.
    const d1 = await createDeposit(p.id, { amount: 700, method: 'JAZZCASH', transactionId: uid('TID').toUpperCase(), senderName: 'Cert Player', senderAccount: '03001234567' }, `/uploads/deposits/${uid('p18c')}.png`, ctx, uid('hash'));
    const d2 = await createDeposit(mate.id, { amount: 300, method: 'JAZZCASH', transactionId: uid('TID').toUpperCase(), senderName: 'Cert Player', senderAccount: '03001234567' }, `/uploads/deposits/${uid('p18c')}.png`, ctx, uid('hash'));
    await reviewDeposit(ad.id, d1.deposit.id, 'APPROVE', 'matched', ctx);
    await reviewDeposit(ad.id, d2.deposit.id, 'APPROVE', 'matched', ctx);
    expect((await walletOf(p.id)).cash).toBe(700);
    expect((await walletOf(mate.id)).cash).toBe(300);

    // 2 — team up and pay the entry fee (each member pays their own share).
    const team = await createTeam(p.id, { name: `Cert ${uid('team')}`, tag: uid('CT').toUpperCase().slice(0, 12), type: 'DUO' });
    teamIds.push(team.id);
    const { code } = await teamJoinCode(p.id, team.id, false);
    await joinByCode(mate.id, code!);
    await joinTournament(p.id, { tournamentSlug: t.slug, teamId: team.id }, ctx.ip);
    expect((await walletOf(p.id)).cash).toBe(600);
    expect((await walletOf(mate.id)).cash).toBe(200);

    // 3 — the event is settled and prizes land in the winning wallets.
    const match = await createMatch({ tournamentId: t.id, matchNumber: 1, scheduledAt: new Date(Date.now() - 3_600_000).toISOString() });
    matchIds.push(match.id);
    await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
    await db.tournament.update({ where: { id: t.id }, data: { status: 'LIVE' } });
    const submission = await submitResult(p.id, match.id, { kills: 5, placement: 1 }, null, ctx);
    await reviewResult(ad.id, submission.id, 'APPROVE', {}, ctx);
    for (const next of ['UNDER_REVIEW', 'CONFIRMED', 'PUBLISHED'] as const) {
      await setResultsStatus(ad.id, match.id, next, ctx);
    }
    await distributePrizes(ad.id, t.id, ctx);
    expect((await walletOf(p.id)).winning).toBe(400);
    expect((await walletOf(mate.id)).winning).toBe(400);

    // 4 — cash out, including a rejection so a released hold is exercised too.
    const wd0 = await requestWithdrawal(p.id, { amount: 300, method: 'JAZZCASH', accountName: 'Cert Player', accountNumber: '03001234567' }, ctx);
    await reviewWithdrawal(ad.id, wd0.withdrawal.id, 'REJECT', 'wrong account number', '', ctx);
    expect((await walletOf(p.id)).winning).toBe(400); // hold released, nothing moved
    const wd1 = await requestWithdrawal(p.id, { amount: 300, method: 'JAZZCASH', accountName: 'Cert Player', accountNumber: '03001234567' }, ctx);
    await reviewWithdrawal(ad.id, wd1.withdrawal.id, 'APPROVE', 'paid out', 'PAY-1', ctx);
    // A withdrawal is held from CASH first and only reaches into WINNING when cash
    // cannot cover it, so the prize wallet is untouched here and the totals below
    // still have to reconcile.
    expect((await walletOf(p.id)).cash).toBe(300);
    expect((await walletOf(p.id)).winning).toBe(400);

    // ---- reconciliation ------------------------------------------------------
    // (a) per wallet: the ledger chain ends exactly where the wallet stands, with no
    //     negative step and no gap in the running balance.
    for (const u of [p, mate, ad]) {
      expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
    }
    // (b) platform-wide, the auditor's query: Σ wallet balances == Σ signed ledger
    //     amounts for the same people. Both halves of §C must agree to the paisa.
    const ids = [p.id, mate.id, ad.id];
    expect(await walletSum(ids)).toBe(await ledgerSum(ids));
    // (c) nothing negative anywhere in this slice of the ledger.
    const negatives = await db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM "wallet_transactions"
       WHERE "userId" = ANY(${ids}::text[]) AND "balanceAfter" < 0
    `;
    expect(negatives[0]!.n).toBe(0);
    // (d) and the arithmetic of the lifecycle itself: 1000 deposited, 200 in entry
    //     fees (out of the wallets, into the event), 800 paid out as prize, 300
    //     withdrawn ⇒ 1300 still sitting in player wallets.
    expect(await walletSum(ids)).toBe(1300);
  });
});

// ---------------------------------------------------------------------------
describe('§D one settlement, however many times it is clicked', () => {
  it('100 simultaneous "distribute prizes" requests settle the event exactly once', async () => {
    const t = await makeTournament({
      type: 'DUO', entryFee: 100, maxSlots: 4,
      prizes: [{ kind: 'PLACEMENT', amount: 800, label: '1st' }],
    });
    tournamentIds.push(t.id);
    const captain = await player(1000);
    const mate = await player(1000);
    const team = await createTeam(captain.id, { name: `Cert ${uid('team')}`, tag: uid('CT').toUpperCase().slice(0, 12), type: 'DUO' });
    teamIds.push(team.id);
    const { code } = await teamJoinCode(captain.id, team.id, false);
    await joinByCode(mate.id, code!);
    await joinTournament(captain.id, { tournamentSlug: t.slug, teamId: team.id }, ctx.ip);

    const match = await createMatch({ tournamentId: t.id, matchNumber: 1, scheduledAt: new Date(Date.now() - 3_600_000).toISOString() });
    matchIds.push(match.id);
    await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
    await db.tournament.update({ where: { id: t.id }, data: { status: 'LIVE' } });
    const submission = await submitResult(captain.id, match.id, { kills: 3, placement: 1 }, null, ctx);
    const a1 = await player(0, 'ADMIN');
    const a2 = await player(0, 'ADMIN');
    const a3 = await player(0, 'ADMIN');
    await reviewResult(a1.id, submission.id, 'APPROVE', {}, ctx);
    for (const next of ['UNDER_REVIEW', 'CONFIRMED', 'PUBLISHED'] as const) {
      await setResultsStatus(a1.id, match.id, next, ctx);
    }

    // 100 distribution requests, three different admins, all in flight at once.
    const admins = [a1, a2, a3];
    const settled = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) => distributePrizes(admins[i % 3]!.id, t.id, ctx)),
    );
    const accepted = settled.filter((r) => r.status === 'fulfilled').length;
    expect(accepted).toBe(1);
    // The other 99 must be refused for a reason that means "already settled", not 500.
    for (const r of settled.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      const code2 = (r.reason as { code?: string; status?: number } | undefined)?.code;
      const status = (r.reason as { status?: number } | undefined)?.status;
      expect(['CONFLICT', 'BAD_REQUEST', 'NOT_FOUND', 'SERVICE_BUSY']).toContain(code2 ?? (status && status < 500 ? 'BAD_REQUEST' : 'SERVER_ERROR'));
    }

    // ---- every artifact agrees (this is the certification, not the count) -----
    expect(await db.winner.count({ where: { tournamentId: t.id } })).toBe(1);
    const credits = await db.walletTransaction.findMany({
      where: { type: 'WINNING', direction: 'CREDIT', userId: { in: [captain.id, mate.id] } },
      select: { userId: true, amount: true },
    });
    expect(credits).toHaveLength(2); // one per paid member — 100 clicks, 800 PKR, once
    expect(credits.reduce((s, c) => s + Number(c.amount), 0)).toBe(800);
    expect((await walletOf(captain.id)).winning).toBe(400);
    expect((await walletOf(mate.id)).winning).toBe(400);
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('COMPLETED');
    expect(await db.auditLog.count({ where: { entity: 'Tournament', entityId: t.id, action: 'PRIZES_DISTRIBUTED' } })).toBe(1);
    expect(await ledgerIsConsistent(captain.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
    expect(await ledgerIsConsistent(mate.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });
});

// ---------------------------------------------------------------------------
describe('§E an admin cancels the event while players are joining', () => {
  it('refunds every entry that made it in, charges none that did not, and never leaves a paid-but-cancelled seat', async () => {
    const t = await makeTournament({ entryFee: 100, maxSlots: 25 });
    tournamentIds.push(t.id);
    const crowd = await Promise.all(Array.from({ length: 25 }, () => player(400)));
    const ad = await player(0, 'ADMIN');

    // One entry is confirmed up front so the REFUND side of this test is always
    // exercised; the remaining 24 race against the cancel and may or may not get in,
    // depending on how the engine interleaves them. Which side wins is not the
    // invariant — that every charged entry is refunded and none is lost is.
    await joinTournament(crowd[0]!.id, { tournamentSlug: t.slug }, ctx.ip);
    const joins = crowd.slice(1).map((u) => joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip));
    const cancel = setTournamentStatus(ad.id, t.id, 'CANCELLED', ctx);
    const settledJoins = await Promise.allSettled(joins);
    await expect(cancel).resolves.toBeTruthy();

    const accepted = 1 + settledJoins.filter((r) => r.status === 'fulfilled').length;

    const regs = await db.tournamentRegistration.findMany({
      where: { tournamentId: t.id },
      select: { userId: true, status: true, entryAmount: true, refundWalletTxId: true },
    });
    expect(regs).toHaveLength(accepted);
    // Every entry that was charged is refunded; nothing is left CONFIRMED under a
    // CANCELLED event, and no refund exists without a charge behind it.
    for (const r of regs) {
      expect(['REFUNDED', 'CANCELLED']).toContain(r.status);
      expect(r.refundWalletTxId).not.toBeNull();
    }
    // The entry that was paid for BEFORE the cancel is refunded too.
    expect((await db.tournamentRegistration.findFirst({ where: { tournamentId: t.id, userId: crowd[0]!.id } }))!.status).not.toBe('CONFIRMED');
    for (const u of crowd) {
      const debits = await db.walletTransaction.count({ where: { userId: u.id, type: 'ENTRY_FEE', direction: 'DEBIT', reference: t.slug } });
      const credits = await db.walletTransaction.count({ where: { userId: u.id, type: 'ENTRY_REFUND', direction: 'CREDIT' } });
      expect(credits).toBe(debits); // exactly one refund per charge, however the race fell
      expect((await walletOf(u.id)).cash).toBe(400); // whole stack back
      expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
    }
    expect(await db.tournamentRegistration.count({ where: { tournamentId: t.id, status: 'CONFIRMED' } })).toBe(0);
    const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('CANCELLED');
    // Nobody can join a cancelled event afterwards, whatever the counter says.
    const outsider = await player(400);
    await rejectsWithCode(() => joinTournament(outsider.id, { tournamentSlug: t.slug }, ctx.ip), 'TOURNAMENT_CLOSED');
  });
});
