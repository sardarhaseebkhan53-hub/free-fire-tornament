'use client';
// Wallet transfers — platform-wide view (design 33 style, read-only).
// Every user-to-user transfer with sender → recipient, amount, note, time.
// High-value transfers also raise fraud alerts (see Fraud & Abuse).
import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Pager, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { fmt, fmtDate } from '@/lib/format';

interface Row {
  id: string; amount: number; note: string | null; status: string; createdAt: string;
  senderUsername: string; recipientUsername: string;
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

export default function AdminTransfersPage() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading } = useAdminList<Page>(
    `/admin/transfers?page=${page}&pageSize=25${q ? `&search=${encodeURIComponent(q)}` : ''}`,
    [q, page],
  );

  return (
    <div>
      <AdminPageTitle
        title="Wallet Transfers"
        sub="User-to-user PKR transfers — atomic, idempotent, both sides recorded in the immutable ledger."
      />

      <form
        className="mb-4 flex max-w-md gap-2"
        onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(1); }}
      >
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search username or note…"
            className="w-full rounded-input border border-line bg-white/[3%] py-2.5 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
          />
        </div>
        <button className="rounded-input bg-accent px-4 text-xs font-bold text-white">Search</button>
      </form>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['When', 'From', 'To', 'Amount', 'Note', 'Ref']}>
            {data?.items.map((t) => (
              <Tr key={t.id}>
                <Td className="whitespace-nowrap text-xs text-fg-3">{fmtDate(t.createdAt)}</Td>
                <Td className="font-semibold text-fg">@{t.senderUsername}</Td>
                <Td className="font-semibold text-fg">@{t.recipientUsername}</Td>
                <Td className="tabular font-bold text-fg">{fmt(t.amount, 2)}</Td>
                <Td className="max-w-60 truncate text-xs text-fg-2">{t.note ?? '—'}</Td>
                <Td className="font-mono text-xs text-fg-3">{t.id.slice(-8)}</Td>
              </Tr>
            ))}
          </Table>
          {data && data.items.length === 0 && (
            <p className="py-10 text-center text-sm text-fg-3">No transfers match this filter.</p>
          )}
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
