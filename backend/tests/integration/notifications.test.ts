// =============================================================================
// Integration — notification system + referral rewards + match reminders:
//   • referred player's FIRST APPROVED deposit ≥ PKR 100 → referrer +PKR 50
//     (bonus balance), exactly once; logins, rejections and sub-100 deposits
//     never credit
//   • admins get an alert notification when a deposit is submitted
//   • new tournaments announced to all active users
//   • "match starts in ~5 min" reminder fires once per match (restart-safe)
//   • the notification inbox is strictly scoped to its owner
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma';
import * as auth from '../../src/services/auth.service';
import * as payment from '../../src/services/payment.service';
import * as adminSvc from '../../src/services/admin.service';
import { notifyUpcomingMatches } from '../../src/services/scheduler.service';
import { listNotifications, markRead, unreadCount } from '../../src/services/notification.service';
import { db, makeUser, makeTournament, uid, walletOf } from '../helpers/db';

const ctx = { ip: '203.0.113.20', userAgent: 'vitest' };
const users: string[] = [];
const tournaments: string[] = [];
const depositIds: string[] = [];

const D = (n: number) => new Prisma.Decimal(n);

afterAll(async () => {
  await db.notification.deleteMany({ where: { userId: { in: users } } });
  await db.deposit.deleteMany({ where: { id: { in: depositIds } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: users } } });
  await db.referralReward.deleteMany({ where: { referrerId: { in: users } } });
  await db.walletTransaction.deleteMany({ where: { userId: { in: users } } });
  await db.tournamentRegistration.deleteMany({ where: { tournamentId: { in: tournaments } } });
  await db.tournament.deleteMany({ where: { id: { in: tournaments } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

async function registerReferred(referralCode: string, prefix: string) {
  const name = uid(prefix);
  const out = await auth.register(
    {
      fullName: 'Referred Player', username: name, email: `${name}@example.com`,
      password: 'Register@123', referralCode,
    },
    ctx,
  );
  users.push(out.user.id);
  return { ...out.user, password: 'Register@123' };
}

async function pendingDeposit(userId: string, amount: number) {
  const dep = await db.deposit.create({
    data: {
      userId,
      amount: D(amount),
      method: 'JAZZCASH',
      transactionId: uid('tid'),
      senderName: 'Test Sender',
      screenshot: '/uploads/deposits/test.png',
    },
  });
  depositIds.push(dep.id);
  return dep;
}

describe('referral rewards — first approved deposit ≥ PKR 100 (PKR 50)', () => {
  it('never credits on login — only a qualifying approved deposit pays', async () => {
    const referrer = await makeUser({ prefix: 'ref' });
    users.push(referrer.id);
    const referred = await registerReferred(referrer.referralCode, 'rlogin');

    // Sign-ins (even the first) never pay anything under this ruleset.
    expect((await walletOf(referrer.id)).bonus).toBe(0);
    await auth.login(referred.username, referred.password, ctx);
    await auth.login(referred.username, referred.password, ctx);
    expect((await walletOf(referrer.id)).bonus).toBe(0);

    // Exactly one PENDING reward row exists, for the deposit action.
    const rows = await db.referralReward.findMany({ where: { referredUserId: referred.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.qualifyingAction).toBe('FIRST_DEPOSIT_APPROVED');
    expect(rows[0]?.status).toBe('PENDING');
  });

  it('credits PKR 50 on the first approved deposit ≥ 100 — smaller or rejected deposits never qualify', async () => {
    const admin = await makeUser({ role: 'ADMIN', prefix: 'adm' });
    users.push(admin.id);
    const referrer = await makeUser({ prefix: 'ref2' });
    users.push(referrer.id);
    const referred = await registerReferred(referrer.referralCode, 'rdep');

    // REJECTED deposit (300) → nothing.
    const d1 = await pendingDeposit(referred.id, 300);
    await payment.reviewDeposit(admin.id, d1.id, 'REJECT', 'not found', ctx);
    expect((await walletOf(referrer.id)).bonus).toBe(0);

    // Approved deposit BELOW the PKR-100 minimum (50) → still nothing; the
    // reward stays PENDING for a later qualifying deposit.
    const dSmall = await pendingDeposit(referred.id, 50);
    await payment.reviewDeposit(admin.id, dSmall.id, 'APPROVE', 'small top-up', ctx);
    expect((await walletOf(referrer.id)).bonus).toBe(0);
    const pendingRow = await db.referralReward.findFirst({ where: { referredUserId: referred.id } });
    expect(pendingRow?.status).toBe('PENDING');

    // First QUALIFYING approved deposit (500 ≥ 100) → +50.
    const d2 = await pendingDeposit(referred.id, 500);
    await payment.reviewDeposit(admin.id, d2.id, 'APPROVE', 'verified', ctx);
    expect((await walletOf(referrer.id)).bonus).toBe(50);

    // Any later approved deposit → no further reward.
    const d3 = await pendingDeposit(referred.id, 700);
    await payment.reviewDeposit(admin.id, d3.id, 'APPROVE', 'verified again', ctx);
    expect((await walletOf(referrer.id)).bonus).toBe(50);

    // Reward row closed exactly once, with a ledger link + notification.
    const row = await db.referralReward.findFirstOrThrow({ where: { referredUserId: referred.id } });
    expect(row.status).toBe('CREDITED');
    expect(row.walletTxId).toBeTruthy();
    const inbox = await listNotifications(referrer.id, 1, 20);
    expect(inbox.items.some((n) => n.type === 'REFERRAL_REWARD' && n.title.includes('Referral reward'))).toBe(true);

    // Referred player got their cash exactly once per approval.
    expect((await walletOf(referred.id)).cash).toBe(1250);
  });

  it('a first deposit below the minimum is made good by a later qualifying one', async () => {
    const admin = await makeUser({ role: 'ADMIN', prefix: 'admq' });
    users.push(admin.id);
    const referrer = await makeUser({ prefix: 'ref3' });
    users.push(referrer.id);
    const referred = await registerReferred(referrer.referralCode, 'rlate');

    const dSmall = await pendingDeposit(referred.id, 80);
    await payment.reviewDeposit(admin.id, dSmall.id, 'APPROVE', 'small', ctx);
    expect((await walletOf(referrer.id)).bonus).toBe(0);

    const dBig = await pendingDeposit(referred.id, 150);
    await payment.reviewDeposit(admin.id, dBig.id, 'APPROVE', 'qualifies', ctx);
    expect((await walletOf(referrer.id)).bonus).toBe(50);
  });
});

describe('admin alerts', () => {
  it('notifies admins when a deposit is submitted for review', async () => {
    const admin = await makeUser({ role: 'ADMIN', prefix: 'adm2' });
    users.push(admin.id);
    const player = await makeUser({ prefix: 'pl' });
    users.push(player.id);

    const out = await payment.createDeposit(
      player.id,
      { amount: 500, method: 'JAZZCASH', transactionId: uid('tid'), senderName: 'P' },
      '/uploads/deposits/test.png',
      ctx,
    );
    depositIds.push(out.deposit.id);

    const inbox = await listNotifications(admin.id, 1, 20);
    expect(inbox.items.some((n) => n.title.includes('deposit pending review'))).toBe(true);
  });

  it('announces newly published tournaments to active users', async () => {
    const admin = await makeUser({ role: 'ADMIN', prefix: 'adm3' });
    users.push(admin.id);
    const player = await makeUser({ prefix: 'pl2' });
    users.push(player.id);

    const t = await makeTournament({ status: 'DRAFT', startsInHours: 48 });
    tournaments.push(t.id);
    await adminSvc.setTournamentStatus(admin.id, t.id, 'REGISTRATION_OPEN', ctx);

    const inbox = await listNotifications(player.id, 1, 20);
    expect(inbox.items.some((n) => n.type === 'TOURNAMENT_UPDATE' && n.title.includes('New tournament'))).toBe(true);
  });
});

describe('match-start reminders (~5 min before)', () => {
  it('notifies confirmed participants exactly once per match', async () => {
    const t = await makeTournament({ startsInHours: 0.05 }); // ~3 minutes out
    tournaments.push(t.id);
    const player = await makeUser({ prefix: 'mpl' });
    users.push(player.id);
    await db.tournamentRegistration.create({
      data: { tournamentId: t.id, userId: player.id, entryAmount: D(0) },
    });
    const m = await db.match.create({
      data: {
        tournamentId: t.id, round: 1, matchNumber: 1,
        scheduledAt: new Date(Date.now() + 3 * 60_000),
      },
    });

    const sent = await notifyUpcomingMatches();
    expect(sent).toBeGreaterThan(0);
    const first = await listNotifications(player.id, 1, 20);
    expect(first.items.filter((n) => n.type === 'MATCH_STARTING')).toHaveLength(1);
    expect((await db.match.findUnique({ where: { id: m.id } }))?.startNotifiedAt).toBeTruthy();

    // Second tick (or a restart) must not duplicate.
    await notifyUpcomingMatches();
    const second = await listNotifications(player.id, 1, 20);
    expect(second.items.filter((n) => n.type === 'MATCH_STARTING')).toHaveLength(1);
  });
});

describe('notification inbox ownership', () => {
  it('only shows and marks the owner’s notifications', async () => {
    const a = await makeUser({ prefix: 'owna' });
    const b = await makeUser({ prefix: 'ownb' });
    users.push(a.id, b.id);
    await db.notification.create({
      data: { userId: a.id, type: 'SYSTEM', title: 'For A', body: 'private' },
    });

    const inboxA = await listNotifications(a.id, 1, 20);
    expect(inboxA.items.some((n) => n.title === 'For A')).toBe(true);
    const inboxB = await listNotifications(b.id, 1, 20);
    expect(inboxB.items.some((n) => n.title === 'For A')).toBe(false);

    expect((await unreadCount(a.id)).unread).toBe(1);
    // Marking B's inbox read must not touch A's row.
    await markRead(b.id);
    expect((await unreadCount(a.id)).unread).toBe(1);
    await markRead(a.id);
    expect((await unreadCount(a.id)).unread).toBe(0);
  });
});
