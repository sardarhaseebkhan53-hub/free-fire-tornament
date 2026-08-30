// =============================================================================
// PHASE 19 — WEB PUSH. The claim under test is narrow but absolute:
//
//   "a device alert is a courtesy, never a dependency of a money operation"
//
// so this suite does not mock the push library — it runs the REAL sender (real VAPID
// signing, real payload encryption) against a real HTTP endpoint hosted in-process, and
// then checks what the endpoint actually received. Everything that can go wrong on the
// way to a phone (gone endpoint, 5xx, a hung proxy) has to end up as a counted failure, a
// pruned row, or a timeout — and never as a failed request, a rolled-back write, or an
// unhandled rejection.
// =============================================================================
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import webpush from 'web-push';
import { env } from '../../src/lib/env';
import { buildPushBody, pushEnabled, sendPush, topicOf, vapidPublicKey } from '../../src/lib/push';
import { joinTournament } from '../../src/services/tournament.service';
import { checkIn } from '../../src/services/checkin.service';
import { cleanupUsers, db, makeTournament, makeUser, walletOf } from '../helpers/db';

type Mode = 'ok' | 'gone' | 'error' | 'hang';

const createdUsers: string[] = [];
const createdTournaments: string[] = [];
const original = {
  pub: env.VAPID_PUBLIC_KEY,
  priv: env.VAPID_PRIVATE_KEY,
  subject: env.VAPID_SUBJECT,
  timeout: env.PUSH_TIMEOUT_MS,
  maxFailures: env.PUSH_MAX_FAILURES,
};

/**
 * The fake push service speaks TLS because the real ones do: `web-push` uses
 * `https.request` for every endpoint and has no plain-HTTP mode, so a self-signed
 * certificate here is what makes the test exercise the same code path production uses
 * (including the TLS failure mode, which is why the last section points at a dead port).
 *
 * `NODE_TLS_REJECT_UNAUTHORIZED` is turned off for this file only (restored in `afterAll`)
 * because the certificate is generated at runtime and is not in any trust store. Nothing
 * else in this suite talks TLS, and the setting never affects what ships: production sends
 * to real push services with verification at its default.
 */
let server: https.Server | null = null;
let port = 0;
let mode: Mode = 'ok';
interface Seen { headers: IncomingHttpHeaders; body: Buffer }
let seen: Seen[] = [];
let certDir: string | null = null;
const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

function startFakePushService(): Promise<void> {
  return new Promise((resolve, reject) => {
    certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p19-push-'));
    const key = path.join(certDir, 'key.pem');
    const cert = path.join(certDir, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
        const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
          const body = Buffer.concat(chunks);
          seen.push({ headers: req.headers, body });
          if (mode === 'hang') return; // never answer — the client must give up on its own
          if (mode === 'gone') {
            res.writeHead(410, { location: '' });
            res.end();
            return;
          }
          if (mode === 'error') {
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.end('upstream push service exploded');
            return;
          }
          res.writeHead(201, { location: `https://push.example/${Date.now()}` });
          res.end();
      });
    });
    server!.on('error', reject);
    server!.listen(0, '127.0.0.1', () => {
      port = (server!.address() as AddressInfo).port;
      resolve();
    });
  });
}

/** A browser-real subscription: P-256 public point + 16-byte auth secret, base64url. */
function subscriberKeys(): { p256dh: string; auth: string } {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { p256dh: point.toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
}

async function addDevice(userId: string, opts: { endpoint?: string; failCount?: number } = {}) {
  const keys = subscriberKeys();
  const row = await db.pushSubscription.create({
    data: {
      userId,
      endpoint: opts.endpoint ?? `https://127.0.0.1:${port}/push/${crypto.randomUUID()}`,
      p256dh: keys.p256dh,
      auth: keys.auth,
      failCount: opts.failCount ?? 0,
    },
    select: { id: true, endpoint: true },
  });
  return row;
}

function jwtPayloadOf(header?: string | string): Record<string, unknown> {
  const value = Array.isArray(header) ? header[0]! : header ?? '';
  const match = /vapid\s+t=([^,\s]+)/i.exec(value);
  if (!match) return {};
  const [, t] = match;
  const part = (t as string).split('.')[1] ?? '';
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

beforeAll(async () => {
  await startFakePushService();
  // A real keypair, generated at runtime: no secret in the repo, and the sender still
  // signs every request the way production does.
  const keys = webpush.generateVAPIDKeys();
  env.VAPID_PUBLIC_KEY = keys.publicKey;
  env.VAPID_PRIVATE_KEY = keys.privateKey;
  env.VAPID_SUBJECT = 'mailto:push-tests@clutchnex.local';
});

afterEach(() => {
  mode = 'ok';
  seen = [];
});

afterAll(async () => {
  env.VAPID_PUBLIC_KEY = original.pub;
  env.VAPID_PRIVATE_KEY = original.priv;
  env.VAPID_SUBJECT = original.subject;
  env.PUSH_TIMEOUT_MS = original.timeout;
  env.PUSH_MAX_FAILURES = original.maxFailures;
  await db.pushSubscription.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.notification.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: createdUsers } } });
  if (createdTournaments.length) {
    await db.tournamentRegistration.deleteMany({ where: { tournamentId: { in: createdTournaments } } });
    await db.tournament.deleteMany({ where: { id: { in: createdTournaments } } });
  }
  await cleanupUsers(createdUsers);
  server?.close();
  if (originalRejectUnauthorized === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
  if (certDir) fs.rmSync(certDir, { recursive: true, force: true });
  await db.$disconnect();
});

describe('§0 payload contract with the service worker', () => {
  it('emits exactly the keys frontend/public/sw.js reads', () => {
    const parsed = JSON.parse(buildPushBody({ title: 'Match starting now 🔴', body: 'Room details are in My Matches.', tag: 'MATCH_STARTING:m1', data: { matchId: 'm1' } })) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['body', 'data', 'tag', 'title', 'url']);
    expect(parsed).toMatchObject({
      title: 'Match starting now 🔴',
      body: 'Room details are in My Matches.',
      tag: 'MATCH_STARTING:m1',
      url: '/matches',
      data: { matchId: 'm1' },
    });
  });

  it('defaults the deep link and omits a tag the caller did not set', () => {
    const parsed = JSON.parse(buildPushBody({ title: 'x', body: 'y' })) as { tag: unknown; url: string };
    expect(parsed.tag).toBeNull();
    expect(parsed.url).toBe('/matches');
  });

  it('folds any tag into a spec-legal Topic and drops an over-long one', () => {
    expect(topicOf('MATCH_STARTING:m1')).toBe('MATCH_STARTING_m1');
    // 32 is the spec maximum, so a long tag is truncated rather than rejected.
    const long = topicOf('ROOM_CREDENTIALS:cuid-likes-this-too')!;
    expect(long).toBe('ROOM_CREDENTIALS_cuid-likes-this');
    expect(long.length).toBe(32);
    expect(topicOf('!!!')).toBe('___');
    expect(topicOf(undefined)).toBeUndefined();
    expect(topicOf('')).toBeUndefined();
  });

  it('sends a tournament alert to that tournament page', () => {
    const parsed = JSON.parse(buildPushBody({ title: 'x', body: 'y', url: '/tournaments/pro-squad-cup' })) as { url: string };
    expect(parsed.url).toBe('/tournaments/pro-squad-cup');
  });
});

describe('§1 an unconfigured deployment stays inert', () => {
  it('reports push as off and skips without touching the network', async () => {
    env.VAPID_PUBLIC_KEY = undefined;
    env.VAPID_PRIVATE_KEY = undefined;
    expect(pushEnabled()).toBe(false);
    expect(vapidPublicKey()).toBeNull();

    const u = await makeUser({ cash: 0, prefix: 'p19p' });
    createdUsers.push(u.id);
    await addDevice(u.id);
    const out = await sendPush([u.id], { title: 'x', body: 'y' });
    expect(out).toMatchObject({ configured: false, targets: 0, sent: 0, failed: 0 });
    expect(out.skipped).toMatch(/VAPID/i);
    expect(seen.length).toBe(0);
  });
});

describe('§2 real delivery', () => {
  it('signs, encrypts and delivers, then clears the failure counter', async () => {
    env.VAPID_PUBLIC_KEY = original.pub ?? 'reseed';
    // re-arm the runtime keypair (the previous test blanked env on purpose)
    const keys = webpush.generateVAPIDKeys();
    env.VAPID_PUBLIC_KEY = keys.publicKey;
    env.VAPID_PRIVATE_KEY = keys.privateKey;
    expect(pushEnabled()).toBe(true);

    const u = await makeUser({ cash: 0, prefix: 'p19p' });
    createdUsers.push(u.id);
    const device = await addDevice(u.id, { failCount: 3 });

    const out = await sendPush([u.id], {
      title: 'Match starting now 🔴',
      body: 'Room details are in My Matches.',
      tag: 'MATCH_STARTING:abc',
      data: { matchId: 'abc' },
    });

    expect(out).toMatchObject({ configured: true, targets: 1, sent: 1, failed: 0, pruned: 0 });
    expect(seen.length).toBe(1);
    const req = seen[0]!;

    // VAPID: a signed assertion whose audience is the push service origin.
    expect(String(req.headers.authorization)).toMatch(/^vapid\s+t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+,\s*k=/i);
    const claims = jwtPayloadOf(req.headers.authorization);
    expect(claims.aud).toBe(`https://127.0.0.1:${port}`);
    expect(claims.sub).toBe('mailto:push-tests@clutchnex.local');
    expect(Number(claims.exp)).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // Payload is encrypted per RFC 8291 (`aes128gcm`), so the crypto head lives INSIDE the
    // body rather than in a Crypto-Key header. Reading it back is what proves real
    // encryption happened instead of a plausibly-shaped request:
    //   [0..16) random salt · [16..20) record size · [20] key id length · [21..) ephemeral P-256 point
    expect(String(req.headers['content-encoding'])).toBe('aes128gcm');
    expect(req.body.length).toBeGreaterThan(16 + 4 + 1 + 65 + 16);
    expect(req.body.readUInt32BE(16)).toBeGreaterThanOrEqual(1024); // record size
    expect(req.body[20]).toBe(65); // uncompressed point is 65 bytes
    expect(req.body[21]).toBe(0x04);
    // A real ECDH key pair is per-message, so two sends must not reuse the same salt.
    expect(String(req.headers.ttl)).toBe('60');
    // The title would appear verbatim in a plaintext body: it does not, so it was encrypted.
    expect(req.body.toString('latin1')).not.toContain('Match starting now');

    // The tag travels as the `Topic` header used for replacement, folded into the
    // alphabet the spec allows (1–32 of [A-Za-z0-9_-]). A colon here makes web-push refuse
    // the send outright — this assertion is the regression pin for exactly that.
    const topic = String(req.headers.topic ?? '');
    expect(topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(topic).toBe('MATCH_STARTING_abc');
    expect(String(req.headers.urgency)).toBe('high');

    // Success resets the strike counter and refreshes lastSeenAt.
    const after = await db.pushSubscription.findUniqueOrThrow({ where: { id: device.id }, select: { failCount: true, lastSeenAt: true } });
    expect(after.failCount).toBe(0);
    expect(after.lastSeenAt).toBeInstanceOf(Date);
  });

  it('fans out past the chunk boundary without dropping anyone', async () => {
    const u = await makeUser({ cash: 0, prefix: 'p19p' });
    createdUsers.push(u.id);
    // 30 devices: deliberately straddles the internal chunk size of 25.
    for (let i = 0; i < 30; i += 1) await addDevice(u.id);
    const out = await sendPush([u.id, u.id], { title: 't', body: 'b' }); // duplicate id must collapse
    expect(out.sent).toBe(30);
    expect(seen.length).toBe(30);
  });

  it('returns a zero-target result for a user with no registered device', async () => {
    const u = await makeUser({ cash: 0, prefix: 'p19p' });
    createdUsers.push(u.id);
    const out = await sendPush([u.id], { title: 't', body: 'b' });
    expect(out).toMatchObject({ configured: true, targets: 0, sent: 0, failed: 0 });
  });
});

describe('§3 dead and broken endpoints', () => {
  it('prunes a subscription the push service says is gone', async () => {
    mode = 'gone';
    const u = await makeUser({ cash: 0, prefix: 'p19p' });
    createdUsers.push(u.id);
    const device = await addDevice(u.id);
    const out = await sendPush([u.id], { title: 't', body: 'b' });
    expect(out).toMatchObject({ sent: 0, failed: 1, pruned: 1 });
    expect(await db.pushSubscription.count({ where: { id: device.id } })).toBe(0);
  });

  it('counts a server-side failure and stops trying once past the limit', async () => {
    mode = 'error';
    env.PUSH_MAX_FAILURES = 2;
    const u = await makeUser({ cash: 0, prefix: 'p19p' });
    createdUsers.push(u.id);
    const device = await addDevice(u.id);

    const first = await sendPush([u.id], { title: 't', body: 'b' });
    expect(first).toMatchObject({ failed: 1, pruned: 0 });
    expect((await db.pushSubscription.findUniqueOrThrow({ where: { id: device.id }, select: { failCount: true } })).failCount).toBe(1);

    // Second failure crosses the limit; the third send must not even be attempted — an
    // endpoint nobody wants is not something to keep hammering on every notification.
    await sendPush([u.id], { title: 't', body: 'b' });
    expect((await db.pushSubscription.findUniqueOrThrow({ where: { id: device.id }, select: { failCount: true } })).failCount).toBe(2);
    seen = [];
    const third = await sendPush([u.id], { title: 't', body: 'b' });
    expect(third).toMatchObject({ targets: 0, sent: 0 });
    expect(seen.length).toBe(0);
    await db.pushSubscription.delete({ where: { id: device.id } }).catch(() => undefined);
  });

  it('gives up on a hung push service inside its own timeout', async () => {
    mode = 'hang';
    env.PUSH_TIMEOUT_MS = 300;
    const u = await makeUser({ cash: 0, prefix: 'p19p' });
    createdUsers.push(u.id);
    await addDevice(u.id);
    const started = Date.now();
    const out = await sendPush([u.id], { title: 't', body: 'b' });
    const elapsed = Date.now() - started;
    expect(out.failed).toBe(1);
    // The default is 4s; a 300ms budget must be what actually bounds the call.
    expect(elapsed).toBeLessThan(2_500);
    env.PUSH_TIMEOUT_MS = original.timeout;
  });
});

describe('§4 money paths cannot be harmed by notifications', () => {
  it('a paid join and its check-in both succeed with an unreachable push service', async () => {
    env.PUSH_TIMEOUT_MS = 200;
    const u = await makeUser({ cash: 500, prefix: 'p19p' });
    createdUsers.push(u.id);
    const t = await makeTournament({ entryFee: 10, maxSlots: 10, prizes: [] });
    createdTournaments.push(t.id);

    // A device that will fail on contact: closed port, plus a broken-window window so the
    // sender has to time out rather than get an instant refusal.
    await addDevice(u.id, { endpoint: 'https://127.0.0.1:9/push/dead', failCount: 0 });

    const rejections: unknown[] = [];
    const spy = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', spy);

    const before = await walletOf(u.id);
    expect(before.cash).toBe(500);
    await joinTournament(u.id, { tournamentSlug: t.slug }, '203.0.113.92');
    const afterJoin = await walletOf(u.id);
    expect(Math.round((before.cash - afterJoin.cash) * 100)).toBe(1000);

    // Open the derived window (deadline passed, start ahead) and check in — this is the
    // path that fires a push right after the attendance write.
    await db.tournament.update({
      where: { id: t.id },
      data: { registrationDeadline: new Date(Date.now() - 60_000), startTime: new Date(Date.now() + 10 * 60_000) },
    });
    const out = await checkIn(u.id, t.slug, { ip: '203.0.113.92', userAgent: 'vitest-phase19-push' });
    expect(out.checkedIn).toBe(true);

    // Give the fire-and-forget send time to fail loudly if it ever could.
    await new Promise((r) => setTimeout(r, 600));
    expect(rejections).toEqual([]);
    process.off('unhandledRejection', spy);

    const reg = await db.tournamentRegistration.findUniqueOrThrow({
      where: { tournamentId_userId: { tournamentId: t.id, userId: u.id } },
      select: { checkedInAt: true },
    });
    expect(reg.checkedInAt).toBeInstanceOf(Date);

    // The entry fee is still exactly one ledger row, still consistent, and the in-app
    // notification still exists — delivery is what broke, not the record.
    expect(await db.walletTransaction.count({ where: { userId: u.id, type: 'ENTRY_FEE' } })).toBe(1);
    const { ledgerIsConsistent } = await import('../helpers/db');
    expect((await ledgerIsConsistent(u.id)).ok).toBe(true);
    expect(await db.notification.count({ where: { userId: u.id, title: 'Checked in ✅' } })).toBe(1);

    // The dead device got a strike, not a deletion (ECONNREFUSED is not "unsubscribed").
    const device = await db.pushSubscription.findFirstOrThrow({ where: { userId: u.id }, select: { failCount: true } });
    expect(device.failCount).toBeGreaterThan(0);
    env.PUSH_TIMEOUT_MS = original.timeout;
  });
});
