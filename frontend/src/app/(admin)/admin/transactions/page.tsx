'use client';
// Full wallet ledger — the immutable script of every debit/credit on the
// platform. This is the admin view the finance pages summarise.
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { downloadProtectedFile } from '@/lib/client-api';

interface Row {
  id: string; username: string; email: string;
  type: string; bucket: string; direction: string; amount: number;
  balanceBefore: number; balanceAfter: number;
  reference: string | null; description: string | null;
  status: string; createdAt: string;
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

const DIRECTIONS = [
  { value: '', label: 'All' },
  { value: 'CREDIT', label: 'In' },
  { value: 'DEBIT', label: 'Out' },
] as const;

const inr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;

export default function AdminTransactionsPage() {
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (q.trim()) params.set('q', q.trim());
  if (direction) params.set('direction', direction);
  const path = `/admin/transactions?${params}`;
  const { data, loading } = useAdminList<Page>(path, [q, direction, page]);

  function exportCsv() {
    downloadProtectedFile(`/admin/transactions?${params}&csv=1`, 'clutchnex-ledger.csv')
      .catch((e) => alert(e instanceof Error ? e.message : 'Export failed — try again.'));
  }

  return (
    <div>
      <AdminPageTitle
        title="Transactions"
        sub="Immutable wallet ledger — every deposit, entry, prize, withdrawal, transfer and adjustment. Financials are summaries; this is the script."
        action={
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-input bg-accent px-4 py-2.5 text-sm font-bold text-white">
            <Download size={15} /> Export CSV
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search player, email, reference, description…"
          className="w-72 rounded-input border border-line bg-white/[3%] px-3.5 py-2 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
        />
        <select
          value={direction}
          onChange={(e) => { setDirection(e.target.value); setPage(1); }}
          className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]"
        >
          {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['Date', 'Player', 'Type', 'Bucket', 'Direction', 'Amount', 'Before', 'After', 'Reference', 'Description']}>
            {data?.items.map((t) => (
              <Tr key={t.id}>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(t.createdAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</Td>
                <Td>
                  <p className="font-semibold text-fg">{t.username}</p>
                  <p className="text-[11px] text-fg-3">{t.email}</p>
                </Td>
                <Td className="text-xs text-fg-2">{t.type.replace(/_/g, ' ')}</Td>
                <Td><Pill status={t.bucket} label={t.bucket.replace(/_/g, ' ')} /></Td>
                <Td><span className={`text-xs font-bold ${t.direction === 'CREDIT' ? 'text-success' : 'text-danger'}`}>{t.direction}</span></Td>
                <Td className={`tabular font-bold ${t.direction === 'CREDIT' ? 'text-success' : 'text-danger'}`}>{inr(t.amount)}</Td>
                <Td className="tabular text-xs text-fg-3">{inr(t.balanceBefore)}</Td>
                <Td className="tabular text-xs text-fg">{inr(t.balanceAfter)}</Td>
                <Td className="font-mono text-[11px] text-fg-2">{t.reference ?? '—'}</Td>
                <Td className="max-w-64 text-xs text-fg-2">{t.description ?? '—'}</Td>
              </Tr>
            ))}
            {data?.items.length === 0 && <Tr><Td className="py-8 text-center text-fg-3">No transactions match.</Td></Tr>}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
