'use client';
// Transactions — design 17. Filter chips, date range, reference search,
// in/out/net summary over the current filter, paginated ledger table with
// balance before/after, and one-click CSV export of the exact filter.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Loader2, Search } from 'lucide-react';
import { api, getToken } from '@/lib/client-api';
import { CopyChip, StatusPill, TypeChip } from '@/components/wallet/bits';
import { useHasSession } from '@/lib/session';

interface Tx {
  id: string; type: string; description: string | null; reference: string | null;
  amount: number; currency: string; balanceBefore: number; balanceAfter: number;
  direction: 'CREDIT' | 'DEBIT'; status: string; createdAt: string;
}
interface TxPage {
  items: Tx[]; page: number; pageSize: number; total: number;
  totalIn: number; totalOut: number; net: number;
}

const FILTERS: Array<{ label: string; types?: string }> = [
  { label: 'All' },
  { label: 'Deposits', types: 'DEPOSIT' },
  { label: 'Entry Fees', types: 'ENTRY_FEE,ENTRY_REFUND' },
  { label: 'Winnings', types: 'WINNING' },
  { label: 'Referral', types: 'REFERRAL_REWARD' },
  { label: 'Withdrawals', types: 'WITHDRAWAL,WITHDRAWAL_REVERSAL' },
];

function two(d: number) {
  return `PKR ${Number(d).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function day(d: string) {
  return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}
function time(d: string) {
  return new Date(d).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function TransactionsPage() {
  const [data, setData] = useState<TxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(0);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const hasSession = useHasSession();
  const anon = hasSession === false;

  // Changing any filter implicitly returns to page 1 — the page number is
  // stored together with the filter signature it belongs to, so no effect is
  // needed to reset it.
  const filterKey = `${filter}|${search}|${from}|${to}|${pageSize}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p: number | ((prev: number) => number)) =>
    setPageState({ key: filterKey, page: typeof p === 'function' ? p(page) : p });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      const types = FILTERS[filter].types;
      if (types) qs.set('type', types);
      if (search.trim()) qs.set('search', search.trim());
      if (from) qs.set('from', from);
      if (to) qs.set('to', `${to}T23:59:59`);
      setData(await api<TxPage>(`/wallet/transactions?${qs.toString()}`));
    } catch {
      /* keep previous data on transient errors */
    } finally {
      setLoading(false);
    }
  }, [filter, search, from, to, page, pageSize]);

  useEffect(() => {
    if (!hasSession) return;
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [hasSession, load, search]);

  function exportCsv() {
    const qs = new URLSearchParams({ format: 'csv' });
    const types = FILTERS[filter].types;
    if (types) qs.set('type', types);
    if (search.trim()) qs.set('search', search.trim());
    if (from) qs.set('from', from);
    if (to) qs.set('to', `${to}T23:59:59`);
    fetch(`/api/backend/wallet/transactions?${qs.toString()}`, {
      headers: { authorization: `Bearer ${getToken() ?? ''}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'clutchnex-transactions.csv';
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  if (anon) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to view your transactions</h1>
        <Link href="/login?next=/wallet/transactions" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">Sign In</Link>
      </div>
    );
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const rangeLabel = from || to ? `${from ? day(from) : '…'} – ${to ? day(to) : '…'}` : 'All time';
  const pageNumbers = data
    ? Array.from({ length: Math.min(5, pages) }, (_, i) => {
        const start = Math.max(1, Math.min(data.page - 2, pages - 4));
        return start + i;
      }).filter((n) => n <= pages)
    : [];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">Transactions</h1>

      {/* Filter row */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f, i) => (
            <button
              key={f.label}
              onClick={() => setFilter(i)}
              className={`rounded-input px-3.5 py-2 text-xs font-bold transition ${
                filter === i ? 'bg-accent text-white' : 'border border-line bg-white/[2%] text-fg-2 hover:text-fg'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-input border border-line bg-white/[2%] px-3 py-2">
            <span className="text-xs text-fg-3">📅</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date"
              className="w-[104px] bg-transparent text-xs text-fg-2 outline-none [color-scheme:dark]" />
            <span className="text-xs text-fg-3">–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date"
              className="w-[104px] bg-transparent text-xs text-fg-2 outline-none [color-scheme:dark]" />
          </div>
          <label className="flex items-center gap-2 rounded-input border border-line bg-white/[2%] px-3 py-2">
            <Search size={13} className="text-fg-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by reference ID"
              className="w-36 bg-transparent text-xs text-fg outline-none placeholder:text-fg-3"
            />
          </label>
          <button
            onClick={exportCsv}
            className="rounded-input bg-accent px-4 py-2 text-xs font-bold text-white transition hover:brightness-110"
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total In', value: two(data?.totalIn ?? 0), tone: 'text-success', icon: ArrowDownLeft, chip: 'bg-success/15 text-success border-success/30' },
          { label: 'Total Out', value: `-${two(data?.totalOut ?? 0)}`, tone: 'text-danger', icon: ArrowUpRight, chip: 'bg-danger/15 text-danger border-danger/30' },
          { label: 'Net', value: two(data?.net ?? 0), tone: 'text-accent', icon: null, chip: 'bg-accent/15 text-accent border-accent/30' },
        ].map((c) => (
          <div key={c.label} className="glass flex items-center justify-between rounded-card p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-2">{c.label}</p>
              <p className={`tabular mt-1 font-display text-2xl font-bold sm:text-3xl ${c.tone}`}>{c.value}</p>
              <p className="mt-1 text-[11px] text-fg-3">{rangeLabel}</p>
            </div>
            {c.icon && (
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl border ${c.chip}`}>
                <c.icon size={19} />
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="glass mt-5 overflow-hidden rounded-card">
        {loading && !data ? (
          <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
        ) : !data || data.items.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="font-display text-lg font-semibold text-fg">No transactions found</p>
            <p className="mt-1 text-sm text-fg-2">Try clearing filters or make your first deposit.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-fg-3">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Reference ID</th>
                    <th className="px-4 py-3 text-right font-medium">Balance Before</th>
                    <th className="px-4 py-3 text-right font-medium">Balance After</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((t) => (
                    <tr key={t.id} className="border-b border-line/60 transition last:border-0 hover:bg-white/[2%]">
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="text-fg-2">{day(t.createdAt)}</p>
                        <p className="text-[11px] text-fg-3">{time(t.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3"><TypeChip type={t.type} /></td>
                      <td className="max-w-56 truncate px-4 py-3 text-fg-2">{t.description ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 font-mono text-xs text-fg-2">
                          {t.reference ?? '—'} {t.reference && <CopyChip value={t.reference} />}
                        </span>
                      </td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right text-fg-2">{two(t.balanceBefore)}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right text-fg-2">{two(t.balanceAfter)}</td>
                      <td className={`tabular whitespace-nowrap px-4 py-3 text-right font-bold ${t.direction === 'CREDIT' ? 'text-success' : 'text-danger'}`}>
                        {t.direction === 'CREDIT' ? '+' : '-'}{two(t.amount)}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3.5">
              <p className="text-xs text-fg-3">
                Showing {(data.page - 1) * data.pageSize + 1} to {Math.min(data.page * data.pageSize, data.total)} of {data.total} transactions
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data.page <= 1}
                  className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-2 disabled:opacity-40"
                  aria-label="Previous page"
                >‹</button>
                {pageNumbers[0] !== 1 && (
                  <>
                    <button onClick={() => setPage(1)} className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-xs text-fg-2">1</button>
                    <span className="text-fg-3">…</span>
                  </>
                )}
                {pageNumbers.map((n) => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`flex h-8 w-8 items-center justify-center rounded-input text-xs font-bold ${
                      n === data.page ? 'bg-accent text-white' : 'border border-line text-fg-2 hover:text-fg'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                {pageNumbers[pageNumbers.length - 1] !== pages && pages > 5 && (
                  <>
                    <span className="text-fg-3">…</span>
                    <button onClick={() => setPage(pages)} className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-xs text-fg-2">{pages}</button>
                  </>
                )}
                <button
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  disabled={data.page >= pages}
                  className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-2 disabled:opacity-40"
                  aria-label="Next page"
                >›</button>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="ml-2 rounded-input border border-line bg-white/[2%] px-2 py-1.5 text-xs text-fg-2 outline-none [color-scheme:dark]"
                  aria-label="Rows per page"
                >
                  {[10, 20, 50].map((n) => <option key={n} value={n}>{n} per page</option>)}
                </select>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
