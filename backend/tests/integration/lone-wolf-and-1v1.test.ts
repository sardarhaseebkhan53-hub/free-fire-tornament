// =============================================================================
// Integration — Lone Wolf and Clash Squad 1v1 entry paths.
//
// Both are 1-player-per-seat solo-style modes: the join engine must treat them
// like SOLO (no team, no captain, direct UID/IGN confirmation, one seat per
// player). This guards the common regression where a newly added team-based
// mode accidentally requires a full team.
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { joinTournament } from '../../src/services/tournament.service';
import { db, makeTournament, makeUser, rejectsWithCode } from '../helpers/db';

const tournamentIds: string[] = [];
const userIds: string[] = [];
const ctx = { ip: '127.0.0.1' };

afterAll(async () => {
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

describe('Lone Wolf entry', () => {
  it('allows a single player to enter without a team', async () => {
    const t = await makeTournament({ type: 'LONE_WOLF', entryFee: 75, maxSlots: 16 });
    tournamentIds.push(t.id);
    const u = await makeUser({ cash: 500, prefix: 'lone' });
    userIds.push(u.id);

    const out = await joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip);

    expect(out.registeredPlayers).toBe(1);
    expect(out.seatNumber).toBe(1);
    const reg = await db.tournamentRegistration.findFirstOrThrow({ where: { tournamentId: t.id, userId: u.id } });
    expect(reg.status).toBe('CONFIRMED');
    expect(reg.teamId).toBeNull();
    expect(reg.seatNumber).toBe(1);
  });

  it('rejects a Lone Wolf entry without a valid Free Fire UID', async () => {
    const t = await makeTournament({ type: 'LONE_WOLF', entryFee: 50, maxSlots: 8 });
    tournamentIds.push(t.id);
    const u = await makeUser({ cash: 500, prefix: 'lonebad' });
    userIds.push(u.id);
    await db.userProfile.update({ where: { userId: u.id }, data: { freeFireUID: null } });

    // PROFILE_INCOMPLETE (not a generic validation error) so the client can
    // route the player to the "Complete Your Free Fire Profile" screen.
    await rejectsWithCode(
      () => joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip),
      'PROFILE_INCOMPLETE',
    );
  });

  it('rejects an entry when the phone number is missing from the player profile', async () => {
    const t = await makeTournament({ type: 'LONE_WOLF', entryFee: 50, maxSlots: 8 });
    tournamentIds.push(t.id);
    const u = await makeUser({ cash: 500, prefix: 'lonephone' });
    userIds.push(u.id);
    await db.user.update({ where: { id: u.id }, data: { phone: null } });

    await rejectsWithCode(
      () => joinTournament(u.id, { tournamentSlug: t.slug }, ctx.ip),
      'PROFILE_INCOMPLETE',
    );
  });
});

describe('Clash Squad 1v1 entry', () => {
  it('allows a single player to enter without a team and assigns sequential seats', async () => {
    const t = await makeTournament({ type: 'CLASH_SQUAD_1V1', entryFee: 60, maxSlots: 8 });
    tournamentIds.push(t.id);
    const a = await makeUser({ cash: 500, prefix: 'cs1a' });
    const b = await makeUser({ cash: 500, prefix: 'cs1b' });
    userIds.push(a.id, b.id);

    const outA = await joinTournament(a.id, { tournamentSlug: t.slug }, ctx.ip);
    const outB = await joinTournament(b.id, { tournamentSlug: t.slug }, ctx.ip);

    expect(outA.seatNumber).toBe(1);
    expect(outB.seatNumber).toBe(2);
    const regs = await db.tournamentRegistration.findMany({
      where: { tournamentId: t.id, status: 'CONFIRMED' },
      orderBy: { seatNumber: 'asc' },
    });
    expect(regs).toHaveLength(2);
    expect(regs.every((r) => r.teamId === null)).toBe(true);
  });
});
