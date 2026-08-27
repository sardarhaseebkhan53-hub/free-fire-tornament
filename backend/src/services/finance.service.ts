// =============================================================================
// Phase 10 — Financial dashboard.
//
// One rule above all: **deposits are player funds, never revenue.** The only
// true revenue of the platform is entry fees actually charged (confirmed
// registrations). Everything the platform pays out or gives away is a cost.
//
// Revenue model (per window):
//   grossEntryCollection = Σ entryAmount of CONFIRMED registrations
//   couponDiscounts      = Σ discount (foregone revenue, informational)
//   refunds              = Σ ENTRY_REFUND credits (returned entry fees)
//   prizesDistributed    = Σ winners CREDITED
//   paymentCosts         = Σ expenses of category PAYMENT_COST
//   referralBonusCosts   = Σ REFERRAL_REWARD + BONUS_CREDIT credits
//   platformGross        = grossEntryCollection − refunds − prizesDistributed
//   netRevenue           = platformGross − paymentCosts − referralBonusCosts
//   depositsApproved / withdrawalsPaid are reported as *player fund flows*
//   and are deliberately excluded from every profit line.
//
// Series buckets (day/week/month) filter events to >= window start so the
// bucket sums always reconcile with the window totals to the rupee.
// =============================================================================
import { prisma } from '../lib/prisma';

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;

export type Granularity = 'day' | 'week' | 'month';
export interface FinanceQuery { days: number; granularity: Granularity }

export interface FinanceTotals {
  grossEntryCollection: number;
  couponDiscounts: number;
  refunds: number;
  prizesDistributed: number;
  paymentCosts: number;
  referralBonusCosts: number;
  platformGross: number;
  netRevenue: number;
  netMarginPct: number;
  registrations: number;
  depositsApproved: number; // player funds — never revenue
  withdrawalsPaid: number; // player funds — never revenue
}

export interface FinanceBucket {
  bucket: string;
  entries: number;
  refunds: number;
  prizes: number;
  paymentCosts: number;
  referralBonusCosts: number;
  net: number;
  deposits: number; // player funds — context only
  withdrawals: number; // player funds — context only
}

export interface TournamentPnl {
  id: string;
  title: string;
  slug: string;
  type: string;
  status: string;
  entries: number;
  collected: number;
  refunded: number;
  prizes: number;
  net: number;
}

const esc = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

async function financeTotals(days: number): Promise<FinanceTotals & { since: Date }> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [row, regAgg] = await Promise.all([
    prisma.$queryRaw<Array<{
      entries: string; discounts: string; refunds: string; prizes: string;
      payment_costs: string; referral_bonus: string; withdrawals: string; deposits: string;
    }>>`
      SELECT
        (SELECT COALESCE(SUM("entryAmount"), 0) FROM tournament_registrations
           WHERE status = 'CONFIRMED' AND "registeredAt" >= ${since}) AS entries,
        (SELECT COALESCE(SUM(discount), 0) FROM tournament_registrations
           WHERE status = 'CONFIRMED' AND "registeredAt" >= ${since}) AS discounts,
        (SELECT COALESCE(SUM(amount), 0) FROM wallet_transactions
           WHERE type = 'ENTRY_REFUND' AND direction = 'CREDIT' AND "createdAt" >= ${since}) AS refunds,
        (SELECT COALESCE(SUM(amount), 0) FROM winners
           WHERE status = 'CREDITED' AND "creditedAt" >= ${since}) AS prizes,
        (SELECT COALESCE(SUM(amount), 0) FROM expenses
           WHERE category = 'PAYMENT_COST' AND "occurredAt" >= ${since}) AS payment_costs,
        (SELECT COALESCE(SUM(amount), 0) FROM wallet_transactions
           WHERE type IN ('REFERRAL_REWARD', 'BONUS_CREDIT') AND direction = 'CREDIT' AND "createdAt" >= ${since}) AS referral_bonus,
        (SELECT COALESCE(SUM(amount), 0) FROM withdrawals
           WHERE status = 'PAID' AND "reviewedAt" >= ${since}) AS withdrawals,
        (SELECT COALESCE(SUM(amount), 0) FROM deposits
           WHERE status = 'APPROVED' AND "reviewedAt" >= ${since}) AS deposits`,
    prisma.tournamentRegistration.aggregate({
      where: { status: 'CONFIRMED', registeredAt: { gte: since } },
      _count: true,
    }),
  ]);

  const grossEntryCollection = num(row[0]?.entries);
  const couponDiscounts = num(row[0]?.discounts);
  const refunds = num(row[0]?.refunds);
  const prizesDistributed = num(row[0]?.prizes);
  const paymentCosts = num(row[0]?.payment_costs);
  const referralBonusCosts = num(row[0]?.referral_bonus);
  const platformGross = Math.round((grossEntryCollection - refunds - prizesDistributed) * 100) / 100;
  const netRevenue = Math.round((platformGross - paymentCosts - referralBonusCosts) * 100) / 100;

  return {
    since,
    grossEntryCollection,
    couponDiscounts,
    refunds,
    prizesDistributed,
    paymentCosts,
    referralBonusCosts,
    platformGross,
    netRevenue,
    netMarginPct: grossEntryCollection > 0
      ? Math.round((netRevenue / grossEntryCollection) * 1000) / 10
      : 0,
    registrations: regAgg._count,
    depositsApproved: num(row[0]?.deposits),
    withdrawalsPaid: num(row[0]?.withdrawals),
  };
}

async function financeSeries(days: number, granularity: Granularity, since: Date): Promise<FinanceBucket[]> {
  const step = `1 ${granularity}`;
  const rows = await prisma.$queryRaw<Array<{
    bucket: Date; entries: string; refunds: string; prizes: string;
    payment_costs: string; referral_bonus: string; deposits: string; withdrawals: string;
  }>>`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${granularity}, now() - (${days} || ' days')::interval),
        date_trunc(${granularity}, now()),
        ${step}::interval
      ) AS bucket
    )
    SELECT b.bucket,
      COALESCE((SELECT SUM(r."entryAmount") FROM tournament_registrations r
        WHERE r.status = 'CONFIRMED' AND r."registeredAt" >= ${since}
          AND date_trunc(${granularity}, r."registeredAt") = b.bucket), 0) AS entries,
      COALESCE((SELECT SUM(wt.amount) FROM wallet_transactions wt
        WHERE wt.type = 'ENTRY_REFUND' AND wt.direction = 'CREDIT' AND wt."createdAt" >= ${since}
          AND date_trunc(${granularity}, wt."createdAt") = b.bucket), 0) AS refunds,
      COALESCE((SELECT SUM(w.amount) FROM winners w
        WHERE w.status = 'CREDITED' AND w."creditedAt" >= ${since}
          AND date_trunc(${granularity}, w."creditedAt") = b.bucket), 0) AS prizes,
      COALESCE((SELECT SUM(e.amount) FROM expenses e
        WHERE e.category = 'PAYMENT_COST' AND e."occurredAt" >= ${since}
          AND date_trunc(${granularity}, e."occurredAt") = b.bucket), 0) AS payment_costs,
      COALESCE((SELECT SUM(wt.amount) FROM wallet_transactions wt
        WHERE wt.type IN ('REFERRAL_REWARD', 'BONUS_CREDIT') AND wt.direction = 'CREDIT' AND wt."createdAt" >= ${since}
          AND date_trunc(${granularity}, wt."createdAt") = b.bucket), 0) AS referral_bonus,
      COALESCE((SELECT SUM(d.amount) FROM deposits d
        WHERE d.status = 'APPROVED' AND d."reviewedAt" >= ${since}
          AND date_trunc(${granularity}, d."reviewedAt") = b.bucket), 0) AS deposits,
      COALESCE((SELECT SUM(w.amount) FROM withdrawals w
        WHERE w.status = 'PAID' AND w."reviewedAt" >= ${since}
          AND date_trunc(${granularity}, w."reviewedAt") = b.bucket), 0) AS withdrawals
    FROM buckets b ORDER BY b.bucket`;

  return rows.map((r) => {
    const entries = num(r.entries);
    const refunds = num(r.refunds);
    const prizes = num(r.prizes);
    const paymentCosts = num(r.payment_costs);
    const referralBonusCosts = num(r.referral_bonus);
    return {
      bucket: r.bucket.toISOString(),
      entries,
      refunds,
      prizes,
      paymentCosts,
      referralBonusCosts,
      net: Math.round((entries - refunds - prizes - paymentCosts - referralBonusCosts) * 100) / 100,
      deposits: num(r.deposits),
      withdrawals: num(r.withdrawals),
    };
  });
}

/** All-time P&L per tournament (full lifecycle economics, window-independent). */
async function tournamentPnl(limit = 12): Promise<TournamentPnl[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; title: string; slug: string; type: string; status: string;
    entries: bigint; collected: string; refunded: string; prizes: string;
  }>>`
    SELECT t.id, t.title, t.slug, t.type, t.status,
      COUNT(r.id) FILTER (WHERE r.status = 'CONFIRMED') AS entries,
      COALESCE(SUM(r."entryAmount") FILTER (WHERE r.status = 'CONFIRMED'), 0) AS collected,
      COALESCE((SELECT SUM(wt.amount) FROM wallet_transactions wt
        JOIN tournament_registrations r2 ON wt."entityId" = r2.id
        WHERE wt.type = 'ENTRY_REFUND' AND wt."entityType" = 'TournamentRegistration'
          AND r2."tournamentId" = t.id), 0) AS refunded,
      COALESCE((SELECT SUM(w.amount) FROM winners w
        WHERE w."tournamentId" = t.id AND w.status = 'CREDITED'), 0) AS prizes
    FROM tournaments t
    LEFT JOIN tournament_registrations r ON r."tournamentId" = t.id
    GROUP BY t.id
    HAVING COUNT(r.id) > 0
    ORDER BY collected DESC
    LIMIT ${limit}`;

  return rows.map((r) => {
    const collected = num(r.collected);
    const refunded = num(r.refunded);
    const prizes = num(r.prizes);
    return {
      id: r.id,
      title: r.title,
      slug: r.slug,
      type: r.type,
      status: r.status,
      entries: Number(r.entries),
      collected,
      refunded,
      prizes,
      net: Math.round((collected - refunded - prizes) * 100) / 100,
    };
  });
}

export async function financeDashboard(query: FinanceQuery) {
  const { days, granularity } = query;
  const totals = await financeTotals(days);
  const [series, tournaments] = await Promise.all([
    financeSeries(days, granularity, totals.since),
    tournamentPnl(),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { since, ...t } = totals;
  return {
    window: { days, granularity },
    totals: t,
    series,
    tournaments,
    methodology: {
      revenue: 'Entry fees of confirmed registrations only — deposits are player funds.',
      platformGross: 'entry collection − refunds − prizes',
      netRevenue: 'platform gross − payment costs − referral & bonus costs',
    },
  };
}

/** Audit-friendly CSV: summary + bucketed series + per-tournament P&L. */
export async function financeCsv(query: FinanceQuery): Promise<string> {
  const { days, granularity } = query;
  const { totals, series, tournaments } = await financeDashboard(query);
  const lines: string[] = [];
  const money = (n: number) => num(n).toFixed(2);

  lines.push(`CLUTCHNEX Financial Dashboard — last ${days} days (${granularity} buckets)`);
  lines.push(`Generated,${new Date().toISOString()}`);
  lines.push('');
  lines.push('SUMMARY (PKR)');
  lines.push(`Gross Entry Collection,${money(totals.grossEntryCollection)}`);
  lines.push(`Coupon Discounts (foregone),${money(totals.couponDiscounts)}`);
  lines.push(`Refunds,${money(totals.refunds)}`);
  lines.push(`Prizes Distributed,${money(totals.prizesDistributed)}`);
  lines.push(`Platform Gross,${money(totals.platformGross)}`);
  lines.push(`Payment Costs,${money(totals.paymentCosts)}`);
  lines.push(`Referral & Bonus Costs,${money(totals.referralBonusCosts)}`);
  lines.push(`Net Revenue,${money(totals.netRevenue)}`);
  lines.push(`Net Margin %,${totals.netMarginPct}`);
  lines.push(`Registrations (confirmed),${totals.registrations}`);
  lines.push(`Deposits Approved (player funds),${money(totals.depositsApproved)}`);
  lines.push(`Withdrawals Paid (player funds),${money(totals.withdrawalsPaid)}`);
  lines.push('');
  lines.push('SERIES (PKR)');
  lines.push('Bucket,Entry Collection,Refunds,Prizes,Payment Costs,Referral & Bonus,Net Revenue');
  for (const s of series) {
    lines.push([
      s.bucket, money(s.entries), money(s.refunds), money(s.prizes),
      money(s.paymentCosts), money(s.referralBonusCosts), money(s.net),
    ].map(esc).join(','));
  }
  lines.push('');
  lines.push('PER-TOURNAMENT P&L — ALL-TIME (PKR)');
  lines.push('Tournament,Mode,Status,Entries,Collected,Refunded,Prizes,Net');
  for (const t of tournaments) {
    lines.push([
      t.title, t.type, t.status, t.entries, money(t.collected),
      money(t.refunded), money(t.prizes), money(t.net),
    ].map(esc).join(','));
  }
  return lines.join('\n');
}
