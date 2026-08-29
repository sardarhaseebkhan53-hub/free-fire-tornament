'use client';
// Financial dashboard — design 43 (Phase 10): the full P&L. Entry fees are the
// only revenue; deposits/withdrawals are player funds and never touch profit.
// Same design on mobile (stacked KPI cards, card-mode tournament rows) and PC.
import { useState } from 'react';
import { Download, Gift, Loader2, RefreshCcw, Trophy, Upload, Wallet } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Donut, Kpi, MultiLineChart, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { authedFetch } from '@/lib/client-api';
import { MODE_LABEL } from '@/lib/format';

const inr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;

interface Finance {
  totals: {
    grossEntryCollection: number; couponDiscounts: number; refunds: number;
    prizesDistributed: number; paymentCosts: number; referralBonusCosts: number;
    platformGross: number; netRevenue: number; netMarginPct: number; registrations: number;
    depositsApproved: number; withdrawalsPaid: number;
  };
  series: Array<{
    bucket: string; entries: number; refunds: number; prizes: number;
    paymentCosts: number; referralBonusCosts: number; net: number;
    deposits: number; withdrawals: number;
  }>;
  tournaments: Array<{
    id: string; title: string; slug: string; type: string; status: string;
    entries: number; collected: number; refunded: number; prizes: number; net: number;
  }>;
}

const GRAN = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
] as const;

export default function AdminFinancePage() {
  const [days, setDays] = useState(30);
  const [gran, setGran] = useState<'day' | 'week' | 'month'>('day');
  const { data, loading } = useAdminList<Finance>(`/admin/finance?days=${days}&granularity=${gran}`, [days, gran]);

  function exportCsv() {
    authedFetch(`/admin/finance?days=${days}&granularity=${gran}&format=csv`)
      .then((r) => {
        if (!r.ok) throw new Error('Export failed — try again.');
        return r.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'clutchnex-financials.csv';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((e) => alert(e instanceof Error ? e.message : 'Export failed — try again.'));
  }

  if (loading && !data) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  if (!data) return <p className="glass rounded-card p-8 text-center text-sm text-fg-2">Could not load the financial dashboard.</p>;

  const t = data.totals;
  const donutParts = [
    { label: 'Prizes', value: t.prizesDistributed, color: '#F5B942' },
    { label: 'Refunds', value: t.refunds, color: '#EF4444' },
    { label: 'Payment costs', value: t.paymentCosts, color: '#3B82F6' },
    { label: 'Referral & bonus', value: t.referralBonusCosts, color: '#F59E0B' },
    { label: 'Estimated net profit', value: Math.max(0, t.netRevenue), color: '#10B981' },
  ];
  const bucketLabel = (b: string) =>
    gran === 'month'
      ? new Date(b).toLocaleDateString('en-PK', { month: 'short', year: 'numeric' })
      : new Date(b).toLocaleDateString('en-PK', gran === 'week' ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div>
      <AdminPageTitle
        title="Financial Dashboard"
        sub="Total collection − player rewards = platform gross. Net profit is an estimate after costs — deposits and withdrawals are player funds, never revenue."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]">
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button onClick={exportCsv} className="flex items-center gap-2 rounded-input bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_4px_18px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong w-full justify-center sm:w-auto">
              <Download size={15} /> Export CSV
            </button>
          </div>
        }
      />

      {/* Granularity pills */}
      <div className="mb-4 inline-flex rounded-pill border border-line bg-white/[3%] p-1">
        {GRAN.map((g) => (
          <button
            key={g.value}
            onClick={() => setGran(g.value)}
            className={`rounded-pill px-4 py-1.5 text-xs font-bold transition ${gran === g.value ? 'bg-accent text-white shadow-[0_4px_14px_rgba(139,92,246,0.4)]' : 'text-fg-2 hover:text-fg'}`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Primary P&L KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Gross Entry Collection" value={inr(t.grossEntryCollection)} tone="accent" sub={<span className="text-fg-3">{t.registrations} confirmed entries</span>} />
        <Kpi label="Prizes Distributed" value={inr(t.prizesDistributed)} tone="reward" icon={<Trophy size={16} />} />
        <Kpi label="Platform Gross" value={inr(t.platformGross)} tone="info" sub={<span className="text-fg-3">collection − refunds − prizes</span>} />
        <Kpi label="Estimated Net Profit" value={inr(t.netRevenue)} tone="success" sub={<span className={t.netMarginPct >= 0 ? 'text-success' : 'text-danger'}>{t.netMarginPct}% margin · estimated</span>} />
      </div>

      {/* Cost lines */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Payment Costs" value={inr(t.paymentCosts)} tone="info" icon={<Wallet size={16} />} />
        <Kpi label="Refunds" value={inr(t.refunds)} tone="danger" icon={<RefreshCcw size={16} />} />
        <Kpi label="Referral & Bonus Costs" value={inr(t.referralBonusCosts)} tone="warning" icon={<Gift size={16} />} />
        <Kpi label="Withdrawals Paid" value={inr(t.withdrawalsPaid)} tone="danger" icon={<Upload size={16} />} sub={<span className="text-fg-3">player funds · not P&L</span>} />
      </div>

      {/* Trend + breakdown */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="glass rounded-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-fg-3">Entry collection vs prizes vs net</p>
          <MultiLineChart
            series={[
              data.series.map((s) => ({ x: s.bucket, value: s.entries })),
              data.series.map((s) => ({ x: s.bucket, value: s.prizes })),
              data.series.map((s) => ({ x: s.bucket, value: Math.max(0, s.net) })),
            ]}
            labels={[
              { label: 'Entry collection', color: '#8B5CF6' },
              { label: 'Prizes', color: '#F5B942' },
              { label: 'Net revenue', color: '#10B981' },
            ]}
            height={230}
          />
        </div>
        <div className="glass rounded-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-fg-3">Where entry fees went</p>
          <div className="mt-4">
            <Donut parts={donutParts} total={t.grossEntryCollection} label="of collection" />
          </div>
        </div>
      </div>

      {/* Per-tournament P&L — table on desktop, cards on mobile (design 43) */}
      <h2 className="mt-6 font-display text-lg font-bold text-fg">Per-Tournament P&L <span className="text-xs font-medium text-fg-3">all-time</span></h2>
      <div className="mt-3 hidden md:block">
        <Table head={['Tournament', 'Mode', 'Status', 'Entries', 'Collected', 'Refunded', 'Prizes', 'Net']}>
          {data.tournaments.map((t2) => (
            <Tr key={t2.id}>
              <Td className="font-semibold text-fg">{t2.title}</Td>
              <Td className="text-fg-2">{MODE_LABEL[t2.type] ?? t2.type}</Td>
              <Td><Pill status={t2.status} /></Td>
              <Td className="tabular text-fg-2">{t2.entries}</Td>
              <Td className="tabular text-fg">{inr(t2.collected)}</Td>
              <Td className="tabular text-fg-2">{inr(t2.refunded)}</Td>
              <Td className="tabular text-reward">{inr(t2.prizes)}</Td>
              <Td className={`tabular font-bold ${t2.net >= 0 ? 'text-success' : 'text-danger'}`}>{inr(t2.net)}</Td>
            </Tr>
          ))}
        </Table>
      </div>
      <div className="mt-3 grid gap-3 md:hidden">
        {data.tournaments.map((t2) => (
          <div key={t2.id} className="glass rounded-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate font-semibold text-fg">{t2.title}</p>
              <Pill status={t2.status} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <span className="text-fg-3">{MODE_LABEL[t2.type] ?? t2.type} · {t2.entries} entries</span>
              <span className="tabular text-right text-fg">{inr(t2.collected)} collected</span>
              <span className="tabular text-fg-2">Prizes {inr(t2.prizes)}</span>
              <span className="tabular text-right text-fg-2">Refunds {inr(t2.refunded)}</span>
            </div>
            <p className={`tabular mt-2 text-right font-display text-lg font-bold ${t2.net >= 0 ? 'text-success' : 'text-danger'}`}>
              {inr(t2.net)} <span className="text-[10px] font-bold uppercase tracking-wide text-fg-3">net</span>
            </p>
          </div>
        ))}
      </div>

      {/* Bucket ledger */}
      <h2 className="mt-6 font-display text-lg font-bold text-fg">Daily ledger <span className="text-xs font-medium text-fg-3">({gran === 'day' ? 'daily' : gran === 'week' ? 'weekly' : 'monthly'} buckets)</span></h2>
      <div className="mt-3">
        <Table head={[gran === 'month' ? 'Month' : gran === 'week' ? 'Week of' : 'Day', 'Entry collection', 'Refunds', 'Prizes', 'Costs', 'Net', 'Deposits*', 'Withdrawals*']}>
          {[...data.series].reverse().map((s) => (
            <Tr key={s.bucket}>
              <Td className="whitespace-nowrap text-xs text-fg-2">{bucketLabel(s.bucket)}</Td>
              <Td className="tabular text-fg">{inr(s.entries)}</Td>
              <Td className="tabular text-fg-2">{inr(s.refunds)}</Td>
              <Td className="tabular text-reward">{inr(s.prizes)}</Td>
              <Td className="tabular text-fg-2">{inr(s.paymentCosts + s.referralBonusCosts)}</Td>
              <Td className={`tabular font-bold ${s.net >= 0 ? 'text-success' : 'text-danger'}`}>{inr(s.net)}</Td>
              <Td className="tabular text-fg-3">{inr(s.deposits)}</Td>
              <Td className="tabular text-fg-3">{inr(s.withdrawals)}</Td>
            </Tr>
          ))}
        </Table>
        <p className="mt-2 text-[11px] text-fg-3">* Deposits and withdrawals are player-fund flows, shown for reconciliation — they never count as revenue or cost.</p>
      </div>
    </div>
  );
}
