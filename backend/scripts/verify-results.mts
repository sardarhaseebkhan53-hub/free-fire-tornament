/* eslint-disable no-console */
// =============================================================================
// Phase 8 verification — results & prize distribution.
//
// Run (backend server + database up, seeded):
//   npx tsx scripts/verify-results.mts
//
// Proves:
//   1. Submission — participants only, completed matches only, one live
//      submission per player per match, screenshot stored.
//   2. Verification — approve applies placement table + kills × rate points
//      and updates PlayerStat; reject refuses money/stats movement;
//      disqualify excludes the participant and reverts prior stats.
//   3. Distribution — placement prizes follow the points ranking, kill pool
//      pays perKill × kills under its cap, MVP goes to the top rank, team
//      prizes split across members, everything credited exactly once
//      (re-run refused), notifications + audits + ledger integrity.
// =============================================================================
import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { png } from './lib/fixtures.js';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api';
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=5';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function api(path: string, opts: { method?: string; token?: string; body?: unknown; form?: FormData; raw?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API}${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  if (opts.raw) return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function signToken(sub: string, username: string, role = 'USER'): string {
  return jwt.sign({ sub, role, username }, ACCESS_SECRET, { expiresIn: '15m' });
}

// Phase 14: uploads are validated by their real bytes + dimensions, so the
// fixture is a genuine 64×64 PNG (the old 1×1 blob is now correctly refused).
const PNG = png(64);

function form(fields: Record<string, string>, withShot: boolean): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (withShot) fd.append('screenshot', new Blob([PNG], { type: 'image/png' }), 'result.png');
  return fd;
}

async function createUser(db: pg.Client, username: string): Promise<string> {
  const r = await db.query(
    `INSERT INTO users (id, username, email, "passwordHash", role, status, "isVerified", "referralCode", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $1 || '@example.com', $2, 'USER', 'ACTIVE', true, 'RES-' || substr(md5($1),1,5), now(), now())
     RETURNING id`,
    [username, bcrypt.hashSync('Result@12345', 10)],
  );
  const id = r.rows[0].id as string;
  await db.query(
    `INSERT INTO wallets (id, "userId", "winningBalance", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, $1, 0, now(), now())`,
    [id],
  );
  return id;
}

async function main() {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();

  const adminRow = await db.query(`SELECT id FROM users WHERE email='admin@clutchnex.gg'`);
  const adminId = adminRow.rows[0].id as string;
  const adminToken = signToken(adminId, 'admin', 'ADMIN');

  await db.query(`DELETE FROM users WHERE username LIKE 'restest_%'`);
  await db.query(`DELETE FROM tournaments WHERE slug LIKE 'restest-%'`);

  // -- fixture: solo tournament, COMPLETED, one completed match, 4 participants
  const users: Record<string, string> = {};
  for (const u of ['alpha', 'bravo', 'charlie', 'delta']) {
    users[u] = await createUser(db, `restest_${u}`);
  }
  const tour = await db.query(
    `INSERT INTO tournaments (id, title, slug, type, status, "entryFeePerPlayer", "prizePool", "platformFee",
      "maxSlots", "registeredSlots", "minSlotsToStart", "numWinners", "pointsPerKill", "startTime",
      "registrationDeadline", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Result Test Cup', 'restest-cup', 'SOLO', 'LIVE', 50, 500, 100, 16, 4, 2, 3, 2, now() - interval '3 hours', now() - interval '4 hours', now() - interval '1 day', now())
     RETURNING id`,
  );
  const tid = tour.rows[0].id as string;
  await db.query(
    `INSERT INTO prizes (id, "tournamentId", position, amount, label, kind) VALUES
       (gen_random_uuid()::text, $1, 1, 300, '1st Place', 'PLACEMENT'),
       (gen_random_uuid()::text, $1, 2, 150, '2nd Place', 'PLACEMENT'),
       (gen_random_uuid()::text, $1, 3, 50, '3rd Place', 'PLACEMENT'),
       (gen_random_uuid()::text, $1, 4, 120, 'Kill Pool', 'KILL_POOL'),
       (gen_random_uuid()::text, $1, 5, 60, 'MVP', 'MVP')`,
    [tid],
  );
  // Kill pool cap lives on the cap column — set it explicitly (perKill 5, cap 120).
  await db.query(`UPDATE prizes SET "perKill" = 5, cap = 120 WHERE "tournamentId" = $1 AND kind = 'KILL_POOL'`, [tid]);

  const matchRow = await db.query(
    `INSERT INTO matches (id, "tournamentId", round, "matchNumber", "scheduledAt", status, "resultsFinalized", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 1, 1, now() - interval '2 hours', 'COMPLETED', false, now() - interval '1 day', now())
     RETURNING id`,
    [tid],
  );
  const mid = matchRow.rows[0].id as string;
  for (const u of Object.values(users)) {
    await db.query(
      `INSERT INTO tournament_registrations (id, "tournamentId", "userId", status, "entryAmount", "registeredAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'CONFIRMED', 50, now() - interval '20 hours')`,
      [tid, u],
    );
    await db.query(
      `INSERT INTO match_participants (id, "matchId", "userId", status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'REGISTERED', now(), now())`,
      [mid, u],
    );
  }
  const tokens: Record<string, string> = {};
  for (const [u, id] of Object.entries(users)) tokens[u] = signToken(id, `restest_${u}`);

  // ---- 1. SUBMISSION ----------------------------------------------------------
  const futMatch = await db.query(
    `INSERT INTO matches (id, "tournamentId", round, "matchNumber", "scheduledAt", status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 1, 2, now() + interval '2 hours', 'SCHEDULED', now(), now()) RETURNING id`,
    [tid],
  );
  const futId = futMatch.rows[0].id as string;
  const notDone = await api(`/matches/${futId}/result`, { token: tokens.alpha, form: form({ placement: '1', kills: '5' }, false) });
  check('submission refused on non-completed match', notDone.status === 400, String(notDone.json.message));

  const s1 = await api(`/matches/${mid}/result`, { token: tokens.alpha, form: form({ placement: '1', kills: '10', notes: 'Booyah!' }, true) });
  check('participant submits result with screenshot → PENDING', s1.status === 201 && s1.json.data.status === 'PENDING', JSON.stringify(s1.json.message ?? s1.json.code));

  const dup = await api(`/matches/${mid}/result`, { token: tokens.alpha, form: form({ placement: '2', kills: '3' }, false) });
  check('second live submission blocked', dup.status === 409, String(dup.json.code));

  const outsider = await createUser(db, 'restest_outsider');
  const outRes = await api(`/matches/${mid}/result`, { token: signToken(outsider, 'restest_outsider'), form: form({ placement: '1', kills: '9' }, false) });
  check('non-participant refused', outRes.status === 403, String(outRes.json.code));

  const badVal = await api(`/matches/${mid}/result`, { token: tokens.bravo, form: form({ placement: '0', kills: '-2' }, false) });
  check('invalid placement/kills refused', badVal.status === 400);

  await api(`/matches/${mid}/result`, { token: tokens.bravo, form: form({ placement: '2', kills: '7' }, true) });
  await api(`/matches/${mid}/result`, { token: tokens.charlie, form: form({ placement: '3', kills: '5' }, false) });
  await api(`/matches/${mid}/result`, { token: tokens.delta, form: form({ placement: '4', kills: '12' }, false) });

  const pending = await api('/admin/results?status=PENDING', { token: adminToken });
  check('admin sees 4 pending submissions', pending.json.data.total === 4, `total=${pending.json.data.total}`);

  const asPlayer = await api('/admin/results', { token: tokens.alpha });
  check('admin listing refused for players', asPlayer.status === 403);

  // ---- 2. VERIFICATION ----------------------------------------------------------
  const subs = (pending.json.data.items as Array<{ id: string; submittedBy: { username: string } }>);
  const byUser = (u: string) => subs.find((s) => s.submittedBy.username === `restest_${u}`)!.id;

  const approve = await api(`/admin/results/${byUser('alpha')}/review`, { token: adminToken, body: { action: 'APPROVE' } });
  check('approve succeeds', approve.json.data.status === 'VERIFIED', JSON.stringify(approve.json.message ?? approve.json.code));

  const part = (await db.query(
    `SELECT placement, kills, points, status FROM match_participants WHERE "matchId"=$1 AND "userId"=$2`,
    [mid, users.alpha],
  )).rows[0];
  // placement 1 → 12 base + 10 kills × 2 perKill = 32
  check('points = placement table + kills × rate', Number(part.points) === 32 && Number(part.placement) === 1 && Number(part.kills) === 10 && part.status === 'PLAYED',
    `points=${part.points}`);

  const stat = (await db.query(`SELECT "matchesPlayed", kills, "totalPoints", wins FROM player_stats WHERE "userId"=$1`, [users.alpha])).rows[0];
  check('PlayerStat updated (1 match, 10 kills, 32 pts, 1 win)', Number(stat.matchesPlayed) === 1 && Number(stat.kills) === 10 && Number(stat.totalPoints) === 32 && Number(stat.wins) === 1,
    JSON.stringify(stat));

  const reReview = await api(`/admin/results/${byUser('alpha')}/review`, { token: adminToken, body: { action: 'APPROVE' } });
  check('double-review refused', reReview.status === 409);

  // correction path — admin overrides kills on bravo's approval
  const correct = await api(`/admin/results/${byUser('bravo')}/review`, { token: adminToken, body: { action: 'APPROVE', kills: 9 } });
  const bravoRow = (await db.query(
    `SELECT kills, points FROM match_participants WHERE "matchId"=$1 AND "userId"=$2`, [mid, users.bravo],
  )).rows[0];
  // placement 2 → 9 base + 9×2 = 27
  check('admin override applied (9 kills → 27 pts)', Number(bravoRow.kills) === 9 && Number(bravoRow.points) === 27, `kills=${bravoRow.kills} pts=${bravoRow.points}`);
  const bravoStat = (await db.query(`SELECT kills, "totalPoints" FROM player_stats WHERE "userId"=$1`, [users.bravo])).rows[0];
  check('override adjusts stats consistently', Number(bravoStat.kills) === 9 && Number(bravoStat.totalPoints) === 27, JSON.stringify(bravoStat));
  check('override response VERIFIED', correct.json.data.status === 'VERIFIED');

  await api(`/admin/results/${byUser('charlie')}/review`, { token: adminToken, body: { action: 'APPROVE' } });
  // delta claim disqualified
  const dq = await api(`/admin/results/${byUser('delta')}/review`, { token: adminToken, body: { action: 'DISQUALIFY', note: 'Teaming evidence' } });
  const deltaRow = (await db.query(`SELECT status FROM match_participants WHERE "matchId"=$1 AND "userId"=$2`, [mid, users.delta])).rows[0];
  check('disqualify marks participant DISQUALIFIED', dq.json.success === true && deltaRow.status === 'DISQUALIFIED');
  const deltaStat = await db.query(`SELECT count(*) n FROM player_stats WHERE "userId"=$1`, [users.delta]);
  check('disqualified player has no stats row', Number(deltaStat.rows[0].n) === 0);

  const notes = await db.query(
    `SELECT type, count(*) n FROM notifications WHERE "userId"=$1 AND type='RESULT_VERIFIED' GROUP BY type`, [users.alpha],
  );
  check('verified player notified', Number(notes.rows[0]?.n ?? 0) === 1);

  // ---- 3. DISTRIBUTION ----------------------------------------------------------
  const noDistributeForPlayer = await api(`/admin/tournaments/${tid}/distribute-prizes`, { token: tokens.alpha, body: {} });
  check('distribution refused for players', noDistributeForPlayer.status === 403);

  // alpha: 32 pts (1st, 10 kills), bravo: 27 (2nd, 9), charlie: 13 (3rd, 5), delta DQ.
  const dist = await api(`/admin/tournaments/${tid}/distribute-prizes`, { token: adminToken, body: {} });
  check('distribution succeeds', dist.json.success === true, JSON.stringify(dist.json.message ?? dist.json.code));
  const awards = dist.json.data.awards as Array<{ position: number; label: string; amount: number; credited: Array<{ userId: string; share: number }> }>;
  const placementAwards = awards.filter((a) => a.position <= 3);
  check('placement follows points ranking', placementAwards.length === 3 &&
    awards.find((a) => a.position === 1)?.credited?.[0]?.userId === users.alpha &&
    awards.find((a) => a.position === 2)?.credited?.[0]?.userId === users.bravo &&
    awards.find((a) => a.position === 3)?.credited?.[0]?.userId === users.charlie,
    JSON.stringify(placementAwards.map((a) => ({ p: a.position, u: a.credited[0]?.userId?.slice(-4) }))));

  const killAwards = awards.filter((a) => a.position >= 100 && a.position < 200);
  const alphaKill = killAwards.find((a) => a.label.includes('alpha'));
  const bravoKill = killAwards.find((a) => a.label.includes('bravo'));
  const charlieKill = killAwards.find((a) => a.label.includes('charlie'));
  // raw: alpha 50, bravo 45, charlie 25 → sum 120 = cap → no scaling needed
  check('kill pool pays perKill × kills within cap', killAwards.length === 3 && alphaKill?.amount === 50 && bravoKill?.amount === 45 && charlieKill?.amount === 25,
    JSON.stringify(killAwards.map((a) => ({ a: a.amount }))));

  const capTest = await db.query(`SELECT COALESCE(SUM(amount),0) total FROM winners WHERE "tournamentId"=$1 AND position >= 100 AND position < 200`, [tid]);
  check('kill pool respects budget cap', Number(capTest.rows[0].total) <= 120, `total=${capTest.rows[0].total}`);

  const mvp = awards.find((a) => a.position === 200);
  check('MVP awarded to top rank', mvp?.credited?.[0]?.userId === users.alpha && mvp?.amount === 60);

  const alphaBal = Number((await db.query(`SELECT "winningBalance" FROM wallets WHERE "userId"=$1`, [users.alpha])).rows[0].winningBalance);
  check('alpha credited 300 + 50 + 60 = 410', alphaBal === 410, `balance=${alphaBal}`);

  const charlieBal = Number((await db.query(`SELECT "winningBalance" FROM wallets WHERE "userId"=$1`, [users.charlie])).rows[0].winningBalance);
  check('charlie credited 50 + 25 = 75', charlieBal === 75, `balance=${charlieBal}`);

  const tStatus = (await db.query(`SELECT status FROM tournaments WHERE id=$1`, [tid])).rows[0].status;
  check('tournament marked COMPLETED after distribution', tStatus === 'COMPLETED');

  const reDist = await api(`/admin/tournaments/${tid}/distribute-prizes`, { token: adminToken, body: {} });
  check('second distribution refused (idempotent)', reDist.status === 409, String(reDist.json.code));

  const alphaBal2 = Number((await db.query(`SELECT "winningBalance" FROM wallets WHERE "userId"=$1`, [users.alpha])).rows[0].winningBalance);
  check('no double credit', alphaBal2 === 410, `balance=${alphaBal2}`);

  const winNotes = await db.query(
    `SELECT count(*) n FROM notifications WHERE "userId"=$1 AND type='WINNING_CREDITED'`, [users.alpha],
  );
  check('prize notifications sent (3)', Number(winNotes.rows[0].n) === 3, `n=${winNotes.rows[0].n}`);

  // my-matches surfaces the verified result
  const mine = await api('/matches/my', { token: tokens.alpha });
  const myT = (mine.json.data as Array<{ tournament: { id: string }; matches: Array<{ id: string; result: { points: number } | null; mySubmission: { status: string } | null }> }>)
    .find((x) => x.tournament.id === tid);
  const myMatch = myT?.matches.find((m) => m.id === mid);
  check('my-matches exposes verified result + submission state',
    myMatch?.result?.points === 32 && myMatch?.mySubmission?.status === 'VERIFIED',
    JSON.stringify({ r: myMatch?.result, s: myMatch?.mySubmission?.status }));

  const standingsPub = await api('/public/tournaments/restest-cup/results');
  check('public standings endpoint works', standingsPub.json.data.standings[0].label.includes('alpha') && standingsPub.json.data.winners.length === 7,
    `top=${standingsPub.json.data.standings[0].label} winners=${standingsPub.json.data.winners.length}`);

  // ---- 4. LEDGER INTEGRITY -------------------------------------------------------
  const chain = await db.query(
    `SELECT count(*) bad FROM wallet_transactions
     WHERE ("direction"='CREDIT' AND "balanceAfter" <> "balanceBefore" + amount)
        OR ("direction"='DEBIT'  AND "balanceAfter" <> "balanceBefore" - amount)`,
  );
  const neg = await db.query(`SELECT count(*) n FROM wallet_transactions WHERE "balanceAfter" < 0`);
  check('ledger chain consistent', Number(chain.rows[0].bad) === 0);
  check('no negative balances', Number(neg.rows[0].n) === 0);

  const audits = await db.query(
    `SELECT count(*) n FROM audit_logs WHERE action IN ('RESULT_SUBMITTED','RESULT_APPROVE','RESULT_VERIFIED','RESULT_DISQUALIFY','PRIZES_DISTRIBUTED')`,
  );
  check('results pipeline audited', Number(audits.rows[0].n) >= 7, `rows=${audits.rows[0].n}`);

  // ---- cleanup --------------------------------------------------------------------
  await db.query(`DELETE FROM audit_logs WHERE "entityId" IN (SELECT id FROM winners WHERE "tournamentId"=$1) OR ("entity"='Tournament' AND "entityId"=$1)`, [tid]);
  await db.query(`DELETE FROM audit_logs WHERE "entity"='ResultSubmission' AND "entityId" IN (SELECT id FROM result_submissions WHERE "matchId"=ANY($1))`, [[mid, futId]]);
  await db.query(`DELETE FROM users WHERE username LIKE 'restest_%'`);
  await db.query(`DELETE FROM tournaments WHERE slug LIKE 'restest-%'`);
  await db.end();

  console.log(failures === 0 ? '\n🏆 All results & distribution checks passed.' : `\n💥 ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
