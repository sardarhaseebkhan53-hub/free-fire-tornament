// =============================================================================
// PHASE 19 — MATCH PARTICIPANTS. `createMatch` snapshots the entries into
// `match_participants` at creation, which is correct for a match scheduled after
// registration closed. Publishing an event WITH its match settings (the admin builder
// can do exactly that) instead creates the table while the entry list is still empty,
// and nothing revisited it — so the room roster is blank, a player has nowhere to
// submit a result, and ROOM_CREDENTIALS / MATCH_STARTING have no recipients.
//
//   §A  the gap itself is pinned, so it cannot silently return
//   §B  the repair is idempotent, only ever picks up CONFIRMED entries, and no-ops
//       when there is nothing to repair
//
// The two callers (a confirmed join, and staff opening the room) run it after their
// money work has committed and swallow failures; the live journey harness proves that
// end-to-end, this file pins the function itself.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { makeUser, walletOf } from '../helpers/db';
import { joinTournament } from '../../src/services/tournament.service';
import { syncParticipants, syncTournamentParticipants } from '../../src/services/match.service';
import { createTournament } from '../../src/services/admin.service';

let seq = 0;
const suffix = () => `p19mp${Date.now().toString(36)}${(seq++).toString(36)}`;

/** An event published the way the admin builder publishes one, match included. */
async function publishedWithMatch() {
  const admin = await makeUser({ role: 'ADMIN', prefix: 'sm' });
  const now = Date.now();
  const row = await createTournament(
    admin.id,
    {
      title: `Published With Match ${suffix()}`,
      type: 'SOLO',
      description: 'the first match is created with the event, before anybody registers',
      map: 'Bermuda',
      startTime: new Date(now + 30 * 60_000),
      registrationDeadline: new Date(now + 5 * 60_000),
      maxSlots: 8,
      minSlotsToStart: 1,
      entryFeePerPlayer: 100,
      pointsPerKill: 1,
      numWinners: 1,
      prizes: [{ kind: 'PLACEMENT' as const, label: '1st Place', amount: 100 }],
      publish: true,
      matchNumber: 1,
      roomId: '900000001',
      roomPassword: 'pub123',
    },
    { ip: '10.0.0.9' },
  );
  const match = await prisma.match.findFirst({
    where: { tournamentId: row.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, credentialsReleaseAt: true },
  });
  return { row, match };
}

async function confirmedEntry(tournamentId: string, seat: number, status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED') {
  const user = await makeUser({ cash: 500, prefix: 'pp' });
  await prisma.tournamentRegistration.create({
    data: { userId: user.id, tournamentId, seatNumber: seat, entryAmount: 100, status },
  });
  return user.id;
}

describe('§A  a match created with the event starts out empty', () => {
  it('publishing an event with match settings creates the match with no participants', async () => {
    const { match } = await publishedWithMatch();
    expect(match, 'the builder should have created the first match').not.toBeNull();
    expect(await prisma.matchParticipant.count({ where: { matchId: match!.id } })).toBe(0);
  });

  it('syncParticipants refuses a match that does not exist', async () => {
    await expect(syncParticipants('no-such-match')).rejects.toThrow(/not found/i);
  });
});

describe('§B  the re-sync repairs it', () => {
  it('attaches the confirmed entries, then changes nothing on a second pass', async () => {
    const { row, match } = await publishedWithMatch();
    const a = await confirmedEntry(row.id, 1);
    const b = await confirmedEntry(row.id, 2);

    const first = await syncTournamentParticipants(row.id);
    expect(first.matches).toBe(1);
    expect(first.added).toBe(2);

    const second = await syncTournamentParticipants(row.id);
    expect(second.added, 'a re-sync must not duplicate rows').toBe(0);

    const rows = await prisma.matchParticipant.findMany({ where: { matchId: match!.id } });
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([a, b]));
    expect(rows.every((r) => r.teamId === null), 'solo entries carry no team').toBe(true);
  });

  it('picks up CONFIRMED entries and ignores cancelled ones', async () => {
    const { row, match } = await publishedWithMatch();
    const a = await confirmedEntry(row.id, 1);
    await confirmedEntry(row.id, 2, 'CANCELLED');

    await syncTournamentParticipants(row.id);
    const rows = await prisma.matchParticipant.findMany({ where: { matchId: match!.id } });
    expect(rows.map((r) => r.userId)).toEqual([a]);
  });

  it('is a no-op for an event with no matches', async () => {
    expect(await syncTournamentParticipants('no-such-tournament')).toEqual({ matches: 0, added: 0 });
    expect(await syncTournamentParticipants('')).toEqual({ matches: 0, added: 0 });
  });
});

describe('§C  a confirmed join repairs the match table that predates it', () => {
  it('a paid entry shows up in its match, and the fee is still charged exactly once', async () => {
    const { row, match } = await publishedWithMatch();
    const player = await makeUser({ cash: 500, prefix: 'pj' });
    await joinTournament(player.id, { tournamentSlug: row.slug }, '10.0.0.30');

    const rows = await prisma.matchParticipant.findMany({ where: { matchId: match!.id } });
    expect(rows.map((r) => r.userId), 'the join must attach the entry to the match').toEqual([player.id]);

    const after = await walletOf(player.id);
    expect(after.cash, 'the entry fee is taken once').toBe(400);
    const debits = await prisma.walletTransaction.count({
      where: { userId: player.id, type: 'ENTRY_FEE', direction: 'DEBIT' },
    });
    expect(debits).toBe(1);

    // A second sync (staff opening the room does the same) changes nothing.
    expect((await syncTournamentParticipants(row.id)).added).toBe(0);
  });
});
