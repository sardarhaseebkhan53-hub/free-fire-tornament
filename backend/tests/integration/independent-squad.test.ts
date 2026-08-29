// =============================================================================
// Integration — independent SQUAD registration + admin pairing (§Modes).
//
// SQUAD / Clash Squad players may join without a team when the platform opt-in
// is enabled, then an admin pairs exactly four free agents into a real SQUAD
// team. This also guards the original behavior: a team-mode join without a team
// must be rejected when the opt-in is off.
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { joinTournament } from '../../src/services/tournament.service';
import { pairIndependentTeam } from '../../src/services/slot.service';
import { db, makeTournament, makeUser, rejectsWithCode, setSetting } from '../helpers/db';

const tournamentIds: string[] = [];
const userIds: string[] = [];
const ctx = { ip: '127.0.0.1' };

afterAll(async () => {
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

describe('independent SQUAD registration (§Modes)', () => {
  it('rejects squad join without a team when the opt-in is off', async () => {
    await setSetting('tournament.allowIndependentSquad', false);
    const t = await makeTournament({ type: 'SQUAD', entryFee: 50, maxSlots: 8 });
    tournamentIds.push(t.id);
    const u = await makeUser({ cash: 500, prefix: 'nosquad' });
    userIds.push(u.id);

    await rejectsWithCode(() => joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip), 'VALIDATION_ERROR');
  });

  it('allows four free agents to register alone and be paired into a squad', async () => {
    await setSetting('tournament.allowIndependentSquad', true);
    const t = await makeTournament({ type: 'SQUAD', entryFee: 50, maxSlots: 8 });
    tournamentIds.push(t.id);
    const players = await Promise.all([
      makeUser({ cash: 500, prefix: 'sqa' }),
      makeUser({ cash: 500, prefix: 'sqb' }),
      makeUser({ cash: 500, prefix: 'sqc' }),
      makeUser({ cash: 500, prefix: 'sqd' }),
    ]);
    userIds.push(...players.map((p) => p.id));

    for (const p of players) {
      await joinTournament(p.id, { tournamentSlug: t.slug }, ctx.ip);
    }

    const regs = await db.tournamentRegistration.findMany({
      where: { tournamentId: t.id, status: 'CONFIRMED' },
      orderBy: { seatNumber: 'asc' },
    });
    expect(regs).toHaveLength(4);
    expect(regs.map((r) => r.seatNumber)).toEqual([1, 2, 3, 4]);
    expect(regs.every((r) => r.teamId === null)).toBe(true);

    const paired = await pairIndependentTeam(players[0]!.id, t.id, regs.map((r) => r.id), ctx);
    const team = await db.team.findUniqueOrThrow({
      where: { id: paired.teamId },
      include: { members: true },
    });
    expect(team.type).toBe('SQUAD');
    expect(team.members).toHaveLength(4);
    expect(team.members.filter((m) => m.role === 'CAPTAIN')).toHaveLength(1);

    const updated = await db.tournamentRegistration.findMany({ where: { tournamentId: t.id } });
    expect(updated.every((r) => r.teamId === team.id)).toBe(true);
  });
});
