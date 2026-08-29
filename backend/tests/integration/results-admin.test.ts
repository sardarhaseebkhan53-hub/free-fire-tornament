// =============================================================================
// Integration — admin result workflow (draft → confirm → publish), slot
// control, per-tournament scoring and team join codes (spec §11-14, §26, §40).
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { createMatch, matchTable, updateMatch } from '../../src/services/match.service';
import { confirmStandings, saveAdminResult, setResultsStatus } from '../../src/services/result.service';
import { assignSlot, clearSlot, setParticipantState, setSlotLock, slotBoard } from '../../src/services/slot.service';
import { createTeam, joinByCode, teamJoinCode } from '../../src/services/team.service';
import { joinTournament } from '../../src/services/tournament.service';
import { adjustPlayerStats, recalculateLeaderboard, updateTournamentScoring } from '../../src/services/admin.service';
import { tournamentResults } from '../../src/services/public.service';
import { cleanupUsers, db, makeTournament, makeUser, rejectsWithCode, uid } from '../helpers/db';

const ctx = { ip: '203.0.113.55', userAgent: 'vitest' };
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

async function soloArena(playerCount: number) {
  const t = await makeTournament({
    entryFee: 100,
    maxSlots: playerCount,
    prizes: [
      { kind: 'PLACEMENT', amount: 300, label: '1st' },
      { kind: 'PLACEMENT', amount: 200, label: '2nd' },
      { kind: 'PLACEMENT', amount: 100, label: '3rd' },
    ],
  });
  await db.tournament.update({
    where: { id: t.id },
    data: { placementPoints: [20, 15, 10, 5, 3, 2, 1, 1, 1, 1] },
  });
  tournamentIds.push(t.id);

  const players = await Promise.all(
    Array.from({ length: playerCount }, () => makeUser({ cash: 1000, prefix: 'adm' })),
  );
  created.push(...players.map((p) => p.id));
  for (const p of players) await joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip);

  const match = await createMatch({
    tournamentId: t.id,
    matchNumber: 1,
    map: 'Bermuda',
    scheduledAt: new Date(Date.now() - 3_600_000).toISOString(),
  }, players[0]!.id, ctx);
  matchIds.push(match.id);
  await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
  return { tournament: t, players, matchId: match.id };
}

describe('admin result workflow', () => {
  it('Draft → Under Review → Confirm → Publish with per-tournament scoring', async () => {
    const { tournament, players, matchId } = await soloArena(3);

    const participants = await db.matchParticipant.findMany({ where: { matchId } });
    expect(participants).toHaveLength(3);

    // Entry: 1st → placement 1, 5 kills, +2 bonus, 0 penalty; 2nd → place 2, 3 kills; 3rd → place 3, 1 kill, -1 penalty.
    const scored: Array<{ pid: string; placement: number; kills: number; bonus: number; penalty: number }> = [
      { pid: participants[0]!.id, placement: 1, kills: 5, bonus: 2, penalty: 0 },
      { pid: participants[1]!.id, placement: 2, kills: 3, bonus: 0, penalty: 0 },
      { pid: participants[2]!.id, placement: 3, kills: 1, bonus: 0, penalty: 1 },
    ];
    for (const s of scored) {
      const out = await saveAdminResult(
        players[0]!.id, matchId,
        { participantId: s.pid, position: s.placement, kills: s.kills, bonus: s.bonus, penalty: s.penalty, status: 'PLAYED' },
        ctx,
      );
      expect(out.finalScore).not.toBeNull();
    }
    // Custom table [20,15,10,...] + pointsPerKill 1
    const [r1, r2, r3] = await Promise.all([
      db.matchParticipant.findUniqueOrThrow({ where: { id: scored[0]!.pid } }),
      db.matchParticipant.findUniqueOrThrow({ where: { id: scored[1]!.pid } }),
      db.matchParticipant.findUniqueOrThrow({ where: { id: scored[2]!.pid } }),
    ]);
    expect(r1.finalScore).toBe(20 + 5 + 2); // 27
    expect(r2.finalScore).toBe(15 + 3); // 18
    expect(r3.finalScore).toBe(10 + 1 - 1); // 10

    await setResultsStatus(players[0]!.id, matchId, 'UNDER_REVIEW', ctx);
    await setResultsStatus(players[0]!.id, matchId, 'CONFIRMED', ctx);
    await confirmStandings(players[0]!.id, matchId, ctx);
    await setResultsStatus(players[0]!.id, matchId, 'PUBLISHED', ctx);

    const table = await matchTable(matchId);
    expect(table.rows).toHaveLength(3);
    const first = table.rows.find((r) => r.finalScore === 27)!;
    expect(first.prize).toBe(300);
    expect(first.uid).toMatch(/^\d{5,15}$/);
    expect(first.payment).toBe('PAID');

    // Public results reveal ONLY after publish
    const pub = await tournamentResults(tournament.slug);
    expect(pub?.published).toBe(true);
    expect(pub?.standings.length).toBe(3);
  });

  it('public results stay hidden until every match is PUBLISHED', async () => {
    const { tournament, players, matchId } = await soloArena(2);
    const participants = await db.matchParticipant.findMany({ where: { matchId } });
    for (const [i, p] of participants.entries()) {
      await saveAdminResult(players[0]!.id, matchId, {
        participantId: p.id, position: i + 1, kills: 2, status: 'PLAYED',
      }, ctx);
    }
    await setResultsStatus(players[0]!.id, matchId, 'UNDER_REVIEW', ctx);

    const hidden = await tournamentResults(tournament.slug);
    expect(hidden?.published).toBe(false);
    expect(hidden?.standings).toHaveLength(0);
  });

  it('published results are locked against further edits', async () => {
    const { tournament, players, matchId } = await soloArena(2);
    const participants = await db.matchParticipant.findMany({ where: { matchId } });
    await saveAdminResult(players[0]!.id, matchId, { participantId: participants[0]!.id, position: 1, kills: 1, status: 'PLAYED' }, ctx);
    await saveAdminResult(players[0]!.id, matchId, { participantId: participants[1]!.id, position: 2, kills: 1, status: 'PLAYED' }, ctx);
    await setResultsStatus(players[0]!.id, matchId, 'CONFIRMED', ctx);
    await setResultsStatus(players[0]!.id, matchId, 'PUBLISHED', ctx);
    await rejectsWithCode(
      () => saveAdminResult(players[0]!.id, matchId, { participantId: participants[0]!.id, position: 2, kills: 9 }, ctx),
      'CONFLICT',
    );
  });
});

describe('slot control', () => {
  it('assigns, moves, clears, locks and boards slots with audit trail', async () => {
    const t = await makeTournament({ entryFee: 50, maxSlots: 4 });
    tournamentIds.push(t.id);
    const players = await Promise.all([
      makeUser({ cash: 500, prefix: 'slot' }),
      makeUser({ cash: 500, prefix: 'slot' }),
      makeUser({ cash: 500, prefix: 'slot' }),
    ]);
    created.push(...players.map((p) => p.id));
    for (const p of players) await joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip);

    const regs = await db.tournamentRegistration.findMany({
      where: { tournamentId: t.id, status: 'CONFIRMED' },
      orderBy: { seatNumber: 'asc' },
    });
    expect(regs.map((r) => r.seatNumber)).toEqual([1, 2, 3]);

    // Move player 3 (seat 3) → seat 4
    await assignSlot(players[0]!.id, regs[2]!.id, 4, 'spread the board', ctx);
    const moved = await db.tournamentRegistration.findUniqueOrThrow({ where: { id: regs[2]!.id } });
    expect(moved.seatNumber).toBe(4);

    // Same slot conflict
    await rejectsWithCode(() => assignSlot(players[0]!.id, regs[0]!.id, 4, '', ctx), 'CONFLICT');

    // Lock seat 4, then refuse to clear it
    await setSlotLock(players[0]!.id, regs[2]!.id, true, 'held for verification', ctx);
    await rejectsWithCode(() => clearSlot(players[0]!.id, regs[2]!.id, '', ctx), 'CONFLICT');

    // Unlock + clear → seat becomes available in the board
    await setSlotLock(players[0]!.id, regs[2]!.id, false, '', ctx);
    await clearSlot(players[0]!.id, regs[2]!.id, 'withdrew before start', ctx);

    const board = await slotBoard(t.id);
    const slot4 = board.slots.find((s) => s.slot === 4)!;
    expect(slot4.registrationId).toBeNull();
    expect(slot4.locked).toBe(false);
    const audit = await db.auditLog.count({ where: { actorId: players[0]!.id, action: { in: ['SLOT_ASSIGNED', 'SLOT_CLEARED', 'SLOT_LOCKED', 'SLOT_UNLOCKED'] } } });
    expect(audit).toBeGreaterThanOrEqual(4);
  });
});

describe('solo identity requirement + team join codes', () => {
  it('refuses SOLO join without a Free Fire UID/nickname (profile or input)', async () => {
    const t = await makeTournament({ entryFee: 50, maxSlots: 2 });
    tournamentIds.push(t.id);
    const u = await makeUser({ cash: 500, prefix: 'ident' });
    created.push(u.id);
    // Strip the profile identity the factory set.
    await db.userProfile.update({ where: { userId: u.id }, data: { freeFireUID: null, freeFireIGN: null } });
    await rejectsWithCode(() => joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip), 'VALIDATION_ERROR');
    // Confirm values submitted at join time are accepted and persisted.
    await joinTournament(u.id, { tournamentSlug: t.slug, freeFireUID: '9988776655', freeFireIGN: 'ClutchKing' }, ctx.ip);
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(profile.freeFireUID).toBe('9988776655');
    expect(profile.freeFireIGN).toBe('ClutchKing');
  });

  it('generates a shareable join code and lets a player join with it', async () => {
    const [captain, mate] = [await makeUser({ prefix: 'cap' }), await makeUser({ prefix: 'mate' })];
    created.push(captain.id, mate.id);
    const team = await createTeam(captain.id, { name: 'Test Squad', tag: 'TSQ', type: 'SQUAD' });
    const { code } = await teamJoinCode(captain.id, team.id, false);
    expect(code).toMatch(/^CNX-/);
    const out = await joinByCode(mate.id, code!);
    expect(out.teamId).toBe(team.id);
    await rejectsWithCode(() => joinByCode(mate.id, 'CNX-NOPE1'), 'NOT_FOUND');
  });
});

describe('leaderboard admin controls', () => {
  it('adjusts stats with a note and recalculates from played matches', async () => {
    const admin = await makeUser({ prefix: 'lbadmin' });
    const u = await makeUser({ prefix: 'lb' });
    created.push(admin.id, u.id);

    const out = await adjustPlayerStats(admin.id, {
      userId: u.id, kills: 7, totalPoints: 50, note: 'manual correction — verified screenshot',
    }, ctx);
    expect(out.kills).toBe(7);
    expect(out.totalPoints).toBe(50);

    const audit = await db.auditLog.findFirst({
      where: { actorId: admin.id, action: 'LEADERBOARD_ADJUSTED' },
    });
    expect(audit).not.toBeNull();

    // Recalculate rebuilds from verified participants; a player with no played
    // matches keeps their manual row intact (recalc never zeroes silently).
    await recalculateLeaderboard(admin.id, ctx);
    const stat = await db.playerStat.findUniqueOrThrow({ where: { userId: u.id } });
    expect(stat.totalPoints).toBe(50);
  });
});

describe('per-tournament scoring configuration (spec §35)', () => {
  it('updates placement/kill/bonus/penalty config, audits it, and the match table reflects it', async () => {
    const admin = await makeUser({ role: 'ADMIN', prefix: 'score-admin' });
    const t = await makeTournament({ entryFee: 50, maxSlots: 8 });
    tournamentIds.push(t.id);
    created.push(admin.id);

    const out = await updateTournamentScoring(admin.id, t.id, {
      pointsPerKill: 3,
      placementPoints: [10, 8, 6, 5, 4, 3, 2, 1],
      bonusPoints: 2,
      penaltyPoints: 1,
    }, ctx);

    expect(out.pointsPerKill).toBe(3);
    const row = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(Number(row.pointsPerKill)).toBe(3);
    expect(row.placementPoints).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
    expect(Number(row.bonusPoints)).toBe(2);
    expect(Number(row.penaltyPoints)).toBe(1);

    const audits = await db.auditLog.count({ where: { actorId: admin.id, action: 'TOURNAMENT_SCORING_UPDATED', entity: 'Tournament', entityId: t.id } });
    expect(audits).toBe(1);

    const m = await createMatch({
      tournamentId: t.id, matchNumber: 1,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    }, admin.id, ctx);
    matchIds.push(m.id);
    const table = await matchTable(m.id);
    expect(table.scoring.pointsPerKill).toBe(3);
    expect(table.scoring.placementTable).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
  });

  it('computes finalScore = placement + kills×perKill + bonus − penalty from the tournament config', async () => {
    const admin = await makeUser({ role: 'ADMIN', prefix: 'score-admin2' });
    const t = await makeTournament({ entryFee: 50, maxSlots: 8 });
    tournamentIds.push(t.id);
    created.push(admin.id);
    await updateTournamentScoring(admin.id, t.id, {
      pointsPerKill: 2,
      placementPoints: [20, 15, 10, 5],
      bonusPoints: 5,
      penaltyPoints: 3,
    }, ctx);

    const u = await makeUser({ cash: 500, prefix: 'score-p' });
    created.push(u.id);
    await joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip);
    const m = await createMatch({
      tournamentId: t.id, matchNumber: 1,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    }, admin.id, ctx);
    matchIds.push(m.id);

    const reg = await db.tournamentRegistration.findFirstOrThrow({ where: { tournamentId: t.id, userId: u.id } });
    const row = await db.matchParticipant.findFirstOrThrow({ where: { matchId: m.id, userId: u.id } });

    // 2nd place (15) + 4 kills × 2 (8) + bonus 5 − penalty 3 = 25
    await saveAdminResult(admin.id, m.id, { participantId: row.id, position: 2, kills: 4, bonus: 5, penalty: 3 }, ctx);
    const saved = await db.matchParticipant.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.finalScore).toBe(25);
    expect(saved.points).toBe(23); // placement + kills, without bonus/penalty

    // Penalty heavier than score → final score floors at 0.
    await saveAdminResult(admin.id, m.id, { participantId: row.id, position: 1, kills: 0, bonus: 0, penalty: 999 }, ctx);
    const floored = await db.matchParticipant.findUniqueOrThrow({ where: { id: row.id } });
    expect(floored.finalScore).toBe(0);

    void reg;
  });
});
