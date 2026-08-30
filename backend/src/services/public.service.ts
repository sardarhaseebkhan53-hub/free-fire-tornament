// =============================================================================
// Public (read-only) APIs — power the public website, SEO pages and the
// future Flutter app. Room credentials are NEVER exposed here; they unlock
// only for registered players in the My Matches flow (Phase 6).
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { getSetting } from './settings.service';
import { rankFor, rankCatalog } from '../lib/rank';
import { normalizePlacementTable } from '../lib/scoring';
import { ROOM_FLAG_SELECT, roomStateFor, globalRoomReleaseMinutes } from './room.service';

// ---------------------------------------------------------------------------
export interface TournamentListQuery {
  type?: string;
  status?: string;
  search?: string;
  sort?: 'startTime' | 'prizePool' | 'entryFeePerPlayer' | 'createdAt';
  dir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export async function listTournaments(q: TournamentListQuery) {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(50, Math.max(1, q.limit ?? 12));

  const where: Prisma.TournamentWhereInput = {
    deletedAt: null,
    status: { not: 'DRAFT' }, // drafts are admin-only
    ...(q.type ? { type: q.type as never } : {}),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.search
      ? { title: { contains: q.search, mode: 'insensitive' as const } }
      : {}),
  };

  const orderBy: Prisma.TournamentOrderByWithRelationInput =
    q.sort === 'startTime' || q.sort === 'prizePool' || q.sort === 'entryFeePerPlayer' || q.sort === 'createdAt'
      ? { [q.sort]: q.dir === 'asc' ? 'asc' : 'desc' }
      : { startTime: 'asc' };

  const [items, total] = await Promise.all([
    prisma.tournament.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, title: true, slug: true, type: true, map: true, status: true,
        banner: true, isVerified: true, isFeatured: true,
        entryFeePerPlayer: true, prizePool: true, platformFee: true,
        maxSlots: true, registeredSlots: true, numWinners: true,
        startTime: true, registrationDeadline: true, createdAt: true,
      },
    }),
    prisma.tournament.count({ where }),
  ]);

  const now = new Date();
  return {
    items: items.map((t) => ({
      ...t,
      teamSize: t.type === 'SOLO' ? 1 : t.type === 'DUO' ? 2 : 4,
      entryFeePerTeam: Number(t.entryFeePerPlayer) * (t.type === 'SOLO' ? 1 : t.type === 'DUO' ? 2 : 4),
      slotsLeft: Math.max(0, t.maxSlots - t.registeredSlots),
      registrationOpen: t.status === 'REGISTRATION_OPEN' && t.registrationDeadline > now,
      startsInMs: t.startTime.getTime() - now.getTime(),
    })),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  };
}

// ---------------------------------------------------------------------------
export async function getTournamentBySlug(slug: string) {
  const t = await prisma.tournament.findFirst({
    where: { slug, deletedAt: null },
    include: {
      prizes: { orderBy: { position: 'asc' } },
      // Room STATE only. `ROOM_FLAG_SELECT` has no password column and no Room ID value
      // path — this endpoint is anonymous, public and cached by every crawler that sees it,
      // so it answers "does this event have a room, and when does it open?" and nothing else.
      // A registered player gets the values from GET /api/tournaments/:slug/room, which is
      // where eligibility and the release are actually enforced.
      room: { select: ROOM_FLAG_SELECT },
      matches: {
        where: { deletedAt: null },
        orderBy: { matchNumber: 'asc' },
        select: {
          id: true, round: true, matchNumber: true, map: true, scheduledAt: true, status: true,
          resultsStatus: true,
          credentialsReleaseAt: true,
          // Room credentials intentionally NOT selected for public responses.
        },
      },
      registrations: {
        where: { status: 'CONFIRMED' },
        select: {
          seatNumber: true,
          user: { select: { username: true, avatar: true, profile: { select: { showPublicProfile: true, freeFireUID: true, freeFireIGN: true } } } },
          team: {
            select: {
              name: true,
              tag: true,
              members: {
                select: { user: { select: { username: true, profile: { select: { freeFireUID: true, freeFireIGN: true } } } } },
                orderBy: { joinedAt: 'asc' },
              },
            },
          },
        },
        orderBy: [{ seatNumber: 'asc' }, { registeredAt: 'asc' }],
        // Was hard-coded to 48, which silently truncated the seat list for
        // larger tournaments (maxSlots goes up to 500). The public seat grid
        // needs every confirmed seat to render correctly.
        take: 500,
      },
    },
  });
  if (!t || t.status === 'DRAFT') throw notFound('Tournament not found');

  const now = new Date();
  // `room` is destructured out with the relations rather than left in `core`, and this is
  // the reason: the response below is `{ ...core }`. A spread is exactly how a column added
  // months later ends up on a public, crawler-visible page — so the room row is taken out
  // of the graph here and re-enters only as the derived, credential-free `room` view at the
  // bottom of this object.
  const { registrations, matches, prizes, room: roomRow, ...core } = t;
  return {
    ...core,
    teamSize: t.type === 'SOLO' ? 1 : t.type === 'DUO' ? 2 : 4,
    entryFeePerTeam: Number(t.entryFeePerPlayer) * (t.type === 'SOLO' ? 1 : t.type === 'DUO' ? 2 : 4),
    slotsLeft: Math.max(0, t.maxSlots - t.registeredSlots),
    registrationOpen: t.status === 'REGISTRATION_OPEN' && t.registrationDeadline > now,
    startsInMs: t.startTime.getTime() - now.getTime(),
    prizeBreakdown: {
      entryFeesCollected: Number(t.entryFeePerPlayer) * t.registeredSlots * (t.type === 'SOLO' ? 1 : t.type === 'DUO' ? 2 : 4),
      prizePool: Number(t.prizePool),
      platformFee: Number(t.platformFee),
    },
    scoring: {
      pointsPerKill: t.pointsPerKill,
      placementTable: normalizePlacementTable(t.placementPoints),
      bonusPoints: t.bonusPoints,
      penaltyPoints: t.penaltyPoints,
    },
    // Platform-level flag gating the "register solo, get admin-paired" path
    // for team modes (DUO and SQUAD / Clash Squad). The join engine re-reads
    // the same settings at join time, so the UI gate and server-side
    // enforcement can never drift.
    allowIndependentDuo: await getSetting('tournament.allowIndependentDuo', false),
    allowIndependentSquad: await getSetting('tournament.allowIndependentSquad', false),
    prizes,
    matches: matches.map(({ resultsStatus, ...m }) => ({
      ...m,
      credentialsUnlocked: m.credentialsReleaseAt !== null && m.credentialsReleaseAt <= now,
      credentialsReleaseInMs: m.credentialsReleaseAt ? m.credentialsReleaseAt.getTime() - now.getTime() : null,
      resultsPublished: resultsStatus === 'PUBLISHED',
    })),
    // The event's own room, as state + timing (never values). The player page renders the
    // countdown from here and only then asks for the credentials, so an anonymous visitor
    // sees the same "Hidden" the release is meant to produce.
    room: roomStateFor({ startTime: t.startTime, status: t.status, room: roomRow }, await globalRoomReleaseMinutes(), now),
    participants: registrations.map((registration) => ({
      seatNumber: registration.seatNumber,
      team: registration.team
        ? {
            name: registration.team.name,
            tag: registration.team.tag,
            members: registration.team.members.map((member) => ({
              username: member.user.profile?.freeFireIGN ?? member.user.username,
              uid: member.user.profile?.freeFireUID ?? null,
            })),
          }
        : null,
      user: registration.user.profile?.showPublicProfile === false
        ? { username: 'Anonymous player', avatar: null, uid: null, ign: null }
        : {
            username: registration.user.username,
            avatar: registration.user.avatar,
            uid: registration.user.profile?.freeFireUID ?? null,
            ign: registration.user.profile?.freeFireIGN ?? null,
          },
    })),
  };
}

// ---------------------------------------------------------------------------
// Ads (rendered client-side; admin-managed placements)
// ---------------------------------------------------------------------------
export async function activeAds(placement: string) {
  // Master switch: ads are OFF by default and can only be enabled from the
  // admin panel. This keeps the public site clean until an operator explicitly
  // turns advertisements back on.
  const adsEnabled = await getSetting('ads.enabled', false);
  if (adsEnabled !== true) return { items: [] };

  const now = new Date();
  // The date window is two independent conditions that must BOTH hold:
  //  • started (startsAt is null, or already in the past), AND
  //  • not ended (endsAt is null, or still in the future).
  // Nesting each as its own OR group under one AND fixes the original bug,
  // where the flat `OR`/`AND` combination required endsAt to be null AND in
  // the future on the same row at the same time — impossible, so the endpoint
  // always returned zero ads no matter what admins configured.
  const list = await prisma.advertisement.findMany({
    where: {
      placement: placement as never,
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, imageUrl: true, targetUrl: true, embedHtml: true },
  });
  return {
    items: list.map((a) => ({
      id: a.id,
      name: a.name,
      imageUrl: a.imageUrl,
      targetUrl: a.targetUrl,
      embedHtml: a.embedHtml,
    })),
  };
}

/** Increment the impression counter for a rendered ad. `updateMany` is a no-op
 * for unknown ids, so a beacon for a deleted ad can never 500 the page. */
export async function recordAdImpression(id: string) {
  await prisma.advertisement.updateMany({
    where: { id },
    data: { impressions: { increment: 1 } },
  });
}

/** Increment the click counter for a clicked ad (same no-op-on-missing guard). */
export async function recordAdClick(id: string) {
  await prisma.advertisement.updateMany({
    where: { id },
    data: { clicks: { increment: 1 } },
  });
}

// ---------------------------------------------------------------------------
export async function homeStats() {
  const [totalPlayers, totalTournaments, liveTournaments, prizeResult] = await Promise.all([
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.tournament.count({ where: { status: { not: 'DRAFT' } } }),
    prisma.tournament.count({ where: { status: 'LIVE' } }),
    prisma.winner.aggregate({ _sum: { amount: true }, where: { status: 'CREDITED' } }),
  ]);
  return {
    totalPlayers,
    totalTournaments,
    liveTournaments,
    totalPrizeDistributed: prizeResult._sum.amount ?? 0,
    currency: await getSetting('platform.currency', 'PKR'),
  };
}

// ---------------------------------------------------------------------------
export async function leaderboard(opts: { period?: 'all' | 'weekly' | 'monthly'; page?: number; limit?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const since =
    opts.period === 'weekly'
      ? new Date(Date.now() - 7 * 86_400_000)
      : opts.period === 'monthly'
        ? new Date(Date.now() - 30 * 86_400_000)
        : undefined;

  // Public rankings are derived from published match rows, never from the
  // mutable PlayerStat cache. This prevents draft/under-review edits from
  // appearing publicly and makes weekly/monthly windows actual match windows.
  const participants = await prisma.matchParticipant.findMany({
    where: {
      status: 'PLAYED',
      absent: false,
      match: {
        resultsStatus: 'PUBLISHED',
        ...(since ? { scheduledAt: { gte: since } } : {}),
      },
    },
    select: {
      userId: true, kills: true, finalScore: true, points: true, placement: true,
      user: { select: { username: true, avatar: true, profile: { select: { freeFireIGN: true, city: true } } } },
      team: {
        select: {
          members: {
            select: {
              user: { select: { username: true, avatar: true, profile: { select: { freeFireIGN: true, city: true } } } },
            },
          },
        },
      },
    },
  });

  type Aggregate = {
    matchesPlayed: number; wins: number; kills: number; totalPoints: number;
    user: { username: string; avatar: string | null; profile: { freeFireIGN: string | null; city: string | null } | null };
  };
  const aggregates = new Map<string, Aggregate>();
  const add = (user: Aggregate['user'], kills: number, points: number, won: boolean) => {
    const current = aggregates.get(user.username) ?? {
      matchesPlayed: 0, wins: 0, kills: 0, totalPoints: 0, user,
    };
    current.matchesPlayed += 1;
    current.wins += won ? 1 : 0;
    current.kills += kills;
    current.totalPoints += points;
    aggregates.set(user.username, current);
  };

  for (const participant of participants) {
    const points = participant.finalScore ?? participant.points ?? 0;
    const kills = participant.kills ?? 0;
    if (participant.user) {
      add(participant.user, kills, points, participant.placement === 1);
      continue;
    }
    // Team result rows represent one team score. Preserve the existing player
    // leaderboard convention: each roster member receives the team points and
    // an even, rounded share of the recorded team kills.
    const members = participant.team?.members ?? [];
    const memberKills = members.length ? Math.round(kills / members.length) : 0;
    for (const member of members) add(member.user, memberKills, points, participant.placement === 1);
  }

  const ranked = [...aggregates.values()].sort(
    (a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins || b.kills - a.kills || a.user.username.localeCompare(b.user.username),
  );
  const items = ranked.slice((page - 1) * limit, page * limit);
  return {
    items: items.map((s, i) => ({
      ...s,
      rank: (page - 1) * limit + i + 1,
      rankInfo: rankFor(s.totalPoints),
    })),
    page, limit, total: ranked.length, pages: Math.ceil(ranked.length / limit),
    catalog: rankCatalog(),
  };
}

// ---------------------------------------------------------------------------
export async function recentWinners(take = 8) {
  // PHASE 18 — an event is only "won" when the WHOLE event is published.
  // `some` here revealed a champion while round 2 was still being reviewed: the
  // final-results endpoint already required every match to be PUBLISHED, so the
  // winners feed had to be held to the same gate or the two pages contradicted
  // each other (and the site crowned a winner that could still change).
  const winners = await prisma.winner.findMany({
    where: {
      status: 'CREDITED',
      tournament: {
        deletedAt: null,
        AND: [
          { matches: { some: { resultsStatus: 'PUBLISHED' } } },
          { matches: { none: { resultsStatus: { not: 'PUBLISHED' } } } },
        ],
      },
    },
    orderBy: { creditedAt: 'desc' },
    take,
    select: {
      position: true, amount: true, creditedAt: true,
      tournament: { select: { title: true, slug: true, type: true, banner: true } },
      user: { select: { username: true, avatar: true, profile: { select: { showPublicProfile: true } } } },
      team: { select: { name: true, tag: true } },
    },
  });
  return winners.map((winner) => ({
    position: winner.position,
    amount: winner.amount,
    creditedAt: winner.creditedAt,
    tournament: winner.tournament,
    user: winner.user?.profile?.showPublicProfile === false
      ? { username: 'Anonymous player', avatar: null }
      : winner.user ? { username: winner.user.username, avatar: winner.user.avatar } : null,
    team: winner.team,
  }));
}

// ---------------------------------------------------------------------------
export async function listBlogPosts(page = 1, limit = 9) {
  const where = { status: 'PUBLISHED' as const, publishedAt: { lte: new Date() } };
  const [items, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        title: true, slug: true, excerpt: true, coverImage: true, category: true,
        publishedAt: true, author: { select: { username: true } },
      },
    }),
    prisma.blogPost.count({ where }),
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

export async function getBlogPost(slug: string) {
  const post = await prisma.blogPost.findUnique({
    where: { slug },
    include: { author: { select: { username: true, avatar: true } } },
  });
  if (!post || post.status !== 'PUBLISHED' || !post.publishedAt || post.publishedAt > new Date()) {
    throw notFound('Article not found');
  }
  return post;
}

export async function getStaticPage(slug: string) {
  const page = await prisma.staticPage.findUnique({ where: { slug } });
  if (!page) throw notFound('Page not found');
  return page;
}

export async function listFaqs() {
  return prisma.faq.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { question: true, answer: true, category: true },
  });
}

async function publishedStatsForPlayer(userId: string) {
  const rows = await prisma.matchParticipant.findMany({
    where: {
      status: 'PLAYED',
      absent: false,
      match: { resultsStatus: 'PUBLISHED' },
      OR: [
        { userId },
        { team: { members: { some: { userId } } } },
      ],
    },
    select: { userId: true, kills: true, finalScore: true, points: true, placement: true, team: { select: { members: { select: { userId: true } } } } },
  });
  let matchesPlayed = 0;
  let wins = 0;
  let kills = 0;
  let totalPoints = 0;
  for (const row of rows) {
    const points = row.finalScore ?? row.points ?? 0;
    const rawKills = row.kills ?? 0;
    const isDirect = row.userId === userId;
    const teamMembers = row.team?.members ?? [];
    if (!isDirect && !teamMembers.some((member) => member.userId === userId)) continue;
    matchesPlayed += 1;
    wins += row.placement === 1 ? 1 : 0;
    kills += isDirect || teamMembers.length === 0 ? rawKills : Math.round(rawKills / teamMembers.length);
    totalPoints += points;
  }
  return { matchesPlayed, wins, kills, totalPoints };
}

export async function getPublicPlayer(username: string) {
  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: {
      id: true,
      username: true,
      avatar: true,
      createdAt: true,
      role: true,
      profile: {
        select: { freeFireIGN: true, city: true, bio: true, showPublicProfile: true },
      },
    },
  });
  // Public profiles only, players only, and only when the player allows it.
  if (!user || user.role !== 'USER' || user.profile?.showPublicProfile === false) {
    throw notFound('Player not found');
  }
  const stats = await publishedStatsForPlayer(user.id);
  const winRate = stats.matchesPlayed > 0 ? Math.round((stats.wins / stats.matchesPlayed) * 100) : 0;
  return {
    username: user.username,
    avatar: user.avatar,
    joinedAt: user.createdAt,
    freeFireIGN: user.profile?.freeFireIGN ?? null,
    city: user.profile?.city ?? null,
    bio: user.profile?.bio ?? null,
    rankInfo: rankFor(stats.totalPoints),
    stats: { ...stats, winRate },
  };
}

export async function publicSettings() {
  const keys = [
    'platform.name', 'platform.tagline', 'platform.currency', 'platform.currencySymbol',
    'platform.whatsappNumber', 'platform.supportEmail', 'platform.maintenanceMode',
    'platform.maintenanceMessage', 'wallet.minDeposit', 'wallet.maxDeposit', 'wallet.minWithdrawal',
    'payments.processingTimeHours', 'tournament.roomCredentialsReleaseMinutesBeforeStart',
  ] as const;
  const rows = await prisma.setting.findMany({ where: { key: { in: [...keys] } } });
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ---------------------------------------------------------------------------
// Phase 12 — SEO: admin-managed per-page overrides, served to the site
// ---------------------------------------------------------------------------

/** Public per-page SEO overrides. Empty object when none configured (pages
 *  fall back to their built-in metadata). */
export async function getSeoConfig(pageSlug: string) {
  const row = await prisma.seoConfig.findUnique({ where: { pageSlug } });
  if (!row) return {};
  return {
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    canonicalUrl: row.canonicalUrl ?? undefined,
    ogImageUrl: row.ogImageUrl ?? undefined,
    keywords: row.keywords ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Phase 8 — public final standings for a completed tournament
// ---------------------------------------------------------------------------

import { tournamentStandings } from './result.service';

export async function tournamentResults(slug: string) {
  const t = await prisma.tournament.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true, title: true, type: true, status: true,
      matches: { where: { deletedAt: null }, select: { id: true, resultsStatus: true }, orderBy: { matchNumber: 'asc' } },
    },
  });
  if (!t) return null;

  // Spec §26 — results are only public AFTER the admin publish gate. Until
  // every match is PUBLISHED the endpoint returns an unpublished shell, so
  // nothing leaks from Draft/Under-Review/Confirmed states.
  const allPublished = t.matches.length > 0 && t.matches.every((m) => m.resultsStatus === 'PUBLISHED');
  if (!allPublished) {
    return {
      tournament: { id: t.id, title: t.title, type: t.type, status: t.status },
      published: false,
      standings: [],
      winners: [],
      matchCount: t.matches.length,
    };
  }

  const { tournament, standings } = await tournamentStandings(t.id);
  const winners = await prisma.winner.findMany({
    where: { tournamentId: t.id, status: 'CREDITED' },
    orderBy: { position: 'asc' },
    include: {
      user: { select: { username: true, profile: { select: { freeFireIGN: true } } } },
      team: { select: { name: true, tag: true } },
    },
  });

  return {
    tournament: {
      id: tournament.id,
      title: tournament.title,
      type: tournament.type,
      status: tournament.status,
    },
    published: true,
    standings: standings.map((s, i) => ({ rank: i + 1, ...s })),
    winners: winners.map((w) => ({
      position: w.position,
      label: w.position >= 200 ? 'MVP' : w.position >= 100 ? 'Kill Pool' : `Position ${w.position}`,
      amount: Number(w.amount),
      recipient: w.team?.name ?? w.user?.profile?.freeFireIGN ?? w.user?.username ?? '—',
    })),
  };
}
