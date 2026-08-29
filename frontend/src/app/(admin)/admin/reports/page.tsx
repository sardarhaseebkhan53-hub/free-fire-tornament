'use client';
// Admin — Reports (spec §14, §44). Rolling 30-day operational summary:
// users, registrations/revenue, matches, deposits, withdrawals and prizes.
import { Loader2, RefreshCcw } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Kpi, useAdminList } from '@/components/admin/kit';

interface Reports {
  window: string;
  users: { total: number; active: number };
  registrations: { count: number; revenue: number };
  matches: { total: number; completed: number };
  deposits: { count: number; amount: number };
  withdrawals: { count: number; amount: number };
  prizes: { count: number; amount: number };
}

export default function AdminReportsPage() {
  const { data, loading } = useAdminList<Reports>('/admin/reports');

  if (loading && !data) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  if (!data) return (
    <div>
      <AdminPageTitle title="Reports" sub="30-day operational summary." />
      <p className="glass rounded-card p-10 text-center text-sm text-fg-2">Could not load the report.</p>
    </div>
  );

  const rate = data.users.total > 0 ? Math.round((data.users.active / data.users.total) * 100) : 0;

  return (
    <div>
      <AdminPageTitle
        title="Reports"
        sub={`Rolling ${data.window} operational summary — the same numbers that feed the financial dashboard.`}
        action={
          <span className="inline-flex items-center gap-1.5 rounded-input border border-line px-4 py-2.5 text-xs font-bold text-fg-2">
            <RefreshCcw size={13} /> Live from ledger
          </span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Total users" value={String(data.users.total)} sub={`${data.users.active} active in 30d (${rate}%)`} />
        <Kpi label="Registrations (30d)" value={String(data.registrations.count)} sub={`${data.registrations.revenue.toLocaleString('en-PK')} PKR received`} />
        <Kpi label="Matches" value={String(data.matches.total)} sub={`${data.matches.completed} completed`} />
        <Kpi label="Deposits approved" value={String(data.deposits.count)} sub={`${data.deposits.amount.toLocaleString('en-PK')} PKR`} />
        <Kpi label="Withdrawals paid" value={String(data.withdrawals.count)} sub={`${data.withdrawals.amount.toLocaleString('en-PK')} PKR`} />
        <Kpi label="Prizes credited" value={String(data.prizes.count)} sub={`${data.prizes.amount.toLocaleString('en-PK')} PKR`} />
      </div>
    </div>
  );
}
