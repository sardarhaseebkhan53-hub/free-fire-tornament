// =============================================================================
// Integration — authentication: registration, login, lockout, refresh rotation
// and replay detection (Phases 3 + 14).
// =============================================================================
import { afterAll, describe, expect, it } from 'vitest';
import * as auth from '../../src/services/auth.service';
import { db, makeUser, rejectsWithCode, uid } from '../helpers/db';

const ctx = { ip: '203.0.113.10', userAgent: 'vitest' };
const created: string[] = [];

afterAll(async () => {
  await db.authToken.deleteMany({ where: { userId: { in: created } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: created } } });
  await db.fraudAlert.deleteMany({ where: { userId: { in: created } } });
  await db.user.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

describe('registration', () => {
  it('creates an ACTIVE account (automatic activation) with wallet and profile', async () => {
    const name = uid('reg');
    const out = await auth.register(
      {
        fullName: 'Reg Test',
        username: name,
        email: `${name}@example.com`,
        password: 'Register@123',
        freeFireUID: `FF${uid('')}`.slice(0, 12),
      },
      ctx,
    );
    created.push(out.user.id);

    const row = await db.user.findUniqueOrThrow({
      where: { id: out.user.id },
      include: { wallet: true, profile: true },
    });
    // ACCOUNT CREATION = AUTOMATICALLY ACTIVE. No admin/email approval gate.
    expect(row.status).toBe('ACTIVE');
    // Email verification is a separate optional track (welcome bonus / badge).
    expect(row.isVerified).toBe(false);
    expect(row.wallet).toBeTruthy();
    expect(row.profile?.fullName).toBe('Reg Test');
    expect(row.referralCode).toMatch(/^CLUTCH-/);
    // Wallet starts empty — activation never credits money.
    expect(Number(row.wallet!.cashBalance)).toBe(0);
    expect(Number(row.wallet!.coinBalance)).toBe(0);
  });

  it('lets a freshly registered user log in immediately without any approval', async () => {
    const name = uid('instant');
    await auth.register(
      { fullName: 'Instant', username: name, email: `${name}@example.com`, password: 'Register@123' },
      ctx,
    ).then((out) => created.push(out.user.id));

    const out = await auth.login(name, 'Register@123', ctx);
    expect(out.user.status).toBe('ACTIVE');
    expect(out.accessToken.split('.')).toHaveLength(3);
  });

  it('hashes the password with bcrypt cost 12 and never stores it in clear', async () => {
    const name = uid('hash');
    const out = await auth.register(
      { fullName: 'Hash', username: name, email: `${name}@example.com`, password: 'Register@123' },
      ctx,
    );
    created.push(out.user.id);
    const row = await db.user.findUniqueOrThrow({ where: { id: out.user.id } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(row.passwordHash).not.toContain('Register@123');
  });

  it('refuses a duplicate email and a duplicate username', async () => {
    const u = await makeUser();
    created.push(u.id);
    await rejectsWithCode(
      () => auth.register({ fullName: 'x', username: uid('dup'), email: u.email, password: 'Register@123' }, ctx),
      'EMAIL_TAKEN',
    );
    await rejectsWithCode(
      () => auth.register({ fullName: 'x', username: u.username, email: `${uid('dup')}@example.com`, password: 'Register@123' }, ctx),
      'USERNAME_TAKEN',
    );
  });
});

describe('login', () => {
  it('issues an access token and a refresh token for valid credentials', async () => {
    const u = await makeUser();
    created.push(u.id);
    const out = await auth.login(u.username, u.password, ctx);
    expect(out.accessToken.split('.')).toHaveLength(3);
    expect(out.refreshToken.length).toBeGreaterThan(20);
    expect(out.user.username).toBe(u.username);
  });

  it('refuses a wrong password', async () => {
    const u = await makeUser();
    created.push(u.id);
    await rejectsWithCode(() => auth.login(u.username, 'not-the-password', ctx), 'INVALID_CREDENTIALS');
  });

  it('accepts email or username as the identifier', async () => {
    const u = await makeUser();
    created.push(u.id);
    const byEmail = await auth.login(u.email, u.password, ctx);
    expect(byEmail.user.id).toBe(u.id);
  });

  it('locks the identifier after the configured number of failures', async () => {
    const u = await makeUser();
    created.push(u.id);
    const max = Number((await db.setting.findUnique({ where: { key: 'security.maxLoginAttempts' } }))?.value ?? 5);
    for (let i = 0; i < max; i++) {
      await auth.login(u.username, `wrong-${i}`, ctx).catch(() => undefined);
    }
    // Even the CORRECT password is refused while the lockout is active.
    await rejectsWithCode(() => auth.login(u.username, u.password, ctx), 'RATE_LIMITED');

    const lockouts = await db.auditLog.count({ where: { actorId: u.id, action: 'LOGIN_LOCKOUT' } });
    expect(lockouts).toBeGreaterThanOrEqual(1);
  });

  it('refuses a banned account', async () => {
    const u = await makeUser();
    created.push(u.id);
    await db.user.update({ where: { id: u.id }, data: { status: 'BANNED', banReason: 'cheating' } });
    await rejectsWithCode(() => auth.login(u.username, u.password, ctx), 'ACCOUNT_BANNED');
  });
});

describe('refresh rotation', () => {
  it('rotates the token and makes the previous one single-use', async () => {
    const u = await makeUser();
    created.push(u.id);
    const { refreshToken } = await auth.login(u.username, u.password, ctx);

    const rotated = await auth.refreshSession(refreshToken, ctx);
    expect(rotated.refreshToken).not.toBe(refreshToken);

    // A replay OUTSIDE the grace window (grace=0 simulates an old replay)
    // must fail…
    await rejectsWithCode(
      () => auth.refreshSession(refreshToken, ctx, 0),
      'TOKEN_INVALID',
    );

    // …and must revoke every live session for that account.
    const live = await db.authToken.count({
      where: { userId: u.id, type: 'REFRESH', revokedAt: null },
    });
    expect(live).toBe(0);

    const alerts = await db.fraudAlert.count({ where: { kind: 'REFRESH_TOKEN_REUSE', userId: u.id } });
    expect(alerts).toBeGreaterThanOrEqual(1);
  });

  it('chains a within-grace replay onto the successor instead of nuking the session', async () => {
    // This is the bug that logged users out: a burst of parallel API calls at
    // access-token expiry each triggers its own refresh with the same cookie.
    // The racers must chain onto the successor token, not get treated as
    // theft and have every session revoked.
    const u = await makeUser();
    created.push(u.id);
    const { refreshToken } = await auth.login(u.username, u.password, ctx);

    const rotated = await auth.refreshSession(refreshToken, ctx);
    expect(rotated.refreshToken).not.toBe(refreshToken);

    // Replay the OLD cookie within the grace window (default 60s): it chains
    // onto the live successor and returns a fresh pair.
    const chained = await auth.refreshSession(refreshToken, ctx);
    expect(chained.refreshToken).toBeTruthy();
    expect(chained.accessToken).toBeTruthy();

    // The account still has a live session — nothing was revoked.
    const live = await db.authToken.count({
      where: { userId: u.id, type: 'REFRESH', revokedAt: null },
    });
    expect(live).toBeGreaterThanOrEqual(1);

    // No fraud alert for a benign race.
    const alerts = await db.fraudAlert.count({ where: { kind: 'REFRESH_TOKEN_REUSE', userId: u.id } });
    expect(alerts).toBe(0);
  });

  it('stores refresh tokens only as hashes', async () => {
    const u = await makeUser();
    created.push(u.id);
    const { refreshToken } = await auth.login(u.username, u.password, ctx);
    const row = await db.authToken.findFirst({ where: { userId: u.id, type: 'REFRESH' } });
    expect(row?.tokenHash).not.toBe(refreshToken);
    expect(row?.tokenHash).toHaveLength(64); // sha256 hex
  });
});

describe('password changes', () => {
  it('refuses a wrong current password and accepts the right one', async () => {
    const u = await makeUser();
    created.push(u.id);
    await rejectsWithCode(() => auth.changePassword(u.id, 'wrong', 'Brand@New123', ctx), 'INVALID_CREDENTIALS');

    await auth.changePassword(u.id, u.password, 'Brand@New123', ctx);
    await expect(auth.login(u.username, 'Brand@New123', ctx)).resolves.toBeTruthy();

    const audits = await db.auditLog.count({ where: { actorId: u.id, action: 'PASSWORD_CHANGED' } });
    expect(audits).toBe(1);
  });
});

describe('profile editing (spec §20)', () => {
  it('creates a profile on first update, persists values and audits PROFILE_UPDATED', async () => {
    const u = await makeUser();
    created.push(u.id);

    const out = await auth.updateProfile(u.id, {
      fullName: 'Ali Khan',
      freeFireUID: '1122334455',
      freeFireIGN: 'ClutchKing',
      city: 'Karachi',
      bio: 'Solo grinder',
      showPublicProfile: true,
    });

    expect(out.profile?.freeFireUID).toBe('1122334455');
    expect(out.profile?.freeFireIGN).toBe('ClutchKing');

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(profile.fullName).toBe('Ali Khan');
    expect(profile.city).toBe('Karachi');
    expect(profile.showPublicProfile).toBe(true);

    const audits = await db.auditLog.count({ where: { actorId: u.id, action: 'PROFILE_UPDATED', entity: 'UserProfile' } });
    expect(audits).toBe(1);
  });

  it('rejects a Free Fire UID already linked to another account', async () => {
    const a = await makeUser({ prefix: 'pf-a' });
    const b = await makeUser({ prefix: 'pf-b' });
    created.push(a.id, b.id);

    await auth.updateProfile(a.id, { freeFireUID: '5566778899', freeFireIGN: 'Alpha' });
    await rejectsWithCode(
      () => auth.updateProfile(b.id, { freeFireUID: '5566778899', freeFireIGN: 'Beta' }),
      'FF_UID_TAKEN',
    );
    // The losing account's identity is untouched.
    const bProfile = await db.userProfile.findUniqueOrThrow({ where: { userId: b.id } });
    expect(bProfile.freeFireUID).not.toBe('5566778899');
  });

  it('allows clearing the UID and re-using it elsewhere', async () => {
    const a = await makeUser({ prefix: 'pf-c' });
    const b = await makeUser({ prefix: 'pf-d' });
    created.push(a.id, b.id);

    await auth.updateProfile(a.id, { freeFireUID: '6677889900', freeFireIGN: 'One' });
    await auth.updateProfile(a.id, { freeFireUID: null });
    await auth.updateProfile(b.id, { freeFireUID: '6677889900', freeFireIGN: 'Two' }); // must not collide now

    const aProfile = await db.userProfile.findUniqueOrThrow({ where: { userId: a.id } });
    expect(aProfile.freeFireUID).toBeNull();
    const bProfile = await db.userProfile.findUniqueOrThrow({ where: { userId: b.id } });
    expect(bProfile.freeFireUID).toBe('6677889900');
  });
});
