'use client';
// Admin dashboard — design 26: KPI row, revenue chart, registrations chart,
// deposits-vs-withdrawals-vs-prizes donut, recent activity, fraud alerts.
import Link from 'next/link';
import {
  Headphones, Loader2, ShieldAlert, Trophy, Upload, UserCheck, Users, Wallet,
} from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { AreaChart, BarChart, Donut, Kpi, useAdminList } from '@/components/admin/kit';

interface Stats {
  kpis: {
    totalUsers: number; activeToday: number; liveTournaments: number; openTickets: number;
    pendingDeposits: { count: number; amount: number };
    pendingWithdrawals: { count: number; amount: number };
    registrations30d: number;
  };
  recentActivity: Array<{ id: string; action: string; entity: string; actor: string; createdAt: string }>;
  fraudAlerts: Array<{ id: string; kind: string; severity: string; createdAt: string }>;
}
interface Revenue {
  totals: { deposits: number; withdrawals: number; prizes: number; entryCollection: number; netRevenue: number; registrations: number };
  series: Array<{ day: string; deposits: number; withdrawals: number; prizes: number; entries: number; registrations: number }>;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const ACTION_TONE: Record<string, string> = {
  USER_BANNED: 'text-danger', USER_SUSPENDED: 'text-danger', USER_ACTIVE: 'text-success',
  DEPOSIT_APPROVED: 'text-success', DEPOSIT_REJECTED: 'text-danger',
  WITHDRAWAL_PAID: 'text-success', WITHDRAWAL_REJECTED: 'text-danger',
  TOURNAMENT_CREATED: 'text-accent', RESULT_VERIFIED: 'text-success',
  PRIZES_DISTRIBUTED: 'text-reward', BALANCE_ADJUSTED: 'text-warning',
};

export default function AdminDashboard() {
  const stats = useAdminList<Stats>('/admin/stats');
  const rev = useAdminList<Revenue>('/admin/revenue?days=30');

  if (stats.loading || rev.loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }
  if (!stats.data || !rev.data) {
    return <p className="glass rounded-card p-8 text-center text-sm text-fg-2">Could not load the dashboard — try refreshing.</p>;
  }

  const k = stats.data.kpis;
  const t = rev.data.totals;
  const series = rev.data.series;

  return (
    <div>
      <AdminPageTitle title="Dashboard" sub="Live control center — payments, results, users and revenue at a glance." />

      {/* KPI row — design 26 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Total Users" value={k.totalUsers.toLocaleString('en-IN')} tone="accent" icon={<Users size={16} />} sub={<span className="text-fg-3">registered players</span>} />
        <Kpi label="Active Today" value={k.activeToday.toLocaleString('en-IN')} tone="info" icon={<UserCheck size={16} />} sub={<span className="text-fg-3">last 24h activity</span>} />
        <Kpi label="Live Tournaments" value={k.liveTournaments} tone="danger" icon={<Trophy size={16} />} sub={<span className="text-fg-3">running now</span>} />
        <Kpi label="Pending Deposits" value={k.pendingDeposits.count} tone="warning" icon={<Wallet size={16} />} sub={<span className="text-fg-3">{inr(k.pendingDeposits.amount)} total</span>} />
        <Kpi label="Pending Withdrawals" value={k.pendingWithdrawals.count} tone="reward" icon={<Upload size={16} />} sub={<span className="text-fg-3">{inr(k.pendingWithdrawals.amount)} total</span>} />
        <Kpi label="Open Tickets" value={k.openTickets} tone="success" icon={<Headphones size={16} />} sub={<Link href="/admin/support" className="text-accent hover:underline">review →</Link>} />
      </div>

      {/* Charts row */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_1fr_0.9fr]">
        <div className="glass rounded-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-fg-3">Revenue (last 30 days)</p>
          <p className="tabular mt-1 font-display text-2xl font-bold text-fg">{inr(t.entryCollection)}</p>
          <p className="text-[11px] text-fg-3">entry collection — gross, before prizes</p>
          <AreaChart series={series.map((s) => ({ day: s.day, value: s.entries }))} />
          <div className="grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs sm:grid-cols-4">
            {[
              ['Deposits', inr(t.deposits)],
              ['Withdrawals', inr(t.withdrawals)],
              ['Prizes', inr(t.prizes)],
              ['Net Revenue', inr(t.netRevenue)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-fg-3">{label}</p>
                <p className="tabular font-bold text-fg">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-fg-3">Tournament Registrations</p>
          <p className="tabular mt-1 font-display text-2xl font-bold text-fg">{t.registrations.toLocaleString('en-IN')}</p>
          <p className="text-[11px] text-fg-3">confirmed entries, last 30 days</p>
          <BarChart series={series.map((s) => ({ day: s.day, value: s.registrations }))} />
        </div>

        <div className="glass rounded-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-fg-3">Deposits vs Withdrawals vs Prizes</p>
          <div className="mt-4">
            <Donut
              total={t.deposits + t.withdrawals + t.prizes}
              label={inr(t.deposits + t.withdrawals + t.prizes)}
              parts={[
                { label: 'Deposits', value: t.deposits, color: '#8B5CF6' },
                { label: 'Withdrawals', value: t.withdrawals, color: '#F5B942' },
                { label: 'Prizes', value: t.prizes, color: '#3B82F6' },
              ]}
            />
          </div>
          <p className="mt-3 text-[11px] text-fg-3">All values in PKR · 30-day window</p>
        </div>
      </div>

      {/* Activity + fraud */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="glass rounded-card p-5">
          <div className="flex items-center justify-between">
            <p className="font-display text-base font-bold text-fg">Recent Activity</p>
            <Link href="/admin/audit-logs" className="text-xs font-semibold text-accent hover:underline">View All</Link>
          </div>
          <div className="mt-3 flex flex-col divide-y divide-line/60">
            {stats.data.recentActivity.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <ShieldAlert size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{a.action.replaceAll('_', ' ')}</p>
                  <p className="truncate text-[11px] text-fg-3">by {a.actor} · {a.entity}</p>
                </div>
                <span className="shrink-0 text-[11px] text-fg-3">{timeAgo(a.createdAt)}</span>
                <span className={`hidden shrink-0 text-[10px] font-bold uppercase sm:block ${ACTION_TONE[a.action] ?? 'text-fg-3'}`}>
                  {a.entity}
                </span>
              </div>
            ))}
            {stats.data.recentActivity.length === 0 && <p className="py-4 text-sm text-fg-3">No activity yet.</p>}
          </div>
        </div>

        <div className="glass rounded-card p-5">
          <div className="flex items-center justify-between">
            <p className="font-display text-base font-bold text-fg">Fraud Alerts</p>
            <span className="rounded-pill bg-danger/15 px-2.5 py-0.5 text-[11px] font-bold text-danger">
              {stats.data.fraudAlerts.length} open
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {stats.data.fraudAlerts.length === 0 && (
              <div className="rounded-card border border-success/25 bg-success/[5%] px-4 py-6 text-center">
                <p className="text-sm font-semibold text-success">No open fraud alerts</p>
                <p className="mt-1 text-xs text-fg-3">Duplicate-deposit and abuse detectors are quiet.</p>
              </div>
            )}
            {stats.data.fraudAlerts.map((f) => (
              <div key={f.id} className="rounded-card border border-danger/25 bg-danger/[5%] p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-fg">{f.kind.replaceAll('_', ' ')}</p>
                  <span className="rounded-pill bg-danger/20 px-2 py-0.5 text-[10px] font-bold uppercase text-danger">{f.severity}</span>
                </div>
                <p className="mt-1 text-[11px] text-fg-3">{timeAgo(f.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
