'use client';
// Admin — Winners (spec §14, §40). Credited/awarded prize records per
// tournament with search, filter and totals. The public winners page only
// ever shows CREDITED rows; this screen is the full audit view.
import { useState } from 'react';
import { Loader2, RefreshCcw, Search, Trophy } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Kpi, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { apiGet } from '@/lib/client-api';

interface Row {
  id: string; position: number; amount: number; status: string; creditedAt: string | null; createdAt: string;
  recipient: string; tournament: { title: string; slug: string; type: string };
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }
interface TList { items: Array<{ id: string; title: string }> }

export default function AdminWinnersPage() {
  const [q, setQ] = useState('');
  const [tourId, setTourId] = useState('');
  const [page, setPage] = useState(1);
  const tours = useAdminList<TList>('/admin/tournaments?pageSize=50');

  const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (tourId) qs.set('tournamentId', tourId);
  const { data, loading, setData } = useAdminList<Page>(`/admin/winners?${qs}`, [tourId, page]);

  async function refresh() {
    const fresh = await apiGet<Page>(`/admin/winners?${qs}`);
    if (fresh) setData(fresh);
  }

  const totalAmount = data?.items.reduce((a, r) => a + (r.status === 'CREDITED' ? r.amount : 0), 0) ?? 0;
  const credited = data?.items.filter((r) => r.status === 'CREDITED').length ?? 0;

  return (
    <div>
      <AdminPageTitle
        title="Winners"
        sub="Awarded prizes per tournament — paid (CREDITED) vs pending. Payouts are immutable ledger credits."
        action={
          <button onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-input border border-line px-4 py-2.5 text-xs font-bold text-fg-2 hover:text-fg">
            <RefreshCcw size={13} /> Refresh
          </button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi label="Shown in this view" value={String(data?.total ?? 0)} icon={<Trophy size={16} />} />
        <Kpi label="Credited (this page)" value={String(credited)} />
        <Kpi label="Credited PKR (this page)" value={totalAmount.toLocaleString('en-PK')} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search recipient or tournament (client-side)…"
            className="w-72 rounded-input border border-line bg-white/[3%] py-2 pl-9 pr-3 text-sm text-fg-2 outline-none placeholder:text-fg-3 focus:border-accent" />
        </div>
        <select value={tourId} onChange={(e) => { setTourId(e.target.value); setPage(1); }}
          className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]">
          <option value="">All tournaments</option>
          {tours.data?.items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['Tournament', 'Recipient', 'Position', 'Amount (PKR)', 'Status', 'Created', 'Credited']}>
            {data?.items
              .filter((r) => !q || `${r.recipient} ${r.tournament.title}`.toLowerCase().includes(q.toLowerCase()))
              .map((r) => (
                <Tr key={r.id}>
                  <Td><span className="font-semibold text-fg">{r.tournament.title}</span></Td>
                  <Td className="text-xs text-fg-2">{r.recipient}</Td>
                  <Td className="text-xs font-bold text-fg">{r.position >= 100 ? (r.position >= 200 ? 'MVP' : 'Kill Pool') : `#${r.position}`}</Td>
                  <Td className="tabular text-xs font-bold text-reward">{r.amount.toLocaleString('en-PK')}</Td>
                  <Td><Pill status={r.status} /></Td>
                  <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(r.createdAt).toLocaleDateString('en-PK')}</Td>
                  <Td className="whitespace-nowrap text-xs text-fg-3">{r.creditedAt ? new Date(r.creditedAt).toLocaleDateString('en-PK') : '—'}</Td>
                </Tr>
              ))}
            {data?.items.length === 0 && <Tr><Td className="py-8 text-center text-fg-3">No winners yet — publish results or distribute prizes to create awards.</Td></Tr>}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
