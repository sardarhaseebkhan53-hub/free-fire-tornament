// =============================================================================
// Background reminders — lightweight scheduler ticks (wired in index.ts).
//
// notifyUpcomingMatches(): sends "your match starts in ~N minutes" to every
// confirmed participant (solo player or team member) exactly once per match,
// even across server restarts, guarded by Match.startNotifiedAt.
// =============================================================================
import { prisma } from '../lib/prisma';
import { getSetting } from './settings.service';

/** Notify participants of matches starting within the reminder window. */
export async function notifyUpcomingMatches(): Promise<number> {
  const leadMinutes = Number(await getSetting('tournament.startReminderMinutes', 5));
  const now = Date.now();
  const from = new Date(now - 2 * 60_000); // still useful right after kickoff
  const until = new Date(now + leadMinutes * 60_000);

  const matches = await prisma.match.findMany({
    where: {
      startNotifiedAt: null,
      scheduledAt: { gte: from, lte: until },
      status: { in: ['SCHEDULED', 'CREDENTIALS_RELEASED', 'LIVE'] },
    },
    select: {
      id: true, round: true, matchNumber: true, scheduledAt: true,
      tournament: { select: { id: true, title: true, slug: true } },
    },
    take: 50,
  });
  if (matches.length === 0) return 0;

  let sent = 0;
  for (const m of matches) {
    // Claim the match first — the updateMany is atomic, so two concurrent
    // ticks (or a restart racing a tick) can never double-notify.
    const claimed = await prisma.match.updateMany({
      where: { id: m.id, startNotifiedAt: null },
      data: { startNotifiedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const regs = await prisma.tournamentRegistration.findMany({
      where: { tournamentId: m.tournament.id, status: 'CONFIRMED' },
      select: { userId: true, team: { select: { members: { select: { userId: true } } } } },
    });
    const targets = new Set<string>();
    for (const r of regs) {
      targets.add(r.userId);
      for (const mem of r.team?.members ?? []) targets.add(mem.userId);
    }
    if (targets.size === 0) continue;

    const minutes = Math.max(1, Math.round((m.scheduledAt.getTime() - now) / 60_000));
    await prisma.notification.createMany({
      data: Array.from(targets).map((userId) => ({
        userId,
        type: 'MATCH_STARTING' as const,
        title: minutes <= 1 ? 'Match starting now 🔴' : `Match starts in ~${minutes} min ⏱`,
        body: `${m.tournament.title} — round ${m.round}, match #${m.matchNumber}. Check My Matches for room details.`,
        data: { matchId: m.id, slug: m.tournament.slug, area: 'matches' } as never,
      })),
    });
    sent += targets.size;
  }
  return sent;
}
