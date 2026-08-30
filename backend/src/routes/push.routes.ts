// /api/push — device subscription management (PHASE 19).
//
// Scope on purpose: this router stores where to shout, not what happened. The
// notification itself remains a row in `notifications` (the durable record); a push
// subscription is a disposable delivery address, so it is safe for these routes to be
// idempotent, and safe for the sender to drop entries whenever a push service says gone.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ok } from '../lib/respond';
import { requireAuth } from '../middleware/auth';
import { userAgentOf } from '../lib/security';
import { pushSubscribeSchema } from '../validation/push.schema';
import { pushEnabled, vapidPublicKey } from '../lib/push';

export const pushRouter = Router();

/**
 * Public: can this deployment deliver push at all, and with which key?
 *
 * The client must be able to ask BEFORE it prompts the user for permission — a browser
 * permission request that cannot lead anywhere is a permanently wasted ask.
 */
pushRouter.get('/config', (_req, res) => {
  return ok(res, { enabled: pushEnabled(), publicKey: vapidPublicKey() });
});

/**
 * Subscribe this device. Idempotent by endpoint: the same browser re-subscribing
 * (permission granted again, key rotation, a service-worker update) updates the row
 * instead of stacking duplicates, so the fan-out stays proportional to devices.
 */
pushRouter.post('/subscribe', requireAuth, async (req, res) => {
  const input = pushSubscribeSchema.parse(req.body);
  const keys = { p256dh: input.p256dh.trim(), auth: input.auth.trim() };
  const endpoint = input.endpoint.trim();
  const userAgent = userAgentOf(req);

  const row = await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: req.auth!.id, ...keys, userAgent: userAgent ?? undefined, failCount: 0, lastSeenAt: new Date() },
    create: { userId: req.auth!.id, endpoint, ...keys, userAgent: userAgent ?? null },
    select: { id: true, endpoint: true, createdAt: true },
  });
  return ok(res, { id: row.id, subscribed: true }, 'Push device registered', 201);
});

/** Unsubscribe this device (toggle off, or the browser told us the endpoint expired). */
pushRouter.delete('/subscribe', requireAuth, async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
  if (endpoint) {
    const gone = await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.auth!.id } });
    return ok(res, { removed: gone.count }, 'Push device removed');
  }
  // No endpoint supplied (e.g. the app was reinstalled and the old one is unknown):
  // drop every device the caller still has registered.
  const gone = await prisma.pushSubscription.deleteMany({ where: { userId: req.auth!.id } });
  return ok(res, { removed: gone.count }, 'Push devices removed');
});

/** How many devices are listening — surfaces a "toggle on, zero devices" misconfiguration. */
pushRouter.get('/subscriptions', requireAuth, async (req, res) => {
  const rows = await prisma.pushSubscription.findMany({
    where: { userId: req.auth!.id },
    select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true, failCount: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return ok(res, { total: rows.length, pushEnabled: pushEnabled(), items: rows });
});
