// =============================================================================
// Web Push delivery — PHASE 19.
//
// The rule this file exists to enforce: **a notification is never part of a money
// transaction.** An entry fee, a prize credit or a refund is the contract; the push is
// a courtesy on top of it. So every function here is fire-and-forget by design:
//
//   • it is only ever called AFTER the transaction has committed;
//   • it can never throw outward (the caller's `await` cannot fail because a phone
//     unsubscribed, a proxy ate the request, or FCM is having a bad minute);
//   • it bounds its own work — a per-subscription timeout, a fan-out chunk size, and a
//     dead-endpoint prune — so a slow push service cannot pin a request handler open;
//   • it keeps no state that matters: losing every row in `push_subscriptions` costs
//     delivery only, never entitlement.
//
// The library is imported lazily: an unconfigured deployment (no VAPID keys) must boot
// and run with zero push code loaded, rather than crashing on a missing keypair.
// =============================================================================
import { env } from './env';
import { prisma } from './prisma';

export interface PushPayload {
  title: string;
  body: string;
  /** Groups replacements in the OS tray (one per match, not one per retry). */
  tag?: string;
  /** In-app route the notification opens, e.g. `/matches`. */
  url?: string;
  data?: Record<string, unknown>;
}

export interface PushOutcome {
  configured: boolean;
  targets: number;
  sent: number;
  failed: number;
  pruned: number;
  skipped?: string;
}

type WebPushLike = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string | Buffer,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  generateVAPIDKeys?: () => { publicKey: string; privateKey: string };
};

let cached: { module: WebPushLike; vapid: { subject: string; publicKey: string; privateKey: string } } | null = null;
let cachedFor = '';

/**
 * VAPID config is read lazily and re-read whenever the env pair changes, so a test can
 * generate a keypair at runtime and exercise the REAL sender (against a local push
 * endpoint) without a global mock.
 */
async function loadPush(): Promise<{ send: WebPushLike['sendNotification']; enabled: true } | { enabled: false; reason: string }> {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return { enabled: false, reason: 'VAPID keys are not configured' };
  const fingerprint = `${publicKey}|${privateKey}|${env.VAPID_SUBJECT}`;
  if (!cached || cachedFor !== fingerprint) {
    const mod = (await import('web-push')) as unknown as { default?: WebPushLike } & WebPushLike;
    const api = (mod.default ?? mod) as WebPushLike;
    api.setVapidDetails(env.VAPID_SUBJECT, publicKey, privateKey);
    cached = { module: api, vapid: { subject: env.VAPID_SUBJECT, publicKey, privateKey } };
    cachedFor = fingerprint;
  }
  return { enabled: true, send: (s, p, o) => cached!.module.sendNotification(s, p, o) };
}

/** Public half of the keypair — the browser needs it to subscribe, nothing else. */
export function vapidPublicKey(): string | null {
  const key = env.VAPID_PUBLIC_KEY?.trim();
  const private_ = env.VAPID_PRIVATE_KEY?.trim();
  return key && private_ ? key : null;
}

export function pushEnabled(): boolean {
  return vapidPublicKey() !== null;
}

/** Never throws: a delivery problem must not become a failed request or a rolled-back write. */
async function withTimeout<T>(work: Promise<T>): Promise<T> {
  const ms = env.PUSH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`push send timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The Web Push `Topic` header is restricted to 1–32 URL/filename-safe base64 characters,
 * and `web-push` THROWS on anything else — so a readable tag like `MATCH_STARTING:m123`
 * (perfect for a service worker, whose `tag` is any string) must be folded before it goes
 * on the wire. This is not cosmetic: without the fold every tagged notification fails to
 * send, which is exactly the bug phase19-push.test.ts caught when the payload otherwise
 * looked correct.
 */
export function topicOf(tag?: string): string | undefined {
  if (!tag) return undefined;
  const safe = tag.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32);
  return safe.length > 0 ? safe : undefined;
}

/**
 * The exact JSON bytes handed to the push service — the shape `frontend/public/sw.js`
 * parses. Exported so that contract is testable without a browser: the payload is
 * encrypted on the wire, so nothing on the receiving end could otherwise prove what we
 * actually put inside it. Keep the two files in step (pinned by phase19-push.test.ts).
 */
export function buildPushBody(payload: PushPayload): string {
  // CONTRACT, not an implementation detail: `frontend/public/sw.js` parses exactly these
  // keys. It is flat on purpose — every extra nesting level in a payload that a browser
  // decrypts and hands to a page is one more way for the two files to drift apart.
  return JSON.stringify({
    title: payload.title,
    body: payload.body,
    // Tray grouping key: the service worker replaces a same-tag notification instead of
    // stacking five copies of one reminder.
    tag: payload.tag ?? null,
    // Where the click goes. `/matches` is the honest default: both time-critical alerts
    // (match starting, room unlocked) live there.
    url: payload.url ?? '/matches',
    data: payload.data ?? {},
  });
}

/**
 * Send to every device of every user in `userIds`. Returns a summary for logging and
 * tests; a failure to deliver is data, never an exception.
 */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<PushOutcome> {
  const outcome: PushOutcome = { configured: false, targets: 0, sent: 0, failed: 0, pruned: 0 };
  try {
    const push = await loadPush();
    if (!push.enabled) {
      outcome.skipped = push.reason;
      return outcome;
    }
    outcome.configured = true;

    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return outcome;
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: { in: ids }, failCount: { lt: env.PUSH_MAX_FAILURES } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
      take: 1_000,
    });
    outcome.targets = subs.length;
    if (subs.length === 0) return outcome;

    const body = buildPushBody(payload);

    const CHUNK = 25;
    for (let i = 0; i < subs.length; i += CHUNK) {
      const batch = subs.slice(i, i + CHUNK);
      const results = await Promise.allSettled(
        batch.map((s) =>
          withTimeout(
            push.send(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              body,
              // TTL short on purpose: a late "your match is starting" is worse than none.
              { TTL: payload.tag ? 60 : 3_600, urgency: 'high', topic: topicOf(payload.tag) },
            ),
          ),
        ),
      );
      for (let j = 0; j < batch.length; j++) {
        const r = results[j]!;
        const sub = batch[j]!;
        if (r.status === 'fulfilled') {
          outcome.sent += 1;
          await prisma.pushSubscription
            .update({ where: { id: sub.id }, data: { lastSeenAt: new Date(), failCount: 0 } })
            .catch(() => undefined);
          continue;
        }
        outcome.failed += 1;
        // 404/410 = the endpoint is gone (uninstalled, cleared data, expired).
        // Delete rather than count: keeping it guarantees another failure forever.
        const status = (r.reason as { statusCode?: number } | undefined)?.statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          outcome.pruned += 1;
          continue;
        }
        await prisma.pushSubscription
          .update({ where: { id: sub.id }, data: { failCount: { increment: 1 } } })
          .catch(() => undefined);
      }
    }
    return outcome;
  } catch (e) {
    // Belt and braces: a broken DB read here must also not escape.
    outcome.failed += 1;
    outcome.skipped = (e as Error)?.message ?? 'push sender error';
    console.warn('[push] delivery failed (ignored, money path unaffected):', outcome.skipped);
    return outcome;
  }
}

/**
 * Same guarantees, for the `data`-shaped notifications the services already create:
 * call this right AFTER the `notification.create(Many)` and never inside a `moneyTx`.
 * `void pushForNotification(...)` is the intended call site shape.
 */
export function pushForNotification(
  userIds: string[],
  notification: { type: string; title: string; body: string; data?: unknown },
): void {
  const data = (notification.data ?? {}) as Record<string, unknown>;
  const url = typeof data.slug === 'string' ? `/tournaments/${data.slug}` : notification.type === 'ROOM_CREDENTIALS' ? '/matches' : '/matches';
  void sendPush(userIds, {
    title: notification.title,
    body: notification.body,
    tag: `${notification.type}:${String(data.matchId ?? data.tournamentId ?? data.slug ?? Date.now())}`,
    url,
    data: { type: notification.type, ...data },
  }).then((out) => {
    if (out.targets > 0 && out.sent === 0) {
      console.warn(`[push] ${notification.type}: 0/${out.targets} delivered`, out.skipped ?? '');
    }
  });
}
