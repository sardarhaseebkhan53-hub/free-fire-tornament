// =============================================================================
// Integration — the tournament join engine: double-clicks, concurrency, coupons
// and refunds (Phase 5).
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import { cancelRegistration, joinTournament, previewCoupon } from '../../src/services/tournament.service';
import { cleanupUsers, db, ledgerIsConsistent, makeTournament, makeUser, rejectsWithCode, uid, walletOf } from '../helpers/db';

const created: string[] = [];
const ctxIp = '203.0.113.30';

// SOLO joins confirm the player's Free Fire identity at join time (§6) — the
// test users already carry a UID + IGN on their profile (see helpers/db.ts), so
// joins here pass the requirement and exercise the engine itself.
const joinFF = (id: string, t: { slug: string }, extra: Record<string, unknown> = {}) =>
  joinTournament(id, { tournamentSlug: t.slug, ...extra }, ctxIp);

afterAll(async () => {
  await db.coupon.deleteMany({ where: { code: { startsWith: 'TST' } } });
  await db.tournament.deleteMany({ where: { slug: { startsWith: 'tour' } } });
  await cleanupUsers(created);
  await db.$disconnect();
});

describe('join — race safety', () => {
  it('a double-click produces exactly ONE registration', async () => {
    const t = await makeTournament({ entryFee: 50, maxSlots: 5 });
    const u = await makeUser({ cash: 1000 });
    created.push(u.id);

    const results = await Promise.allSettled([
      joinFF(u.id, t),
      joinFF(u.id, t),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);

    expect(await db.tournamentRegistration.count({ where: { tournamentId: t.id, userId: u.id } })).toBe(1);
    expect((await walletOf(u.id)).cash).toBe(950); // charged once
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('ten racers for three slots → exactly three in, never oversold', async () => {
    const t = await makeTournament({ entryFee: 100, maxSlots: 3 });
    const players = await Promise.all(
      Array.from({ length: 10 }, () => makeUser({ cash: 1000, prefix: 'race' })),
    );
    created.push(...players.map((p) => p.id));

    await Promise.allSettled(
      players.map((p) => joinFF(p.id, t)),
    );

    const row = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    const registrations = await db.tournamentRegistration.count({ where: { tournamentId: t.id, status: 'CONFIRMED' } });
    expect(registrations).toBe(3);
    expect(row.registeredSlots).toBe(3); // slot counter matches reality
    expect(row.registeredSlots).toBeLessThanOrEqual(row.maxSlots);
  });

  it('refuses to join once the tournament is full', async () => {
    const t = await makeTournament({ entryFee: 50, maxSlots: 1 });
    const [a, b] = [await makeUser({ cash: 500 }), await makeUser({ cash: 500 })];
    created.push(a.id, b.id);

    await joinFF(a.id, t);
    await rejectsWithCode(() => joinFF(b.id, t), 'TOURNAMENT_FULL');
  });

  it('refuses to join after the registration deadline', async () => {
    const t = await makeTournament({ entryFee: 50, startsInHours: 1 });
    await db.tournament.update({
      where: { id: t.id },
      data: { registrationDeadline: new Date(Date.now() - 60_000) },
    });
    const u = await makeUser({ cash: 500 });
    created.push(u.id);
    await rejectsWithCode(() => joinFF(u.id, t), 'TOURNAMENT_CLOSED');
  });

  it('refuses an unverified or inactive account', async () => {
    const t = await makeTournament({ entryFee: 50 });
    const unverified = await makeUser({ cash: 500, verified: false });
    created.push(unverified.id);
    await rejectsWithCode(() => joinTournament(unverified.id, { tournamentSlug: t.slug }, ctxIp), 'FORBIDDEN');
  });

  it('never trusts a client-supplied entry fee', async () => {
    const t = await makeTournament({ entryFee: 250 });
    const u = await makeUser({ cash: 1000 });
    created.push(u.id);
    // The join input has no amount field at all — the server prices it.
    await joinTournament(u.id, { tournamentSlug: t.slug } as never, ctxIp);
    expect((await walletOf(u.id)).cash).toBe(750);
  });
});

describe('coupons', () => {
  async function makeCoupon(opts: { type: 'PERCENTAGE' | 'FIXED'; value: number; maxDiscount?: number; usageLimit?: number; code?: string }) {
    const code = opts.code ?? `TST${uid('').toUpperCase()}`.slice(0, 16);
    await db.coupon.create({
      data: {
        code,
        type: opts.type,
        value: opts.value,
        maxDiscount: opts.maxDiscount,
        usageLimit: opts.usageLimit,
        usedCount: 0,
        status: 'ACTIVE',
        startsAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 86_400_000),
        appliesTo: [],
      },
    });
    return code;
  }

  it('applies a percentage discount with a cap', async () => {
    const t = await makeTournament({ entryFee: 100 });
    const code = await makeCoupon({ type: 'PERCENTAGE', value: 50, maxDiscount: 20 });
    const u = await makeUser({ cash: 1000 });
    created.push(u.id);

    const preview = await previewCoupon(code, t.id, u.id, 100);
    expect(preview.discount).toBe(20); // 50% of 100 capped at 20
    expect(preview.payable).toBe(80);

    await joinFF(u.id, t, { couponCode: code });
    expect((await walletOf(u.id)).cash).toBe(920);
  });

  it('applies a fixed discount', async () => {
    const t = await makeTournament({ entryFee: 100 });
    const code = await makeCoupon({ type: 'FIXED', value: 30 });
    const u = await makeUser({ cash: 1000 });
    created.push(u.id);
    await joinFF(u.id, t, { couponCode: code });
    expect((await walletOf(u.id)).cash).toBe(930);
  });

  it('refuses reuse by the same player', async () => {
    const code = await makeCoupon({ type: 'FIXED', value: 10 });
    const t1 = await makeTournament({ entryFee: 100 });
    const t2 = await makeTournament({ entryFee: 100 });
    const u = await makeUser({ cash: 1000 });
    created.push(u.id);

    await joinFF(u.id, t1, { couponCode: code });
    await rejectsWithCode(
      () => joinFF(u.id, t2, { couponCode: code }),
      'VALIDATION_ERROR',
    );
  });

  it('refuses an unknown code and records the attempt', async () => {
    const t = await makeTournament({ entryFee: 100 });
    const u = await makeUser({ cash: 1000 });
    created.push(u.id);
    await rejectsWithCode(() => previewCoupon('NOPE-NOPE', t.id, u.id, 100), 'VALIDATION_ERROR');
    expect(await db.auditLog.count({ where: { actorId: u.id, action: 'COUPON_REJECTED' } })).toBeGreaterThanOrEqual(1);
  });

  it('honours the usage limit under concurrent redemptions', async () => {
    const code = await makeCoupon({ type: 'FIXED', value: 10, usageLimit: 2 });
    const tournaments = await Promise.all([
      makeTournament({ entryFee: 100 }),
      makeTournament({ entryFee: 100 }),
      makeTournament({ entryFee: 100 }),
    ]);
    const players = await Promise.all(Array.from({ length: 3 }, () => makeUser({ cash: 1000, prefix: 'cpn' })));
    created.push(...players.map((p) => p.id));

    await Promise.allSettled(
      players.map((p, i) => joinFF(p.id, tournaments[i]!, { couponCode: code })),
    );

    const coupon = await db.coupon.findUniqueOrThrow({ where: { code } });
    expect(coupon.usedCount).toBeLessThanOrEqual(2);
  });
});

describe('cancellation and refunds', () => {
  it('refunds per the tournament refund percentage and frees the slot', async () => {
    const t = await makeTournament({ entryFee: 200 });
    await db.tournament.update({ where: { id: t.id }, data: { refundPercent: 50 } });
    const u = await makeUser({ cash: 1000 });
    created.push(u.id);

    await joinFF(u.id, t);
    expect((await walletOf(u.id)).cash).toBe(800);

    const out = await cancelRegistration(u.id, t.slug);
    expect(out.refundedTotal).toBe(100); // 50% of 200
    expect((await walletOf(u.id)).cash).toBe(900);

    const row = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.registeredSlots).toBe(0);
    expect(await ledgerIsConsistent(u.id)).toEqual({ ok: true, reason: 'ledger and wallet agree' });
  });

  it('refuses to cancel a registration that does not exist', async () => {
    const t = await makeTournament({ entryFee: 50 });
    const u = await makeUser({ cash: 500 });
    created.push(u.id);
    await rejectsWithCode(() => cancelRegistration(u.id, t.slug), 'NOT_FOUND');
  });
});
