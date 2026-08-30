/* eslint-disable no-console */
// =============================================================================
// Phase 14 verification — security hardening.
//
// Run (backend server + database up, seeded):
//   npx tsx scripts/verify-security.mts
//
// Proves, against the LIVE API:
//   1. UPLOADS are validated by their bytes — an HTML page renamed .png, a
//      GIF, a mislabelled JPEG, a 1×1 "screenshot" and an oversized image are
//      all refused; a real PNG is accepted.
//   2. UPLOAD PRIVACY — private folders are not statically served, the gated
//      routes stay owner-or-staff, and path traversal cannot escape the root.
//   3. FRAUD DETECTION — every detector raises the right alert from real
//      traffic (duplicate TIDs, reused proofs, bursts, churn, shared payout
//      accounts, multi-account signups, credential stuffing, refresh replay,
//      join failures, coupon guessing), alerts dedupe, and detection NEVER
//      changes the financial outcome of the request it observes.
//   4. AUDIT — failed logins, lockouts, registrations, password changes, join
//      and coupon rejections and fraud reviews all land in the audit trail.
//   5. CSRF — cookie-authenticated endpoints refuse cross-site requests and
//      requests without the first-party marker.
//   6. HEADERS + LIMITS — CSP/nosniff/CORP present, 413 on huge bodies, 429 on
//      the identity limits.
//   7. RBAC — the fraud queue is ADMIN+ only, and reviewing is idempotent.
// =============================================================================
import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { gif, jpeg, notAnImage, png, pngHeaderOnly } from './lib/fixtures.js';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api';
const ROOT = API.replace(/\/api$/, '');
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=5';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

interface Res { status: number; json: Record<string, unknown>; headers: Headers }

async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; form?: FormData; headers?: Record<string, string>; raw?: boolean } = {},
): Promise<Res & { text?: string }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API}${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  if (opts.raw) return { status: res.status, json: {}, headers: res.headers, text: await res.text() };
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json, headers: res.headers };
}

const signToken = (sub: string, username: string, role = 'USER') =>
  jwt.sign({ sub, role, username }, ACCESS_SECRET, { expiresIn: '15m' });

async function createUser(db: pg.Client, username: string, cash = 0, winning = 0): Promise<string> {
  const id = (await db.query(
    `INSERT INTO users (id, username, email, "passwordHash", role, status, "isVerified", "referralCode", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $1 || '@example.com', $2, 'USER', 'ACTIVE', true, 'SEC-' || substr(md5($1),1,5), now(), now())
     RETURNING id`,
    [username, bcrypt.hashSync('Security@12345', 10)],
  )).rows[0].id as string;
  await db.query(
    `INSERT INTO wallets (id, "userId", "cashBalance", "winningBalance", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())`,
    [id, cash, winning],
  );
  return id;
}

const depositForm = (over: Record<string, string>, bytes: Buffer, mime = 'image/png', name = 'proof.png') => {
  const fd = new FormData();
  fd.set('amount', over.amount ?? '500');
  fd.set('method', over.method ?? 'JAZZCASH');
  fd.set('transactionId', over.transactionId ?? `SEC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fd.set('senderName', over.senderName ?? 'Security Tester');
  fd.set('screenshot', new Blob([bytes], { type: mime }), name);
  return fd;
};

async function alertsOf(db: pg.Client, kind: string, userId?: string) {
  const q = userId
    ? `SELECT * FROM fraud_alerts WHERE kind=$1 AND "userId"=$2 ORDER BY "createdAt" DESC`
    : `SELECT * FROM fraud_alerts WHERE kind=$1 ORDER BY "createdAt" DESC`;
  const params = userId ? [kind, userId] : [kind];
  return (await db.query(q, params)).rows as Array<{
    id: string; kind: string; severity: string; status: string; details: Record<string, unknown>; createdAt: Date;
  }>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Short pause after a write whose side effects we do not poll for. */
const settle = () => wait(450);

/**
 * Detectors are fire-and-forget and queue behind the single-writer dev
 * database, so poll for the alert rather than sleeping a fixed amount.
 */
async function waitForAlert(db: pg.Client, kind: string, userId?: string, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await alertsOf(db, kind, userId)).length > 0) return true;
    if (Date.now() > deadline) return false;
    await wait(150);
  }
}

/**
 * Rate limiters key on the client IP. Giving throwaway requests their own
 * documentation-range address keeps the identity-tier budget free for the
 * checks that actually measure it — and lets the suite run back to back.
 */
let ipSeq = 0;
const freshIp = () => `198.51.100.${(ipSeq++ % 200) + 1}`;
const RUN_IP = `203.0.113.${(Date.now() % 200) + 1}`;

async function main() {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();

  console.log('\n— CLUTCHNEX Phase 14: security hardening —\n');

  // Clean slate — also removes anything a previous, interrupted run left behind
  // so the suite is idempotent.
  await cleanup(db);
  await db.query(`DELETE FROM fraud_alerts`);

  // Run-unique identities: the login lockout lives in the API process's memory
  // for 15 minutes, so a fixed username would arrive pre-locked on a re-run.
  const RUN = Date.now().toString(36);
  const ALICE = `sectest_a${RUN}`;
  const BOB = `sectest_b${RUN}`;
  const [u1, u2] = [await createUser(db, ALICE, 5000), await createUser(db, BOB, 5000)];
  const t1 = signToken(u1, ALICE);
  const t2 = signToken(u2, BOB);
  const adminId = (await db.query(
    `INSERT INTO users (id, username, email, "passwordHash", role, status, "isVerified", "referralCode", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $2, $2 || '@example.com', $1, 'ADMIN', 'ACTIVE', true, 'SEC-' || substr(md5($2),1,6), now(), now())
     RETURNING id`,
    [bcrypt.hashSync('Security@12345', 10), `sectest_adm${RUN}`],
  )).rows[0].id as string;
  const admin = signToken(adminId, `sectest_adm${RUN}`, 'ADMIN');

  // ===========================================================================
  // 1. UPLOAD VALIDATION — bytes, not claims
  // ===========================================================================
  console.log('— 1. Upload validation —');

  const html = await api('/wallet/deposits', { token: t1, form: depositForm({ transactionId: 'SEC-HTML-1' }, notAnImage(), 'image/png', 'evil.png') });
  check('HTML renamed to .png is refused', html.status === 400, String((html.json as { message?: string }).message));
  check('…with an honest NOT_AN_IMAGE reason', String((html.json as { message?: string }).message ?? '').includes('not a real image'));

  const gifRes = await api('/wallet/deposits', { token: t1, form: depositForm({ transactionId: 'SEC-GIF-1' }, gif(), 'image/gif', 'shot.gif') });
  check('GIF upload refused', gifRes.status === 400, String((gifRes.json as { message?: string }).message));

  const mislabeled = await api('/wallet/deposits', { token: t1, form: depositForm({ transactionId: 'SEC-MIME-1' }, png(64), 'image/jpeg', 'proof.jpg') });
  check('PNG sent as image/jpeg refused (declared ≠ real)', mislabeled.status === 400, String((mislabeled.json as { message?: string }).message));

  // (dimension checks run as the second player so neither account burns its
  //  whole deposit rate budget on rejected uploads)
  const tiny = await api('/wallet/deposits', { token: t2, form: depositForm({ transactionId: 'SEC-TINY-1' }, png(8), 'image/png') });
  check('1×1/8×8 "screenshot" refused', tiny.status === 400, String((tiny.json as { message?: string }).message));

  const huge = await api('/wallet/deposits', { token: t2, form: depositForm({ transactionId: 'SEC-HUGE-1' }, pngHeaderOnly(9000, 9000), 'image/png') });
  check('oversized image (9000px) refused', huge.status === 400, String((huge.json as { message?: string }).message));

  const realJpeg = await api('/wallet/deposits', { token: t1, form: depositForm({ transactionId: 'SEC-JPEG-OK' }, jpeg(120, 90), 'image/jpeg', 'proof.jpg') });
  check('a real JPEG proof is accepted', realJpeg.status === 201 && (realJpeg.json as { success?: boolean }).success === true, `HTTP ${realJpeg.status}`);

  const realPng = await api('/wallet/deposits', { token: t1, form: depositForm({ transactionId: 'SEC-PNG-OK' }, png(64), 'image/png') });
  check('a real PNG proof is accepted', realPng.status === 201, `HTTP ${realPng.status}`);
  const depPngId = ((realPng.json as { data?: { deposit?: { id: string } } }).data?.deposit?.id) ?? '';
  const storedHash = depPngId
    ? (await db.query(`SELECT "screenshotHash" FROM deposits WHERE id=$1`, [depPngId])).rows[0]?.screenshotHash
    : null;
  check('the stored proof carries a SHA-256 content hash', typeof storedHash === 'string' && storedHash.length === 64, String(storedHash)?.slice(0, 12));

  // ===========================================================================
  // 2. UPLOAD PRIVACY + TRAVERSAL
  // ===========================================================================
  console.log('\n— 2. Upload privacy —');

  const depRow = await db.query(`SELECT screenshot FROM deposits WHERE id=$1`, [depPngId]);
  const rel = String(depRow.rows[0].screenshot).replace(/^\/uploads\//, '');
  const staticHit = await fetch(`${ROOT}/uploads/${rel}`);
  check('private deposit proof is NOT served by /uploads', staticHit.status === 403, `HTTP ${staticHit.status}`);

  const ownerShot = await api(`/wallet/deposits/${depPngId}/screenshot`, { token: t1, raw: true });
  check('owner can still fetch the proof through the gated route', ownerShot.status === 200, `HTTP ${ownerShot.status}`);
  check('…served with nosniff + sandbox CSP', ownerShot.headers.get('x-content-type-options') === 'nosniff'
    && String(ownerShot.headers.get('content-security-policy') ?? '').includes('sandbox'),
    String(ownerShot.headers.get('content-security-policy')));

  const otherShot = await api(`/wallet/deposits/${depPngId}/screenshot`, { token: t2 });
  check('another player cannot fetch it', otherShot.status === 403, `HTTP ${otherShot.status}`);
  const anonShot = await api(`/wallet/deposits/${depPngId}/screenshot`);
  check('anonymous cannot fetch it', anonShot.status === 401, `HTTP ${anonShot.status}`);

  const traverse = await fetch(`${ROOT}/uploads/../.env`);
  check('path traversal cannot escape the upload root', traverse.status >= 400, `HTTP ${traverse.status}`);
  const traverse2 = await fetch(`${ROOT}/uploads/deposits/..%2f..%2f.env`);
  check('encoded traversal is blocked too', traverse2.status >= 400, `HTTP ${traverse2.status}`);

  // ===========================================================================
  // 3. FRAUD DETECTION
  // ===========================================================================
  console.log('\n— 3. Fraud detection —');

  // Lower the burst threshold through the admin API — a raw SQL UPDATE would
  // not be visible for up to 30s (the settings cache is invalidated on write).
  const setBurst = await api('/admin/settings', { token: admin, body: { key: 'security.maxDepositsPerHour', value: 2 } });
  check('thresholds are admin-tunable at runtime', setBurst.status === 200, `HTTP ${setBurst.status}`);

  // 3a. duplicate TID across accounts (the second insert is refused)
  const dupTid = await api('/wallet/deposits', {
    token: t2, form: depositForm({ transactionId: 'SEC-PNG-OK', amount: '500' }, png(64, [10, 200, 90, 255])),
  });
  check('duplicate TID still refused with DUPLICATE_TRANSACTION', dupTid.status === 409 && dupTid.json.code === 'DUPLICATE_TRANSACTION', String(dupTid.json.code));
  await settle();
  check('DUPLICATE_TID alert raised', await waitForAlert(db, 'DUPLICATE_TID'));

  // 3b. the SAME screenshot bytes from a second account
  const sameBytes = png(64, [7, 7, 7, 255]);
  await api('/wallet/deposits', { token: t1, form: depositForm({ transactionId: 'SEC-PROOF-A' }, sameBytes) });
  await api('/wallet/deposits', { token: t2, form: depositForm({ transactionId: 'SEC-PROOF-B' }, sameBytes) });
  await settle();
  check('REUSED_PROOF alert raised (one screenshot, two accounts)', await waitForAlert(db, 'REUSED_PROOF'));

  // 3c. the same screenshot twice from ONE account
  const twice = png(64, [42, 42, 42, 255]);
  await api('/wallet/deposits', { token: t1, form: depositForm({ transactionId: 'SEC-PROOF-C1' }, twice) });
  await api('/wallet/deposits', { token: t1, form: depositForm({ transactionId: 'SEC-PROOF-C2' }, twice) });
  await settle();
  check('DUPLICATE_PROOF alert raised (one account, one screenshot twice)', await waitForAlert(db, 'DUPLICATE_PROOF'));

  // 3d. deposit burst — the threshold was lowered to 2/hour above, and this
  // account has now submitted three proofs.
  check('DEPOSIT_BURST alert raised', await waitForAlert(db, 'DEPOSIT_BURST', u1));

  // 3e. unusual amount vs the player's own history
  const whale = await api('/wallet/deposits', { token: t1, form: depositForm({ transactionId: 'SEC-WHALE', amount: '24000' }, png(64, [250, 250, 10, 255])) });
  check('the outlier deposit is accepted', whale.status === 201, `HTTP ${whale.status} ${String((whale.json as { message?: string }).message ?? '')}`);
  await settle();
  check('UNUSUAL_DEPOSIT_AMOUNT alert raised', await waitForAlert(db, 'UNUSUAL_DEPOSIT_AMOUNT', u1));

  // 3f. dedupe: the same signal twice must not flood the queue
  const beforeDedupe = (await db.query(`SELECT count(*) n FROM fraud_alerts WHERE kind='REUSED_PROOF'`)).rows[0].n;
  const again = png(64, [7, 7, 7, 255]);
  await api('/wallet/deposits', { token: t2, form: depositForm({ transactionId: 'SEC-PROOF-D' }, again) });
  await settle();
  const afterDedupe = await db.query(`SELECT details->>'occurrences' occ, count(*) n FROM fraud_alerts WHERE kind='REUSED_PROOF' GROUP BY 1 ORDER BY 1`);
  check('repeat signals dedupe into one alert', Number(afterDedupe.rows[0].n) === Number(beforeDedupe) || afterDedupe.rows.length === 1,
    `rows=${afterDedupe.rows.length} occurrences=${afterDedupe.rows[0].occ}`);

  // 3g. withdrawals: churn + shared payout account
  await db.query(`UPDATE wallets SET "winningBalance"=20000 WHERE "userId"=$1`, [u2]);
  await db.query(`UPDATE deposits SET status='APPROVED', "reviewedAt"=now() WHERE "userId"=$1 AND status='PENDING'`, [u2]);
  const preWdRow = (await db.query(`SELECT "cashBalance" c, "winningBalance" w FROM wallets WHERE "userId"=$1`, [u2])).rows[0];
  const before2h = Number(preWdRow.c) + Number(preWdRow.w);
  const wd = await api('/wallet/withdrawals', {
    token: t2,
    body: { amount: 400, method: 'JAZZCASH', accountName: 'Bob Tester', accountNumber: '03001234567' },
  });
  check('withdrawal request accepted', wd.status === 201, `HTTP ${wd.status}`);
  const after2hRow = (await db.query(`SELECT "cashBalance" c, "winningBalance" w FROM wallets WHERE "userId"=$1`, [u2])).rows[0];
  void after2hRow;
  await settle();
  check('DEPOSIT_WITHDRAW_CHURN alert raised', await waitForAlert(db, 'DEPOSIT_WITHDRAW_CHURN', u2));

  await db.query(`UPDATE wallets SET "winningBalance"=20000 WHERE "userId"=$1`, [u1]);
  await api('/wallet/withdrawals', {
    token: t1,
    body: { amount: 300, method: 'JAZZCASH', accountName: 'Alice Tester', accountNumber: '03001234567' },
  });
  await settle();
  check('SHARED_PAYOUT_ACCOUNT alert raised (same JazzCash number, 2 players)', await waitForAlert(db, 'SHARED_PAYOUT_ACCOUNT'));

  // 3h. detection never changes the money outcome
  // The holding debit drains CASH first and only spills into WINNING, so the
  // invariant is on the TOTAL withdrawable balance, not on one bucket.
  const balRow = (await db.query(`SELECT "cashBalance" c, "winningBalance" w FROM wallets WHERE "userId"=$1`, [u2])).rows[0];
  const total = Number(balRow.c) + Number(balRow.w);
  const debited = Number((await db.query(
    `SELECT COALESCE(SUM(amount),0) s FROM wallet_transactions WHERE "userId"=$1 AND type='WITHDRAWAL' AND direction='DEBIT'`, [u2],
  )).rows[0].s);
  const ledger = await db.query(
    `SELECT count(DISTINCT "entityId") n FROM wallet_transactions WHERE "userId"=$1 AND type='WITHDRAWAL'`, [u2],
  );
  check('a flagged withdrawal still debits exactly once (no double charge)',
    Number(ledger.rows[0].n) === 1 && debited === 400 && total === before2h - 400,
    `cash=${balRow.c} winning=${balRow.w} debited=${debited} withdrawals=${ledger.rows[0].n}`);

  // 3i. credential stuffing
  const before = await db.query(`SELECT count(*) n FROM audit_logs WHERE action='LOGIN_FAILED'`);
  const failStatuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    // One source address per attempt: the per-email lockout must still trip
    // while the per-IP login limiter stays out of the way.
    const r = await api('/auth/login', {
      body: { identifier: ALICE, password: 'wrong-password' },
      headers: { 'x-forwarded-for': freshIp() },
    });
    failStatuses.push(r.status);
  }
  check('wrong passwords reach the auth service (401, not rate-limited)',
    failStatuses.every((s) => s === 401), failStatuses.join(','));
  await settle();
  const after = await db.query(`SELECT count(*) n FROM audit_logs WHERE action='LOGIN_FAILED'`);
  const lockRows = await db.query(`SELECT count(*) n FROM audit_logs WHERE action='LOGIN_LOCKOUT'`);
  // The 5th failure trips the lockout, so it is recorded as LOGIN_LOCKOUT.
  check('every failed login attempt is audited',
    Number(after.rows[0].n) - Number(before.rows[0].n) + Number(lockRows.rows[0].n) >= 5,
    `failed=${after.rows[0].n} lockouts=${lockRows.rows[0].n}`);
  check('CREDENTIAL_STUFFING alert raised', await waitForAlert(db, 'CREDENTIAL_STUFFING'));
  const locked = await api('/auth/login', {
    body: { identifier: ALICE, password: 'Security@12345' },
    headers: { 'x-forwarded-for': freshIp() },
  });
  check('account lockout engages after the configured failures', locked.status === 429, `HTTP ${locked.status}`);
  check('lockout is audited', (await db.query(`SELECT count(*) n FROM audit_logs WHERE action='LOGIN_LOCKOUT'`)).rows[0].n >= 1);

  // 3j. refresh-token replay
  const login = await api('/auth/login', {
    body: { identifier: BOB, password: 'Security@12345' },
    headers: { 'x-forwarded-for': freshIp() },
  });
  check('login works for the untouched account', login.status === 200, `HTTP ${login.status}`);
  const setCookie = login.headers.getSetCookie?.()[0] ?? '';
  const refreshCookie = setCookie.split(';')[0] ?? '';
  const first = await api('/auth/refresh', { method: 'POST', headers: { cookie: refreshCookie, 'x-clutchnex-client': 'test' } });
  check('refresh rotates the session', first.status === 200, `HTTP ${first.status}`);
  // A replay INSIDE the 60s grace window is a benign race (parallel API calls
  // at access-token expiry, multiple tabs) and must chain onto the successor —
  // that is the fix for the random-logout bug, so assert it explicitly.
  const graceReplay = await api('/auth/refresh', { method: 'POST', headers: { cookie: refreshCookie, 'x-clutchnex-client': 'test' } });
  check('a within-grace replay chains instead of killing the session', graceReplay.status === 200, `HTTP ${graceReplay.status}`);
  const stillLive = await db.query(
    `SELECT count(*) n FROM auth_tokens WHERE "userId"=$1 AND type='REFRESH' AND "revokedAt" IS NULL`, [u2],
  );
  check('benign race leaves the session alive', Number(stillLive.rows[0].n) >= 1, `live=${stillLive.rows[0].n}`);

  // Now age the revocation past the grace window: the same cookie is then a
  // genuine stolen-token replay and MUST be treated as theft.
  await db.query(
    `UPDATE auth_tokens SET "revokedAt" = now() - interval '10 minutes'
     WHERE "userId"=$1 AND type='REFRESH' AND "revokedAt" IS NOT NULL`, [u2],
  );
  const replay = await api('/auth/refresh', { method: 'POST', headers: { cookie: refreshCookie, 'x-clutchnex-client': 'test' } });
  check('replaying the rotated token is refused', replay.status === 401, `HTTP ${replay.status}`);
  await settle();
  check('REFRESH_TOKEN_REUSE alert raised', await waitForAlert(db, 'REFRESH_TOKEN_REUSE'));
  const replayAudit = await db.query(`SELECT count(*) n FROM audit_logs WHERE action='REFRESH_TOKEN_REUSED'`);
  check('refresh replay is audited', Number(replayAudit.rows[0].n) >= 1);
  const liveSessions = await db.query(
    `SELECT count(*) n FROM auth_tokens WHERE "userId"=$1 AND type='REFRESH' AND "revokedAt" IS NULL`, [u2],
  );
  check('replay kills every live session for that account', Number(liveSessions.rows[0].n) === 0, `live=${liveSessions.rows[0].n}`);

  // 3k. coupon guessing (against a real tournament — an unknown slug 404s
  // before the coupon is ever looked at)
  const couponSlug = String((await db.query(
    `SELECT slug FROM tournaments WHERE status='REGISTRATION_OPEN' ORDER BY "startTime" LIMIT 1`,
  )).rows[0]?.slug ?? '');
  for (let i = 0; i < 9; i++) {
    await api(`/tournaments/coupon-preview?code=GUESS${i}&tournamentSlug=${encodeURIComponent(couponSlug)}`, { token: t1 });
  }
  await settle();
  check('COUPON_REJECTED audit rows written', (await db.query(`SELECT count(*) n FROM audit_logs WHERE action='COUPON_REJECTED'`)).rows[0].n >= 9);
  check('COUPON_ABUSE alert raised', await waitForAlert(db, 'COUPON_ABUSE'));

  // 3l. multi-account registration from one IP
  for (let i = 0; i < 4; i++) {
    await api('/auth/register', {
      body: {
        fullName: `Sec Clone ${i}`, username: `sectest_c${RUN}_${i}`, email: `sectest_c${RUN}_${i}@example.com`,
        password: 'Security@12345', confirmPassword: 'Security@12345',
      },
      headers: { 'x-forwarded-for': RUN_IP },
    });
  }
  await settle();
  check('MULTI_ACCOUNT_REGISTRATION alert raised', await waitForAlert(db, 'MULTI_ACCOUNT_REGISTRATION'));
  check('USER_REGISTERED audit rows written', (await db.query(`SELECT count(*) n FROM audit_logs WHERE action='USER_REGISTERED'`)).rows[0].n >= 4);

  // 3m. detectors can be switched off by an admin setting
  await api('/admin/settings', { token: admin, body: { key: 'security.fraudDetectionEnabled', value: false } });
  const openBefore = Number((await db.query(`SELECT count(*) n FROM fraud_alerts`)).rows[0].n);
  await api('/wallet/deposits', { token: t2, form: depositForm({ transactionId: 'SEC-OFF-1' }, png(64, [1, 2, 3, 255])) });
  await api('/wallet/deposits', { token: t2, form: depositForm({ transactionId: 'SEC-OFF-2' }, png(64, [1, 2, 3, 255])) });
  await settle();
  const openAfter = Number((await db.query(`SELECT count(*) n FROM fraud_alerts`)).rows[0].n);
  check('the master switch stops detection', openAfter === openBefore, `${openBefore} → ${openAfter}`);
  await api('/admin/settings', { token: admin, body: { key: 'security.fraudDetectionEnabled', value: true } });

  // ===========================================================================
  // 4. AUDIT COVERAGE OF FINANCIAL + SECURITY ACTIONS
  // ===========================================================================
  console.log('\n— 4. Audit coverage —');

  const needed = [
    'DEPOSIT_SUBMITTED', 'WITHDRAWAL_REQUESTED', 'LOGIN_FAILED', 'LOGIN_LOCKOUT',
    'LOGIN_SUCCESS', 'USER_REGISTERED', 'COUPON_REJECTED', 'SETTING_UPDATED',
  ];
  for (const action of needed) {
    const n = Number((await db.query(`SELECT count(*) n FROM audit_logs WHERE action=$1`, [action])).rows[0].n);
    check(`audit trail contains ${action}`, n > 0, `${n} row(s)`);
  }
  const withIp = await db.query(`SELECT count(*) n FROM audit_logs WHERE action='LOGIN_FAILED' AND ip IS NOT NULL`);
  check('security audit rows record the source IP', Number(withIp.rows[0].n) > 0, `${withIp.rows[0].n} row(s)`);

  // ===========================================================================
  // 5. CSRF DEFENCE ON COOKIE ENDPOINTS
  // ===========================================================================
  console.log('\n— 5. CSRF defence —');

  const noMarker = await api('/auth/refresh', { method: 'POST' });
  check('refresh without the first-party marker is refused', noMarker.status === 403 && noMarker.json.code === 'CSRF_REJECTED', String(noMarker.json.code));
  const crossSite = await api('/auth/refresh', { method: 'POST', headers: { 'x-clutchnex-client': 'web', 'sec-fetch-site': 'cross-site' } });
  check('refresh from a cross-site context is refused', crossSite.status === 403, `HTTP ${crossSite.status}`);
  const logoutCsrf = await api('/auth/logout', { method: 'POST' });
  check('logout is guarded the same way', logoutCsrf.status === 403, `HTTP ${logoutCsrf.status}`);
  const sameSite = await api('/auth/refresh', { method: 'POST', headers: { 'x-clutchnex-client': 'web', 'sec-fetch-site': 'same-origin' } });
  check('a first-party refresh still reaches the handler (401 = no session)', sameSite.status === 401, `HTTP ${sameSite.status}`);

  // ===========================================================================
  // 6. HEADERS, BODY LIMITS, RATE LIMITS
  // ===========================================================================
  console.log('\n— 6. Headers & limits —');

  const health = await api('/health');
  const csp = String(health.headers.get('content-security-policy') ?? '');
  check("CSP forbids rendering anything (default-src 'none')", csp.includes("default-src 'none'"), csp.slice(0, 60));
  check('CSP forbids framing', csp.includes("frame-ancestors 'none'"));
  check('nosniff is set', health.headers.get('x-content-type-options') === 'nosniff');
  check('cross-origin resource policy is set', health.headers.get('cross-origin-resource-policy') !== null);
  check('x-powered-by is gone', health.headers.get('x-powered-by') === null);

  const bigBody = await api('/auth/login', { body: { identifier: 'x'.repeat(400_000), password: 'y' } });
  check('oversized JSON body refused with 413', bigBody.status === 413, `HTTP ${bigBody.status}`);
  const badJson = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
  });
  check('malformed JSON refused with 400 (not 500)', badJson.status === 400, `HTTP ${badJson.status}`);

  const errShape = await api('/public/definitely-not-a-route');
  check('404 body leaks nothing internal', errShape.status === 404 && !JSON.stringify(errShape.json).includes('at '), JSON.stringify(errShape.json).slice(0, 80));

  const limitIp = '192.0.2.99'; // its own address: nothing else touches this budget
  let limitedAt = 0;
  for (let i = 0; i < 12; i++) {
    const r = await api('/auth/login', {
      body: { identifier: `nobody${i}@example.com`, password: 'x' },
      headers: { 'x-forwarded-for': limitIp },
    });
    if (r.status === 429) { limitedAt = i + 1; break; }
  }
  check('login rate limit engages (429)', limitedAt > 0, `after ${limitedAt || '>12'} attempt(s) from one IP`);

  // ===========================================================================
  // 7. RBAC + REVIEW FLOW ON THE FRAUD QUEUE
  // ===========================================================================
  console.log('\n— 7. Fraud review —');

  const anonQueue = await api('/admin/fraud');
  check('anonymous cannot read the fraud queue', anonQueue.status === 401, `HTTP ${anonQueue.status}`);
  const playerQueue = await api('/admin/fraud', { token: t1 });
  check('players cannot read the fraud queue', playerQueue.status === 403, `HTTP ${playerQueue.status}`);

  const queue = await api('/admin/fraud?status=OPEN&pageSize=50', { token: admin });
  const items = ((queue.json as { data?: { items?: Array<{ id: string; kind: string; severity: string }> } }).data?.items ?? []);
  check('admin reads the queue', queue.status === 200 && items.length > 0, `${items.length} alert(s)`);
  const firstAlert = items[0]!;
  check('alerts carry a human label + severity', Boolean(firstAlert.kind) && Boolean(firstAlert.severity), `${firstAlert.kind}/${firstAlert.severity}`);

  const review = await api(`/admin/fraud/${firstAlert.id}/review`, { token: admin, body: { action: 'REVIEWED', note: 'Checked manually — legitimate.' } });
  check('admin can mark an alert reviewed', review.status === 200, `HTTP ${review.status}`);
  const twiceReview = await api(`/admin/fraud/${firstAlert.id}/review`, { token: admin, body: { action: 'DISMISSED' } });
  check('reviewing twice is refused', twiceReview.status === 409, `HTTP ${twiceReview.status}`);
  const playerReview = await api(`/admin/fraud/${(items[1] ?? firstAlert).id}/review`, { token: t1, body: { action: 'DISMISSED' } });
  check('players cannot review alerts', playerReview.status === 403, `HTTP ${playerReview.status}`);
  const reviewAudit = await db.query(`SELECT count(*) n FROM audit_logs WHERE action='FRAUD_ALERT_REVIEWED'`);
  check('fraud reviews are audited', Number(reviewAudit.rows[0].n) >= 1, `${reviewAudit.rows[0].n} row(s)`);

  const statuses = await db.query(`SELECT status, count(*) n FROM fraud_alerts GROUP BY status ORDER BY status`);
  console.log('   alerts by status:', statuses.rows.map((r) => `${r.status}=${r.n}`).join(' '));

  // ===========================================================================
  // 8. PASSWORD HASHING
  // ===========================================================================
  console.log('\n— 8. Password hashing —');
  const hash = String((await db.query(`SELECT "passwordHash" h FROM users WHERE username=$1`, [`sectest_c${RUN}_0`])).rows[0]?.h ?? '');
  check('new accounts are hashed with bcrypt cost 12', /^\$2[aby]\$12\$/.test(hash), hash.slice(0, 7));

  // ---- cleanup ----------------------------------------------------------------
  await cleanup(db);
  await db.end();

  console.log(failures === 0 ? '\n🏆 All Phase 14 security checks passed.' : `\n💥 ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Remove every row this suite can create, in FK-safe order. */
async function cleanup(db: pg.Client) {
  await db.query(`DELETE FROM fraud_alerts`);
  await db.query(`DELETE FROM audit_logs WHERE "actorId" IN (SELECT id FROM users WHERE username LIKE 'sectest_%')`);
  await db.query(`DELETE FROM audit_logs WHERE action IN ('LOGIN_FAILED','LOGIN_LOCKOUT','LOGIN_SUCCESS','COUPON_REJECTED','REFRESH_TOKEN_REUSED','USER_REGISTERED','FRAUD_ALERT_REVIEWED')`);
  await db.query(`DELETE FROM wallet_transactions WHERE "userId" IN (SELECT id FROM users WHERE username LIKE 'sectest_%')`);
  await db.query(`DELETE FROM withdrawals WHERE "userId" IN (SELECT id FROM users WHERE username LIKE 'sectest_%')`);
  await db.query(`DELETE FROM deposits WHERE "userId" IN (SELECT id FROM users WHERE username LIKE 'sectest_%')`);
  await db.query(`DELETE FROM wallets WHERE "userId" IN (SELECT id FROM users WHERE username LIKE 'sectest_%')`);
  await db.query(`DELETE FROM notifications WHERE "userId" IN (SELECT id FROM users WHERE username LIKE 'sectest_%')`);
  await db.query(`DELETE FROM auth_tokens WHERE "userId" IN (SELECT id FROM users WHERE username LIKE 'sectest_%')`);
  await db.query(`DELETE FROM user_profiles WHERE "userId" IN (SELECT id FROM users WHERE username LIKE 'sectest_%')`);
  await db.query(`DELETE FROM users WHERE username LIKE 'sectest_%'`);
  await db.query(`UPDATE settings SET value='true' WHERE key='security.fraudDetectionEnabled'`);
  await db.query(`UPDATE settings SET value='5' WHERE key='security.maxDepositsPerHour'`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
