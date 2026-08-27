// =============================================================================
// Admin panel services — dashboard stats, revenue analytics, user management,
// tournament builder, match operations, content (blog/ads/SEO), support,
// settings and audit trail. Every mutation is audited; every list is paged.
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden } from '../lib/errors';
import { getSetting, invalidateSetting } from './settings.service';
import { notifyAllUsers } from './notification.service';
import { computeEconomics, type PrizeInput } from './tournament-economics.service';
import { moveBalance, TX_OPTS } from './wallet.service';
import type { Bucket } from './wallet.service';

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;
const pageOf = (p: number) => (Math.max(1, p) - 1);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function adminStats() {
  const dayAgo = new Date(Date.now() - 86_400_000);

  const [users, activeToday, liveTournaments, openTickets, depAgg, wdAgg, registrations30d, recent, fraud] =
    await Promise.all([
      prisma.user.count(),
      prisma.auditLog.findMany({ where: { createdAt: { gte: dayAgo }, actorId: { not: null } }, select: { actorId: true }, distinct: ['actorId'] }),
      prisma.tournament.count({ where: { status: 'LIVE' } }),
      prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.deposit.aggregate({ where: { status: 'PENDING' }, _count: true, _sum: { amount: true } }),
      prisma.withdrawal.aggregate({ where: { status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } }, _count: true, _sum: { amount: true } }),
      prisma.tournamentRegistration.count({ where: { registeredAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { actor: { select: { username: true } } },
      }),
      prisma.fraudAlert.findMany({
        where: { status: 'OPEN' },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
    ]);

  return {
    kpis: {
      totalUsers: users,
      activeToday: activeToday.length,
      liveTournaments,
      openTickets,
      pendingDeposits: { count: depAgg._count, amount: num(depAgg._sum.amount) },
      pendingWithdrawals: { count: wdAgg._count, amount: num(wdAgg._sum.amount) },
      registrations30d,
    },
    recentActivity: recent.map((a) => ({
      id: a.id,
      action: a.action,
      entity: a.entity,
      actor: a.actor?.username ?? 'system',
      createdAt: a.createdAt,
    })),
    fraudAlerts: fraud.map((f) => ({
      id: f.id,
      kind: f.kind,
      severity: f.severity,
      details: f.details,
      createdAt: f.createdAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Revenue analytics
// ---------------------------------------------------------------------------

export interface DailyPoint { day: string; deposits: number; withdrawals: number; prizes: number; entries: number; registrations: number }

export async function revenueAnalytics(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [depAgg, wdAgg, prizeAgg, entryAgg] = await Promise.all([
    prisma.deposit.aggregate({ where: { status: 'APPROVED', reviewedAt: { gte: since } }, _sum: { amount: true } }),
    prisma.withdrawal.aggregate({ where: { status: 'PAID', reviewedAt: { gte: since } }, _sum: { amount: true } }),
    prisma.winner.aggregate({ where: { status: 'CREDITED', creditedAt: { gte: since } }, _sum: { amount: true } }),
    prisma.tournamentRegistration.aggregate({ where: { status: 'CONFIRMED', registeredAt: { gte: since } }, _sum: { entryAmount: true }, _count: true }),
  ]);

  const series = await prisma.$queryRaw<Array<{ day: Date; deposits: string; withdrawals: string; prizes: string; entries: string; registrations: string }>>`
    WITH days AS (
      SELECT generate_series(date_trunc('day', now() - (${days} || ' days')::interval), date_trunc('day', now()), '1 day') AS day
    )
    SELECT d.day,
      COALESCE((SELECT SUM(amount) FROM deposits WHERE status='APPROVED' AND date_trunc('day', COALESCE("reviewedAt","createdAt")) = d.day), 0) AS deposits,
      COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status='PAID' AND date_trunc('day', COALESCE("reviewedAt","createdAt")) = d.day), 0) AS withdrawals,
      COALESCE((SELECT SUM(amount) FROM winners WHERE status='CREDITED' AND date_trunc('day', "creditedAt") = d.day), 0) AS prizes,
      COALESCE((SELECT SUM("entryAmount") FROM tournament_registrations WHERE status='CONFIRMED' AND date_trunc('day', "registeredAt") = d.day), 0) AS entries,
      COALESCE((SELECT COUNT(*) FROM tournament_registrations WHERE status='CONFIRMED' AND date_trunc('day', "registeredAt") = d.day), 0) AS registrations
    FROM days d ORDER BY d.day`;

  const totalDeposits = num(depAgg._sum.amount);
  const totalWithdrawals = num(wdAgg._sum.amount);
  const totalPrizes = num(prizeAgg._sum.amount);
  const totalEntries = num(entryAgg._sum.entryAmount);

  return {
    window: { days },
    totals: {
      deposits: totalDeposits,
      withdrawals: totalWithdrawals,
      prizes: totalPrizes,
      entryCollection: totalEntries,
      grossRevenue: totalEntries,
      netRevenue: Math.round((totalEntries - totalPrizes) * 100) / 100,
      registrations: entryAgg._count,
    },
    series: series.map((r) => ({
      day: r.day,
      deposits: num(r.deposits),
      withdrawals: num(r.withdrawals),
      prizes: num(r.prizes),
      entries: num(r.entries),
      registrations: Number(r.registrations),
    })),
  };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listUsers(filter: { q?: string; status?: string; page: number; pageSize: number }) {
  const where: Prisma.UserWhereInput = {};
  if (filter.q) {
    where.OR = [
      { username: { contains: filter.q, mode: 'insensitive' } },
      { email: { contains: filter.q, mode: 'insensitive' } },
      { profile: { freeFireUID: { contains: filter.q } } },
    ];
  }
  if (filter.status) where.status = filter.status as Prisma.EnumUserStatusFilter['equals'];

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      select: {
        id: true, username: true, email: true, role: true, status: true,
        isVerified: true, createdAt: true, lastLoginAt: true,
        profile: { select: { fullName: true, freeFireUID: true } },
        wallet: { select: { cashBalance: true, coinBalance: true, winningBalance: true, bonusBalance: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return {
    items: rows.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      status: u.status,
      isVerified: u.isVerified,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      ffuid: u.profile?.freeFireUID ?? null,
      wallet: u.wallet
        ? {
            cash: num(u.wallet.cashBalance),
            coins: num(u.wallet.coinBalance),
            winning: num(u.wallet.winningBalance),
            bonus: num(u.wallet.bonusBalance),
          }
        : null,
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function setUserStatus(adminId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'BANNED', reason: string, ctx: { ip?: string }) {
  if (userId === adminId) throw badRequest('VALIDATION_ERROR', 'You cannot change your own status.');
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw badRequest('NOT_FOUND', 'User not found');
  if (target.role === 'SUPER_ADMIN' && status !== 'ACTIVE') {
    throw forbidden('Super admins cannot be suspended or banned.');
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status,
      ...(status === 'BANNED' ? { bannedAt: new Date(), banReason: reason || null } : { bannedAt: null, banReason: null }),
    },
  });
  await prisma.notification.create({
    data: {
      userId, type: 'ACCOUNT',
      title: status === 'ACTIVE' ? 'Account restored' : `Account ${status.toLowerCase()}`,
      body: status === 'ACTIVE' ? 'Your account is active again. Welcome back to the arena.' : `Your account has been ${status.toLowerCase()}.${reason ? ` Reason: ${reason}` : ''}`,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: `USER_${status}`, entity: 'User', entityId: userId,
      before: { status: target.status }, after: { status, reason: reason || null }, ip: ctx.ip,
    },
  });
  return { id: updated.id, status: updated.status };
}

export async function adjustBalance(
  adminId: string,
  userId: string,
  input: { bucket: Bucket; amount: number; note: string },
  ctx: { ip?: string },
) {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw badRequest('VALIDATION_ERROR', 'Adjustment must be a non-zero whole amount.');
  }
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!target) throw badRequest('NOT_FOUND', 'User not found');

  const direction = input.amount > 0 ? 'CREDIT' : 'DEBIT';
  const amount = Math.abs(input.amount);
  const currency = await getSetting('platform.currency', 'PKR');

  const out = await prisma.$transaction(async (tx) => {
    const entry = await moveBalance(tx, userId, input.bucket, direction, amount, direction === 'CREDIT' ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT', {
      entityType: 'Wallet',
      reference: `ADJ${Date.now()}`,
      description: input.note || `Manual ${direction === 'CREDIT' ? 'credit' : 'debit'} by admin`,
      createdById: adminId,
    }, currency);
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'BALANCE_ADJUSTED', entity: 'Wallet', entityId: userId,
        before: { balanceBefore: num(entry.balanceBefore) },
        after: { balanceAfter: num(entry.balanceAfter), bucket: input.bucket, amount: input.amount, note: input.note || null },
        ip: ctx.ip,
      },
    });
    return entry;
  }, TX_OPTS);

  await prisma.notification.create({
    data: {
      userId, type: 'SYSTEM',
      title: 'Wallet adjusted by support',
      body: `${currency} ${input.amount > 0 ? '+' : ''}${input.amount} ${input.bucket} ${input.note ? `— ${input.note}` : ''}`,
    },
  });

  return { entryId: out.id, balanceBefore: num(out.balanceBefore), balanceAfter: num(out.balanceAfter) };
}

// ---------------------------------------------------------------------------
// Tournaments + builder
// ---------------------------------------------------------------------------

export async function listTournamentsAdmin(filter: { page: number; pageSize: number }) {
  const [rows, total] = await Promise.all([
    prisma.tournament.findMany({
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      select: {
        id: true, title: true, slug: true, type: true, status: true, isFeatured: true,
        entryFeePerPlayer: true, prizePool: true, maxSlots: true, registeredSlots: true,
        startTime: true, createdAt: true,
      },
    }),
    prisma.tournament.count(),
  ]);
  return {
    items: rows.map((t) => ({
      ...t,
      entryFeePerPlayer: num(t.entryFeePerPlayer),
      prizePool: num(t.prizePool),
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export interface BuilderInput {
  title: string;
  type: 'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD';
  description?: string;
  map?: string;
  startTime: Date | string;
  registrationDeadline: Date | string;
  maxSlots: number;
  minSlotsToStart: number;
  entryFeePerPlayer: number;
  pointsPerKill: number;
  numWinners: number;
  refundPercent?: number;
  prizes: PrizeInput[];
  publish?: boolean;
  confirmLoss?: boolean;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tournament';

export async function createTournament(adminId: string, input: BuilderInput, ctx: { ip?: string }) {
  const slots = input.type === 'SOLO' ? input.maxSlots : input.maxSlots; // slots are players-wide
  const economics = await computeEconomics({
    type: input.type,
    entryFeePerPlayer: input.entryFeePerPlayer,
    slots,
    prizes: input.prizes,
  });

  if (!economics.safe && !input.confirmLoss) {
    throw badRequest('ECONOMIC_UNSAFE', 'This configuration projects a loss. Enable the loss confirmation to proceed.', economics);
  }

  const base = slugify(input.title);
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

  const tournament = await prisma.tournament.create({
    data: {
      title: input.title,
      slug,
      description: input.description || null,
      type: input.type,
      map: input.map || null,
      status: input.publish ? 'REGISTRATION_OPEN' : 'DRAFT',
      entryFeePerPlayer: new Prisma.Decimal(input.entryFeePerPlayer),
      maxSlots: input.maxSlots,
      minSlotsToStart: input.minSlotsToStart,
      numWinners: input.numWinners,
      pointsPerKill: input.pointsPerKill,
      startTime: new Date(input.startTime),
      registrationDeadline: new Date(input.registrationDeadline),
      prizes: {
        create: input.prizes.map((p, i) => ({
          position: p.kind === 'PLACEMENT' ? i + 1 : i + 1,
          amount: new Prisma.Decimal(p.amount),
          label: p.label ?? (p.kind === 'PLACEMENT' ? `${i + 1} Place` : p.kind === 'KILL_POOL' ? 'Kill Pool' : p.kind),
          kind: p.kind,
          perKill: p.perKill !== undefined ? new Prisma.Decimal(p.perKill) : null,
          cap: p.cap !== undefined ? new Prisma.Decimal(p.cap) : null,
        })),
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'TOURNAMENT_CREATED', entity: 'Tournament', entityId: tournament.id,
      after: { title: input.title, slug, publish: !!input.publish, economics: { ...economics } },
      ip: ctx.ip,
    },
  });

  // Announce published tournaments to every active player.
  if (input.publish) await announceTournament(tournament.id, input.title, tournament.slug, input.type, input.entryFeePerPlayer, input.startTime);

  return { id: tournament.id, slug: tournament.slug, status: tournament.status, economics };
}

/** "New tournament" broadcast — shared by create (publish) and status changes to REGISTRATION_OPEN. */
async function announceTournament(
  id: string, title: string, slug: string, type: string, entryFee: number, startTime: string | Date,
) {
  const when = new Date(startTime).toLocaleString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  await notifyAllUsers({
    type: 'TOURNAMENT_UPDATE',
    title: 'New tournament just dropped 🏆',
    body: `${title} (${type.replace('_', ' ')}) — entry PKR ${entryFee}, starts ${when}. Registration is open — lock your slot!`,
    data: { slug, area: 'tournaments', tournamentId: id },
  });
}

export async function setTournamentStatus(adminId: string, id: string, status: string, ctx: { ip?: string }) {
  const t = await prisma.tournament.findUnique({ where: { id } });
  if (!t) throw badRequest('NOT_FOUND', 'Tournament not found');
  const allowed = ['DRAFT', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED', 'CANCELLED'];
  if (!allowed.includes(status)) throw badRequest('VALIDATION_ERROR', 'Invalid status');
  if (t.status === 'COMPLETED' && status !== 'COMPLETED') {
    throw conflict('CONFLICT', 'Completed tournaments are final — prizes were distributed.');
  }
  await prisma.tournament.update({ where: { id }, data: { status: status as never } });
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'TOURNAMENT_STATUS', entity: 'Tournament', entityId: id,
      before: { status: t.status }, after: { status }, ip: ctx.ip,
    },
  });
  // First time a draft goes live → announce it to every active player.
  if (status === 'REGISTRATION_OPEN' && t.status === 'DRAFT') {
    await announceTournament(id, t.title, t.slug, t.type, t.entryFeePerPlayer.toNumber(), t.startTime.toISOString());
  }
  if (status === 'CANCELLED') {
    // refund via the existing cancellation service path would duplicate Phase 5 logic;
    // guard: only DRAFT/empty tournaments may be cancelled without players.
    const regs = await prisma.tournamentRegistration.count({ where: { tournamentId: id, status: 'CONFIRMED' } });
    if (regs > 0) {
      throw badRequest('VALIDATION_ERROR', 'Use the cancellation flow (Phase 5 engine) for tournaments with confirmed players.');
    }
  }
  return { id, status };
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export async function listMatchesAdmin(filter: { tournamentId?: string; page: number; pageSize: number }) {
  const where: Prisma.MatchWhereInput = filter.tournamentId ? { tournamentId: filter.tournamentId } : {};
  const [rows, total] = await Promise.all([
    prisma.match.findMany({
      where,
      orderBy: { scheduledAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: {
        tournament: { select: { title: true, slug: true, type: true } },
        _count: { select: { participants: true, resultSubmissions: true } },
      },
    }),
    prisma.match.count({ where }),
  ]);
  return {
    items: rows.map((m) => ({
      id: m.id,
      matchNumber: m.matchNumber,
      round: m.round,
      map: m.map,
      scheduledAt: m.scheduledAt,
      status: m.status,
      resultsFinalized: m.resultsFinalized,
      participants: m._count.participants,
      submissions: m._count.resultSubmissions,
      tournament: m.tournament,
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function setMatchStatus(adminId: string, id: string, status: 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED', ctx: { ip?: string }) {
  const m = await prisma.match.findUnique({ where: { id } });
  if (!m) throw badRequest('NOT_FOUND', 'Match not found');
  await prisma.match.update({ where: { id }, data: { status } });
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'MATCH_STATUS', entity: 'Match', entityId: id,
      before: { status: m.status }, after: { status }, ip: ctx.ip,
    },
  });
  return { id, status };
}

// ---------------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------------

export async function listTickets(filter: { status?: string; page: number; pageSize: number }) {
  const where: Prisma.SupportTicketWhereInput = filter.status
    ? { status: filter.status as Prisma.EnumTicketStatusFilter['equals'] }
    : {};
  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: {
        user: { select: { username: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' }, take: 50, include: { sender: { select: { username: true, role: true } } } },
      },
    }),
    prisma.supportTicket.count({ where }),
  ]);
  return {
    items: rows.map((t) => ({
      id: t.id,
      category: t.category,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      user: t.user,
      messages: t.messages.map((m) => ({
        id: m.id, body: m.body, fromStaff: (m.sender?.role ?? 'USER') !== 'USER', sender: m.sender?.username ?? 'staff', createdAt: m.createdAt,
        attachment: m.attachment ? `/api/support/attachments/${m.id}` : null,
      })),
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function replyTicket(adminId: string, id: string, body: string, close: boolean) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id }, include: { user: { select: { username: true } } } });
  if (!ticket) throw badRequest('NOT_FOUND', 'Ticket not found');
  const message = await prisma.supportMessage.create({
    data: { ticketId: id, senderId: adminId, isStaff: true, body },
  });
  await prisma.supportTicket.update({
    where: { id },
    data: { status: close ? 'RESOLVED' : 'WAITING_USER' },
  });
  await prisma.notification.create({
    data: {
      userId: ticket.userId, type: 'SUPPORT_REPLY',
      title: `Support replied: ${ticket.subject}`,
      body: body.slice(0, 160),
      data: { ticketId: id },
    },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'TICKET_REPLIED', entity: 'SupportTicket', entityId: id, after: { close } },
  });
  return { messageId: message.id, status: close ? 'RESOLVED' : 'WAITING_USER' };
}

// ---------------------------------------------------------------------------
// Blog CMS
// ---------------------------------------------------------------------------

export async function listBlog(filter: { page: number; pageSize: number }) {
  const [rows, total] = await Promise.all([
    prisma.blogPost.findMany({
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: { author: { select: { username: true } } },
    }),
    prisma.blogPost.count(),
  ]);
  return {
    items: rows.map((b) => ({
      id: b.id, title: b.title, slug: b.slug, category: b.category, status: b.status,
      excerpt: b.excerpt, author: b.author.username, publishedAt: b.publishedAt, createdAt: b.createdAt,
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function createBlog(adminId: string, input: { title: string; category: string; excerpt?: string; content: string; publish?: boolean; seoTitle?: string; seoDescription?: string }) {
  const slug = `${slugify(input.title)}-${Math.random().toString(36).slice(2, 5)}`;
  const post = await prisma.blogPost.create({
    data: {
      title: input.title,
      slug,
      excerpt: input.excerpt || input.content.slice(0, 160),
      content: input.content,
      category: input.category as never,
      status: input.publish ? 'PUBLISHED' : 'DRAFT',
      authorId: adminId,
      publishedAt: input.publish ? new Date() : null,
      seoTitle: input.seoTitle || null,
      seoDescription: input.seoDescription || null,
    },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'BLOG_CREATED', entity: 'BlogPost', entityId: post.id, after: { slug, publish: !!input.publish } },
  });
  return { id: post.id, slug: post.slug, status: post.status };
}

export async function setBlogStatus(adminId: string, id: string, publish: boolean) {
  const post = await prisma.blogPost.update({
    where: { id },
    data: { status: publish ? 'PUBLISHED' : 'DRAFT', publishedAt: publish ? new Date() : null },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: publish ? 'BLOG_PUBLISHED' : 'BLOG_UNPUBLISHED', entity: 'BlogPost', entityId: id },
  });
  return { id: post.id, status: post.status };
}

// ---------------------------------------------------------------------------
// Ads + SEO
// ---------------------------------------------------------------------------

export async function listAds() {
  const rows = await prisma.advertisement.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map((a) => ({
    id: a.id, placement: a.placement, name: a.name, targetUrl: a.targetUrl,
    isActive: a.isActive, impressions: a.impressions, clicks: a.clicks, createdAt: a.createdAt,
  }));
}

export async function createAd(adminId: string, input: { placement: string; name: string; targetUrl?: string; embedHtml?: string }) {
  const ad = await prisma.advertisement.create({
    data: {
      placement: input.placement as never,
      name: input.name,
      targetUrl: input.targetUrl || null,
      embedHtml: input.embedHtml || null,
    },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'AD_CREATED', entity: 'Advertisement', entityId: ad.id, after: { name: input.name } },
  });
  return { id: ad.id };
}

export async function toggleAd(adminId: string, id: string, isActive: boolean) {
  await prisma.advertisement.update({ where: { id }, data: { isActive } });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'AD_TOGGLED', entity: 'Advertisement', entityId: id, after: { isActive } },
  });
  return { id, isActive };
}

export async function listSeo() {
  return prisma.seoConfig.findMany({ orderBy: { pageSlug: 'asc' } });
}

export async function upsertSeo(adminId: string, input: { pageSlug: string; title?: string; description?: string; canonicalUrl?: string; keywords?: string }) {
  const row = await prisma.seoConfig.upsert({
    where: { pageSlug: input.pageSlug },
    create: {
      pageSlug: input.pageSlug,
      title: input.title || null,
      description: input.description || null,
      canonicalUrl: input.canonicalUrl || null,
      keywords: input.keywords || null,
    },
    update: {
      title: input.title || null,
      description: input.description || null,
      canonicalUrl: input.canonicalUrl || null,
      keywords: input.keywords || null,
    },
  });
  await prisma.auditLog.create({
    data: { actorId: adminId, action: 'SEO_UPDATED', entity: 'SeoConfig', entityId: row.id, after: { pageSlug: input.pageSlug } },
  });
  return { id: row.id, pageSlug: row.pageSlug };
}

// ---------------------------------------------------------------------------
// Settings + audit logs
// ---------------------------------------------------------------------------

export async function listSettings() {
  const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
  return rows.map((r) => ({ key: r.key, value: r.value, description: r.description, updatedAt: r.updatedAt }));
}

export async function updateSetting(adminId: string, key: string, value: unknown, ctx: { ip?: string }) {
  const existing = await prisma.setting.findUnique({ where: { key } });
  if (!existing) throw badRequest('NOT_FOUND', 'Unknown setting key');
  const row = await prisma.setting.update({ where: { key }, data: { value: JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue, updatedById: adminId } });
  invalidateSetting(key);
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'SETTING_UPDATED', entity: 'Setting', entityId: key,
      before: { value: existing.value }, after: { value: JSON.parse(JSON.stringify(value)) }, ip: ctx.ip,
    },
  });
  return { key: row.key, value: row.value };
}

export async function listAuditLogs(filter: { action?: string; entity?: string; page: number; pageSize: number }) {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.action) where.action = { contains: filter.action.toUpperCase() };
  if (filter.entity) where.entity = filter.entity;
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pageOf(filter.page) * filter.pageSize,
      take: filter.pageSize,
      include: { actor: { select: { username: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    items: rows.map((a) => ({
      id: a.id, action: a.action, entity: a.entity, entityId: a.entityId,
      actor: a.actor?.username ?? 'system', before: a.before, after: a.after,
      ip: a.ip, createdAt: a.createdAt,
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}
