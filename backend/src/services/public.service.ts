// =============================================================================
// Public (read-only) APIs — power the public website, SEO pages and the
// future Flutter app. Room credentials are NEVER exposed here; they unlock
// only for registered players in the My Matches flow (Phase 6).
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { getSetting } from './settings.service';

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
  const t = await prisma.tournament.findUnique({
    where: { slug },
    include: {
      prizes: { orderBy: { position: 'asc' } },
      matches: {
        orderBy: { matchNumber: 'asc' },
        select: {
          id: true, round: true, matchNumber: true, map: true, scheduledAt: true, status: true,
          credentialsReleaseAt: true,
          // Room credentials intentionally NOT selected for public responses.
        },
      },
      registrations: {
        where: { status: 'CONFIRMED' },
        select: {
          user: { select: { username: true, avatar: true } },
          team: { select: { name: true, tag: true } },
        },
        orderBy: { registeredAt: 'asc' },
        take: 48,
      },
    },
  });
  if (!t || t.status === 'DRAFT') throw notFound('Tournament not found');

  const now = new Date();
  const { registrations, matches, prizes, ...core } = t;
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
    prizes,
    matches: matches.map((m) => ({
      ...m,
      credentialsUnlocked: m.credentialsReleaseAt !== null && m.credentialsReleaseAt <= now,
      credentialsReleaseInMs: m.credentialsReleaseAt ? m.credentialsReleaseAt.getTime() - now.getTime() : null,
    })),
    participants: registrations,
  };
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

  // Period boards are computed from match participation; the all-time board
  // uses the maintained PlayerStat aggregates.
  const where = since ? { lastPlayedAt: { gte: since } } : {};

  const [items, total] = await Promise.all([
    prisma.playerStat.findMany({
      where,
      orderBy: [{ totalPoints: 'desc' }, { wins: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        matchesPlayed: true, wins: true, kills: true, totalPoints: true, earnings: true,
        user: { select: { username: true, avatar: true, profile: { select: { freeFireIGN: true, city: true } } } },
      },
    }),
    prisma.playerStat.count({ where }),
  ]);

  return {
    items: items.map((s, i) => ({ ...s, rank: (page - 1) * limit + i + 1 })),
    page, limit, total, pages: Math.ceil(total / limit),
  };
}

// ---------------------------------------------------------------------------
export async function recentWinners(take = 8) {
  const winners = await prisma.winner.findMany({
    where: { status: 'CREDITED' },
    orderBy: { creditedAt: 'desc' },
    take,
    select: {
      position: true, amount: true, creditedAt: true,
      tournament: { select: { title: true, slug: true, type: true } },
      user: { select: { username: true, avatar: true } },
      team: { select: { name: true, tag: true } },
    },
  });
  return winners;
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

export async function getPublicPlayer(username: string) {
  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: {
      username: true,
      avatar: true,
      createdAt: true,
      role: true,
      profile: {
        select: { freeFireIGN: true, city: true, bio: true, showPublicProfile: true },
      },
      stats: {
        select: { matchesPlayed: true, wins: true, kills: true, totalPoints: true, earnings: true },
      },
    },
  });
  // Public profiles only, players only, and only when the player allows it.
  if (!user || user.role !== 'USER' || user.profile?.showPublicProfile === false) {
    throw notFound('Player not found');
  }
  const stats = user.stats;
  const winRate =
    stats && stats.matchesPlayed > 0 ? Math.round((stats.wins / stats.matchesPlayed) * 100) : 0;
  return {
    username: user.username,
    avatar: user.avatar,
    joinedAt: user.createdAt,
    freeFireIGN: user.profile?.freeFireIGN ?? null,
    city: user.profile?.city ?? null,
    bio: user.profile?.bio ?? null,
    stats: stats
      ? { ...stats, winRate }
      : { matchesPlayed: 0, wins: 0, kills: 0, totalPoints: 0, earnings: 0, winRate: 0 },
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
  const t = await prisma.tournament.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!t) return null;

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
    standings: standings.map((s, i) => ({ rank: i + 1, ...s })),
    winners: winners.map((w) => ({
      position: w.position,
      label: w.position >= 200 ? 'MVP' : w.position >= 100 ? 'Kill Pool' : `Position ${w.position}`,
      amount: Number(w.amount),
      recipient: w.team?.name ?? w.user?.profile?.freeFireIGN ?? w.user?.username ?? '—',
    })),
  };
}
