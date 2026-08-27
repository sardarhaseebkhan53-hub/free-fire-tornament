'use client';
// Revenue analytics — design 34: gross vs prizes vs net, daily ledger, CSV-friendly.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { AreaChart, Kpi, Table, Td, Tr, useAdminList } from '@/components/admin/kit';

const inr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;

interface Revenue {
  totals: { deposits: number; withdrawals: number; prizes: number; entryCollection: number; netRevenue: number; registrations: number };
  series: Array<{ day: string; deposits: number; withdrawals: number; prizes: number; entries: number; registrations: number }>;
}

export default function AdminRevenuePage() {
  const [days, setDays] = useState(30);
  const { data, loading } = useAdminList<Revenue>(`/admin/revenue?days=${days}`, [days]);

  if (loading && !data) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  if (!data) return <p className="glass rounded-card p-8 text-center text-sm text-fg-2">Could not load revenue analytics.</p>;

  const t = data.totals;
  return (
    <div>
      <AdminPageTitle
        title="Revenue Analytics"
        sub="Gross collection is entry fees — never conflated with deposits."
        action={
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]">
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Entry Collection" value={inr(t.entryCollection)} tone="accent" />
        <Kpi label="Prizes Paid" value={inr(t.prizes)} tone="reward" />
        <Kpi label="Net Revenue" value={inr(t.netRevenue)} tone="success" />
        <Kpi label="Deposits (player funds)" value={inr(t.deposits)} tone="info" />
        <Kpi label="Withdrawals Paid" value={inr(t.withdrawals)} tone="warning" />
      </div>

      <div className="glass mt-4 rounded-card p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-fg-3">Daily entry collection</p>
        <AreaChart series={data.series.map((s) => ({ day: s.day, value: s.entries }))} height={200} />
      </div>

      <div className="mt-4">
        <Table head={['Day', 'Entry collection', 'Prizes', 'Net', 'Deposits', 'Withdrawals', 'Registrations']}>
          {[...data.series].reverse().map((s) => (
            <Tr key={s.day}>
              <Td className="whitespace-nowrap text-xs text-fg-2">{new Date(s.day).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
              <Td className="tabular text-fg">{inr(s.entries)}</Td>
              <Td className="tabular text-reward">{inr(s.prizes)}</Td>
              <Td className={`tabular font-bold ${s.entries - s.prizes >= 0 ? 'text-success' : 'text-danger'}`}>{inr(s.entries - s.prizes)}</Td>
              <Td className="tabular text-fg-2">{inr(s.deposits)}</Td>
              <Td className="tabular text-fg-2">{inr(s.withdrawals)}</Td>
              <Td className="tabular text-fg-2">{s.registrations}</Td>
            </Tr>
          ))}
        </Table>
      </div>
    </div>
  );
}
