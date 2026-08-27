// =============================================================================
// Notifications — user-facing inbox (list / unread count / mark read) plus the
// admin alert helper. Rows are always scoped to the requesting user; nobody
// can ever read or mark another user's notifications.
// =============================================================================
import { prisma } from '../lib/prisma';

export async function listNotifications(userId: string, page: number, pageSize: number) {
  const where = { userId };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, type: true, title: true, body: true, data: true,
        readAt: true, createdAt: true,
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, page, pageSize, total, unread };
}

export async function unreadCount(userId: string) {
  const unread = await prisma.notification.count({ where: { userId, readAt: null } });
  return { unread };
}

/** Marks one notification (owned by the caller) or all of them as read. */
export async function markRead(userId: string, id?: string) {
  const where = id ? { userId, id } : { userId, readAt: null };
  const out = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  return { updated: out.count };
}

/** Delete read notifications older than 30 days (housekeeping, optional use). */
export async function pruneNotifications(userId: string) {
  const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000);
  const out = await prisma.notification.deleteMany({
    where: { userId, readAt: { not: null }, createdAt: { lt: cutoff } },
  });
  return { deleted: out.count };
}

/**
 * Fan-out an alert to every active staff account (ADMIN+ by default). Used for
 * "needs attention" events: deposits pending review, withdrawal requests, …
 * This is what drives the admin bell + notification sound.
 */
export async function notifyAdmins(
  payload: { type: NotificationTypeLike; title: string; body: string; data?: Record<string, unknown> },
  roles: Array<'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN'> = ['ADMIN', 'SUPER_ADMIN'],
) {
  const staff = await prisma.user.findMany({
    where: { role: { in: roles }, status: 'ACTIVE' },
    select: { id: true },
    take: 100,
  });
  if (staff.length === 0) return 0;
  const out = await prisma.notification.createMany({
    data: staff.map((s) => ({
      userId: s.id,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: (payload.data ?? undefined) as never,
    })),
  });
  return out.count;
}

type NotificationTypeLike =
  | 'TOURNAMENT_JOINED' | 'TOURNAMENT_UPDATE' | 'MATCH_STARTING' | 'ROOM_CREDENTIALS'
  | 'RESULT_VERIFIED' | 'TOURNAMENT_COMPLETED' | 'WINNING_CREDITED' | 'DEPOSIT_APPROVED'
  | 'DEPOSIT_REJECTED' | 'WITHDRAWAL_UPDATE' | 'SUPPORT_REPLY' | 'REFERRAL_REWARD'
  | 'TEAM_INVITE' | 'ACCOUNT' | 'SYSTEM';

/**
 * Broadcast to every ACTIVE user — used when a new tournament is published.
 * One createMany (batched), capped defensively.
 */
export async function notifyAllUsers(
  payload: { type: NotificationTypeLike; title: string; body: string; data?: Record<string, unknown> },
) {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
    take: 10_000,
  });
  if (users.length === 0) return 0;
  const BATCH = 500;
  let sent = 0;
  for (let i = 0; i < users.length; i += BATCH) {
    const out = await prisma.notification.createMany({
      data: users.slice(i, i + BATCH).map((u) => ({
        userId: u.id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: (payload.data ?? undefined) as never,
      })),
    });
    sent += out.count;
  }
  return sent;
}
