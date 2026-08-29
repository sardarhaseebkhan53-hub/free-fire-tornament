// =============================================================================
// Integration — results verification and IDEMPOTENT prize distribution (Phase 8).
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { distributePrizes, reviewResult, setResultsStatus, submitResult, tournamentStandings } from '../../src/services/result.service';
import { createMatch } from '../../src/services/match.service';
import { joinTournament } from '../../src/services/tournament.service';
import { cleanupUsers, db, ledgerIsConsistent, makeTournament, makeUser, rejectsWithCode, uid, walletOf } from '../helpers/db';

const ctx = { ip: '203.0.113.40', userAgent: 'vitest' };
const created: string[] = [];
const tournamentIds: string[] = [];

afterAll(async () => {
  await db.winner.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await cleanupUsers(created);
  await db.$disconnect();
});

/** A completed solo tournament with N joined players and one completed match. */
async function completedTournament(playerCount: number, entryFee = 100) {
  const t = await makeTournament({
    entryFee,
    maxSlots: playerCount,
    prizes: [
      { kind: 'PLACEMENT', amount: 300, label: '1st' },
      { kind: 'PLACEMENT', amount: 200, label: '2nd' },
      { kind: 'PLACEMENT', amount: 100, label: '3rd' },
      { kind: 'KILL_POOL', amount: 0, perKill: 10, cap: 200, label: 'Kill pool' },
      { kind: 'MVP', amount: 50, label: 'MVP' },
    ],
  });
  tournamentIds.push(t.id);

  const players = await Promise.all(
    Array.from({ length: playerCount }, () => makeUser({ cash: 1000, prefix: 'prz' })),
  );
  created.push(...players.map((p) => p.id));
  for (const p of players) await joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip);

  const match = await createMatch({
    tournamentId: t.id,
    matchNumber: 1,
    scheduledAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
  await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
  await db.tournament.update({ where: { id: t.id }, data: { status: 'LIVE' } });

  return { tournament: t, players, matchId: match.id };
}

describe('result submission', () => {
  it('only participants of a completed match may submit', async () => {
    const { matchId } = await completedTournament(2);
    const outsider = await makeUser({ cash: 500 });
    created.push(outsider.id);
    await rejectsWithCode(() => submitResult(outsider.id, matchId, { kills: 5, placement: 1 }, null, ctx), 'FORBIDDEN');
  });

  it('refuses to submit before the match is completed', async () => {
    const t = await makeTournament({ entryFee: 100, maxSlots: 1 });
    tournamentIds.push(t.id);
    const u = await makeUser({ cash: 1000 });
    created.push(u.id);
    await joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip);
    const match = await createMatch({
      tournamentId: t.id,
      matchNumber: 1,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await rejectsWithCode(() => submitResult(u.id, match.id, { kills: 1, placement: 1 }, null, ctx), 'VALIDATION_ERROR');
  });

  it('allows one live submission per player per match', async () => {
    const { matchId, players } = await completedTournament(1);
    await submitResult(players[0]!.id, matchId, { kills: 4, placement: 1 }, null, ctx);
    await rejectsWithCode(() => submitResult(players[0]!.id, matchId, { kills: 9, placement: 1 }, null, ctx), 'CONFLICT');
  });
});

describe('verification', () => {
  it('approval writes placement points + kills × rate and updates stats', async () => {
    const { matchId, players, tournament } = await completedTournament(1);
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);

    const sub = await submitResult(players[0]!.id, matchId, { kills: 7, placement: 1 }, null, ctx);
    const out = await reviewResult(admin.id, sub.id, 'APPROVE', {}, ctx);
    expect(out.status).toBe('VERIFIED');

    const participant = await db.matchParticipant.findFirstOrThrow({ where: { matchId, userId: players[0]!.id } });
    // placement 1 → 12 points, + 7 kills × 1 point per kill
    expect(participant.points).toBe(19);

    const stats = await db.playerStat.findUniqueOrThrow({ where: { userId: players[0]!.id } });
    expect(stats.kills).toBe(7);
    expect(stats.totalPoints).toBe(19);
    expect(stats.matchesPlayed).toBe(1);
    expect(stats.wins).toBe(1);
    expect(tournament.id).toBeTruthy();
  });

  it('an admin override replaces the player-claimed numbers', async () => {
    const { matchId, players } = await completedTournament(1);
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);

    const sub = await submitResult(players[0]!.id, matchId, { kills: 99, placement: 1 }, null, ctx);
    await reviewResult(admin.id, sub.id, 'APPROVE', { placement: 3, kills: 2 }, ctx);

    const participant = await db.matchParticipant.findFirstOrThrow({ where: { matchId, userId: players[0]!.id } });
    expect(participant.placement).toBe(3);
    expect(participant.kills).toBe(2);
    expect(participant.points).toBe(8 + 2); // 3rd place = 8 points
  });

  it('cannot verify the same submission twice', async () => {
    const { matchId, players } = await completedTournament(1);
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);
    const sub = await submitResult(players[0]!.id, matchId, { kills: 3, placement: 2 }, null, ctx);
    await reviewResult(admin.id, sub.id, 'APPROVE', {}, ctx);
    await rejectsWithCode(() => reviewResult(admin.id, sub.id, 'APPROVE', {}, ctx), 'CONFLICT');
  });

  it('disqualification excludes the player and reverts their stats', async () => {
    const { matchId, players } = await completedTournament(1);
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);

    const sub = await submitResult(players[0]!.id, matchId, { kills: 5, placement: 1 }, null, ctx);
    await reviewResult(admin.id, sub.id, 'DISQUALIFY', { note: 'teaming' }, ctx);

    const participant = await db.matchParticipant.findFirstOrThrow({ where: { matchId, userId: players[0]!.id } });
    expect(participant.status).toBe('DISQUALIFIED');
    const stats = await db.playerStat.findUnique({ where: { userId: players[0]!.id } });
    expect(stats?.kills ?? 0).toBe(0);
    expect(stats?.totalPoints ?? 0).toBe(0);
  });
});

describe('standings', () => {
  it('ranks by points, breaking ties on kills', async () => {
    const { matchId, players, tournament } = await completedTournament(3);
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);

    const claims: Array<[string, number, number]> = [
      [players[0]!.id, 1, 3],
      [players[1]!.id, 2, 6],
      [players[2]!.id, 3, 1],
    ];
    for (const [pid, placement, kills] of claims) {
      const s = await submitResult(pid, matchId, { kills, placement }, null, ctx);
      await reviewResult(admin.id, s.id, 'APPROVE', {}, ctx);
    }

    const { standings } = await tournamentStandings(tournament.id);
    expect(standings.map((s) => s.points)).toEqual([...standings.map((s) => s.points)].sort((a, b) => b - a));
    expect(standings[0]!.points).toBe(12 + 3); // 1st place = 12 points + 3 kills
  });
});

describe('prize distribution — idempotent', () => {
  it('credits placement + capped kill pool + MVP exactly once', async () => {
    const { matchId, players, tournament } = await completedTournament(3);
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);

    const claims: Array<[string, number, number]> = [
      [players[0]!.id, 1, 10],
      [players[1]!.id, 2, 4],
      [players[2]!.id, 3, 1],
    ];
    for (const [pid, placement, kills] of claims) {
      const s = await submitResult(pid, matchId, { kills, placement }, null, ctx);
      await reviewResult(admin.id, s.id, 'APPROVE', {}, ctx);
    }
    await setResultsStatus(admin.id, matchId, 'UNDER_REVIEW', ctx);
    await setResultsStatus(admin.id, matchId, 'CONFIRMED', ctx);
    await setResultsStatus(admin.id, matchId, 'PUBLISHED', ctx);

    const first = await distributePrizes(admin.id, tournament.id, ctx);
    expect(first.awards.length).toBeGreaterThan(0);

    const w1 = await walletOf(players[0]!.id);
    const winners = await db.winner.count({ where: { tournamentId: tournament.id } });

    // Second run must be refused…
    await rejectsWithCode(() => distributePrizes(admin.id, tournament.id, ctx), 'CONFLICT');

    // …and must not credit a single extra rupee.
    const w2 = await walletOf(players[0]!.id);
    expect(w2.winning).toBe(w1.winning);
    expect(await db.winner.count({ where: { tournamentId: tournament.id } })).toBe(winners);

    // The winner is actually paid, through the ledger.
    expect(w1.winning).toBeGreaterThan(0);
    expect(await ledgerIsConsistent(players[0]!.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });

    const tRow = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    expect(tRow.status).toBe('COMPLETED');
  });

  it('the kill pool never pays more than its cap', async () => {
    const { matchId, players, tournament } = await completedTournament(3);
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);

    // 40 kills × 10 PKR = 400 wanted, but the cap is 200.
    const claims: Array<[string, number, number]> = [
      [players[0]!.id, 1, 20],
      [players[1]!.id, 2, 15],
      [players[2]!.id, 3, 5],
    ];
    for (const [pid, placement, kills] of claims) {
      const s = await submitResult(pid, matchId, { kills, placement }, null, ctx);
      await reviewResult(admin.id, s.id, 'APPROVE', {}, ctx);
    }
    await setResultsStatus(admin.id, matchId, 'UNDER_REVIEW', ctx);
    await setResultsStatus(admin.id, matchId, 'CONFIRMED', ctx);
    await setResultsStatus(admin.id, matchId, 'PUBLISHED', ctx);

    const out = await distributePrizes(admin.id, tournament.id, ctx);
    // Kill-pool awards are labelled "Kill Pool — <player>" and sit in the
    // 100+ position namespace; placement awards are 1..N and MVP is 200.
    const killAwards = out.awards.filter((a) => a.label.startsWith('Kill Pool'));
    expect(killAwards.length).toBeGreaterThan(0);
    const killTotal = killAwards.reduce((sum, a) => sum + a.amount, 0);
    expect(killTotal).toBeLessThanOrEqual(200); // the configured cap
  });

  it('refuses to distribute before any result is verified', async () => {
    const { tournament } = await completedTournament(2);
    const admin = await makeUser({ role: 'ADMIN' });
    created.push(admin.id);
    await rejectsWithCode(() => distributePrizes(admin.id, tournament.id, ctx), 'VALIDATION_ERROR');
  });
});
