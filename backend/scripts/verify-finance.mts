/* eslint-disable no-console */
// =============================================================================
// Phase 10 verification — financial dashboard.
//
// Run (backend server + database up, seeded):
//   npx tsx scripts/verify-finance.mts
//
// Proves:
//   1. The P&L math: platformGross = entries − refunds − prizes and
//      netRevenue = platformGross − payment costs − referral/bonus costs,
//      every figure recomputed straight from the tables via SQL.
//   2. Deposits are NEVER revenue: a new approved deposit changes
//      depositsApproved but changes no profit line by a single rupee.
//   3. Payment costs flow end-to-end: a freshly inserted PAYMENT_COST expense
//      raises paymentCosts and lowers netRevenue by exactly that amount.
//   4. Bucket reconciliation: daily/weekly/monthly and 30/60/90-day series
//      sums equal the window totals to the rupee.
//   5. Per-tournament P&L matches a direct SQL recomputation.
//   6. CSV export: correct content type and Summary/Series/P&L sections.
//   7. RBAC: USER tokens are refused (403).
// =============================================================================
import 'dotenv/config';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api';
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=5';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me';

import { ensureAdmin, ensureUser } from './lib/staff';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}
const near = (a: number, b: number, eps = 0.51) => Math.abs(a - b) < eps;

async function api(path: string, token?: string) {
  const res = await fetch(`${API}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function signToken(sub: string, username: string, role = 'USER'): string {
  return jwt.sign({ sub, role, username }, ACCESS_SECRET, { expiresIn: '15m' });
}

interface Totals {
  grossEntryCollection: number; refunds: number; prizesDistributed: number;
  paymentCosts: number; referralBonusCosts: number; platformGross: number;
  netRevenue: number; depositsApproved: number; withdrawalsPaid: number; registrations: number;
}

const sqlTotals = async (db: pg.Client, days: number) => {
  const r = await db.query(
    `SELECT
      (SELECT COALESCE(SUM("entryAmount"),0) FROM tournament_registrations WHERE status='CONFIRMED' AND "registeredAt" >= now() - ($1 || ' days')::interval) AS entries,
      (SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE type='ENTRY_REFUND' AND direction='CREDIT' AND "createdAt" >= now() - ($1 || ' days')::interval) AS refunds,
      (SELECT COALESCE(SUM(amount),0) FROM winners WHERE status='CREDITED' AND "creditedAt" >= now() - ($1 || ' days')::interval) AS prizes,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE category='PAYMENT_COST' AND "occurredAt" >= now() - ($1 || ' days')::interval) AS payment_costs,
      (SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE type IN ('REFERRAL_REWARD','BONUS_CREDIT') AND direction='CREDIT' AND "createdAt" >= now() - ($1 || ' days')::interval) AS referral_bonus,
      (SELECT COALESCE(SUM(amount),0) FROM deposits WHERE status='APPROVED' AND "reviewedAt" >= now() - ($1 || ' days')::interval) AS deposits,
      (SELECT COALESCE(SUM(amount),0) FROM withdrawals WHERE status='PAID' AND "reviewedAt" >= now() - ($1 || ' days')::interval) AS withdrawals`,
    [String(days)],
  );
  const row = r.rows[0];
  const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
  return {
    entries: num(row.entries), refunds: num(row.refunds), prizes: num(row.prizes),
    payment_costs: num(row.payment_costs), referral_bonus: num(row.referral_bonus),
    deposits: num(row.deposits), withdrawals: num(row.withdrawals),
  };
};

async function main() {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();

  const adminActor = await ensureAdmin(db);
  const userActor = await ensureUser(db, 'verify_finance_user');
  const admin = signToken(adminActor.id, adminActor.username, adminActor.role);
  const user = signToken(userActor.id, userActor.username, userActor.role);

  // ---- 1. Access & RBAC ------------------------------------------------------------
  const denied = await api('/admin/finance', user);
  check('USER token refused on /admin/finance', denied.status === 403);
  const anon = await api('/admin/finance');
  check('anonymous refused on /admin/finance', anon.status === 401);

  const r30 = await api('/admin/finance?days=30&granularity=day', admin);
  check('admin can load the financial dashboard', r30.status === 200 && (r30.json.success as boolean) === true);
  const data = r30.json.data as { totals: Totals; series: Array<Record<string, number | string>>; tournaments: Array<Record<string, string | number>> };
  check('dashboard has totals, series and tournament P&L',
    !!data.totals && Array.isArray(data.series) && data.series.length > 0 && Array.isArray(data.tournaments) && data.tournaments.length > 0);

  // ---- 2. P&L math vs a direct SQL recomputation (30d) ------------------------------
  const truth = await sqlTotals(db, 30);
  const t = data.totals;
  check('gross entry collection matches SQL truth', near(t.grossEntryCollection, truth.entries), `${t.grossEntryCollection} vs ${truth.entries}`);
  check('refunds match SQL truth', near(t.refunds, truth.refunds));
  check('prizes distributed match SQL truth', near(t.prizesDistributed, truth.prizes));
  check('payment costs match SQL truth', near(t.paymentCosts, truth.payment_costs));
  check('referral & bonus costs match SQL truth', near(t.referralBonusCosts, truth.referral_bonus));
  check('deposits approved reported (player funds)', near(t.depositsApproved, truth.deposits));
  check('withdrawals paid reported (player funds)', near(t.withdrawalsPaid, truth.withdrawals));

  check('platformGross = collection − refunds − prizes',
    near(t.platformGross, t.grossEntryCollection - t.refunds - t.prizesDistributed),
    `${t.platformGross}`);
  check('netRevenue = platformGross − payment − referral/bonus costs',
    near(t.netRevenue, t.platformGross - t.paymentCosts - t.referralBonusCosts),
    `${t.netRevenue}`);
  check('deposits never in revenue',
    near(t.netRevenue, t.grossEntryCollection - t.refunds - t.prizesDistributed - t.paymentCosts - t.referralBonusCosts)
    && !near(t.netRevenue, t.grossEntryCollection + t.depositsApproved - t.refunds - t.prizesDistributed - t.paymentCosts - t.referralBonusCosts));

  // ---- 3. Payment costs flow end-to-end ---------------------------------------------
  const probe = 77.77;
  await db.query(`INSERT INTO expenses (id, category, amount, note, "occurredAt") VALUES ('verify-finance-probe', 'PAYMENT_COST', $1, 'verify-finance probe', now())`, [probe]);
  const after = (await api('/admin/finance?days=30&granularity=day', admin)).json.data as { totals: Totals };
  check('new PAYMENT_COST expense raises payment costs by exactly its amount', near(after.totals.paymentCosts - t.paymentCosts, probe));
  check('new expense lowers net revenue by exactly its amount', near(t.netRevenue - after.totals.netRevenue, probe));
  await db.query(`DELETE FROM expenses WHERE id='verify-finance-probe'`);
  const restored = (await api('/admin/finance?days=30&granularity=day', admin)).json.data as { totals: Totals };
  check('probe cleanup restores the numbers', near(restored.totals.paymentCosts, t.paymentCosts));

  // ---- 4. Deposits change player funds, never profit ---------------------------------
  await db.query(`UPDATE deposits SET status='APPROVED', "reviewedAt"=now() WHERE id = (SELECT id FROM deposits WHERE status='PENDING' LIMIT 1)`);
  const afterDep = (await api('/admin/finance?days=30&granularity=day', admin)).json.data as { totals: Totals };
  check('approving a deposit changes depositsApproved', !near(afterDep.totals.depositsApproved, t.depositsApproved),
    `${t.depositsApproved} → ${afterDep.totals.depositsApproved}`);
  check('approving a deposit changes NO profit line',
    near(afterDep.totals.netRevenue, t.netRevenue) && near(afterDep.totals.platformGross, t.platformGross)
    && near(afterDep.totals.grossEntryCollection, t.grossEntryCollection));

  // ---- 5. Series reconciliation: buckets == totals -----------------------------------
  for (const gran of ['day', 'week', 'month'] as const) {
    for (const days of [30, 60, 90] as const) {
      const page = (await api(`/admin/finance?days=${days}&granularity=${gran}`, admin)).json.data as { totals: Totals; series: Array<{ entries: number; refunds: number; prizes: number; paymentCosts: number; referralBonusCosts: number; net: number }> };
      const sum = (k: 'entries' | 'refunds' | 'prizes' | 'paymentCosts' | 'referralBonusCosts' | 'net') =>
        Math.round(page.series.reduce((acc, s) => acc + Number(s[k]), 0) * 100) / 100;
      check(`${days}d/${gran} series reconciles with totals`,
        near(sum('entries'), page.totals.grossEntryCollection) && near(sum('refunds'), page.totals.refunds)
        && near(sum('prizes'), page.totals.prizesDistributed) && near(sum('paymentCosts'), page.totals.paymentCosts)
        && near(sum('referralBonusCosts'), page.totals.referralBonusCosts) && near(sum('net'), page.totals.netRevenue),
        `entries Σ${sum('entries')} vs ${page.totals.grossEntryCollection}, net Σ${sum('net')} vs ${page.totals.netRevenue}`);
    }
  }

  // ---- 6. Per-tournament P&L vs SQL ----------------------------------------------------
  const top = data.tournaments[0];
  const tp = await db.query(
    `SELECT t.title,
      COALESCE((SELECT SUM(r."entryAmount") FROM tournament_registrations r WHERE r."tournamentId"=t.id AND r.status='CONFIRMED'),0) AS collected,
      COALESCE((SELECT SUM(wt.amount) FROM wallet_transactions wt JOIN tournament_registrations r2 ON wt."entityId"=r2.id
        WHERE wt.type='ENTRY_REFUND' AND wt."entityType"='TournamentRegistration' AND r2."tournamentId"=t.id),0) AS refunded,
      COALESCE((SELECT SUM(w.amount) FROM winners w WHERE w."tournamentId"=t.id AND w.status='CREDITED'),0) AS prizes
     FROM tournaments t WHERE t.id=$1`, [String(top.id)],
  );
  const row = tp.rows[0];
  check('top tournament collected matches SQL', near(Number(top.collected), Number(row.collected)), String(top.title));
  check('top tournament prizes match SQL', near(Number(top.prizes), Number(row.prizes)));
  check('top tournament net = collected − refunded − prizes',
    near(Number(top.net), Number(top.collected) - Number(top.refunded) - Number(top.prizes)));

  // ---- 7. CSV export --------------------------------------------------------------------
  const csv = await fetch(`${API}/admin/finance?days=30&granularity=day&format=csv`, { headers: { authorization: `Bearer ${admin}` } });
  const csvText = await csv.text();
  check('CSV served as text/csv', (csv.headers.get('content-type') ?? '').includes('text/csv'));
  check('CSV has attachment filename', (csv.headers.get('content-disposition') ?? '').includes('clutchnex-financials.csv'));
  check('CSV contains summary + series + per-tournament sections',
    csvText.includes('SUMMARY (PKR)') && csvText.includes('SERIES (PKR)') && csvText.includes('PER-TOURNAMENT P&L'));
  check('CSV net revenue row matches API', csvText.includes(`Net Revenue,${t.netRevenue.toFixed(2)}`));
  const csvAsUser = await fetch(`${API}/admin/finance?format=csv`, { headers: { authorization: `Bearer ${user}` } });
  check('CSV export refused for USER', csvAsUser.status === 403);

  // ---- cleanup ---------------------------------------------------------------------------
  // Restore the deposit flipped during check 4 so the dataset keeps its
  // deposit↔ledger consistency for the other verification suites (the real
  // approval flow also credits the ledger, which this probe intentionally skips).
  await db.query(`UPDATE deposits SET status='PENDING', "reviewedAt"=NULL WHERE status='APPROVED' AND id IN (SELECT id FROM deposits WHERE status='APPROVED' ORDER BY "reviewedAt" DESC LIMIT 1) AND "reviewedAt" >= now() - interval '10 minutes'`);
  await db.end();

  console.log(failures === 0 ? '\n🏆 All financial dashboard checks passed.' : `\n💥 ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
