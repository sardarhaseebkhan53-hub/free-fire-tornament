'use client';
// Users management — design 27: search, status filters, balances, ban/unban
// and audited wallet adjustments.
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Ban, Loader2, Search, ShieldCheck, Wallet } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Kpi, Modal, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api } from '@/lib/client-api';

interface Row {
  id: string; username: string; email: string; role: string; status: string;
  isVerified: boolean; createdAt: string; lastLoginAt: string | null; ffuid: string | null;
  wallet: { cash: number; coins: number; winning: number; bonus: number } | null;
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

function UsersInner() {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [adjustFor, setAdjustFor] = useState<Row | null>(null);
  const { data, loading, setData } = useAdminList<Page>(
    `/admin/users?page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`,
    [q, status, page],
  );

  async function run(action: () => Promise<unknown>, key: string) {
    setBusy(key);
    try {
      await action();
      const fresh = await fetch(`/api/backend/admin/users?page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`,
        { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } }).then((r) => r.json());
      if (fresh.success) setData(fresh.data);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <AdminPageTitle title="Users" sub="Search players, manage account status and apply audited wallet adjustments." />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total" value={data?.total ?? '—'} tone="accent" />
        <Kpi label="Filtered" value={data?.items.length ?? 0} tone="info" />
        <Kpi label="Banned" value={data?.items.filter((u) => u.status === 'BANNED').length ?? 0} tone="danger" />
        <Kpi label="Unverified" value={data?.items.filter((u) => !u.isVerified).length ?? 0} tone="warning" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); setPage(1); }}
          className="flex flex-1 items-center gap-2 rounded-input border border-line bg-white/[3%] px-3.5 py-2 sm:max-w-sm"
        >
          <Search size={14} className="text-fg-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Username, email or FF UID…"
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
          />
        </form>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="BANNED">Banned</option>
          <option value="PENDING_VERIFICATION">Pending verification</option>
        </select>
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['User', 'Role', 'Status', 'Cash', 'Coins', 'Winning', 'Joined', 'Actions']}>
            {data?.items.map((u) => (
              <Tr key={u.id}>
                <Td>
                  <p className="font-semibold text-fg">{u.username}</p>
                  <p className="text-[11px] text-fg-3">{u.email}{u.ffuid ? ` · ${u.ffuid}` : ''}</p>
                </Td>
                <Td><span className="text-xs text-fg-2">{u.role.replace('_', ' ')}</span></Td>
                <Td>
                  <Pill status={u.status} />
                  {u.isVerified && <ShieldCheck size={12} className="ml-1.5 inline text-success" />}
                </Td>
                <Td className="tabular text-fg-2">PKR {(u.wallet?.cash ?? 0).toLocaleString('en-PK')}</Td>
                <Td className="tabular text-fg-2">{(u.wallet?.coins ?? 0).toLocaleString('en-PK')}</Td>
                <Td className="tabular text-reward">PKR {(u.wallet?.winning ?? 0).toLocaleString('en-PK')}</Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(u.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setAdjustFor(u)}
                      className="inline-flex items-center gap-1 rounded-input border border-line px-2.5 py-1 text-[11px] font-bold text-fg-2 transition hover:border-accent/40 hover:text-accent"
                    >
                      <Wallet size={12} /> Adjust
                    </button>
                    {u.status === 'BANNED' || u.status === 'SUSPENDED' ? (
                      <button
                        onClick={() => run(() => api(`/admin/users/${u.id}/status`, { method: 'POST', body: { status: 'ACTIVE', reason: 'Restored by admin' } }), u.id)}
                        disabled={busy === u.id}
                        className="rounded-input border border-success/30 px-2.5 py-1 text-[11px] font-bold text-success disabled:opacity-50"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          const reason = window.prompt(`Ban ${u.username}? Reason:`);
                          if (reason !== null) run(() => api(`/admin/users/${u.id}/status`, { method: 'POST', body: { status: 'BANNED', reason } }), u.id);
                        }}
                        disabled={busy === u.id}
                        className="inline-flex items-center gap-1 rounded-input border border-danger/30 px-2.5 py-1 text-[11px] font-bold text-danger disabled:opacity-50"
                      >
                        <Ban size={12} /> Ban
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
            {data?.items.length === 0 && (
              <Tr><Td className="py-8 text-center text-fg-3">No users match this filter.</Td></Tr>
            )}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}

      {adjustFor && (
        <AdjustModal
          user={adjustFor}
          onClose={() => setAdjustFor(null)}
          refresh={async () => {
            const fresh = await fetch('/api/backend/admin/users?page=1&pageSize=20', { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } }).then((r) => r.json());
            if (fresh.success) setData(fresh.data);
          }}
        />
      )}
    </div>
  );
}

function AdjustModal({ user, onClose, refresh }: { user: Row; onClose: () => void; refresh: () => Promise<void> }) {
  const [bucket, setBucket] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ balanceAfter: number }>(`/admin/users/${user.id}/adjust-balance`, {
        method: 'POST',
        body: { bucket, amount: Number(amount), note },
      });
      setResult(`Done — new ${bucket.toLowerCase()} balance PKR ${out.balanceAfter.toLocaleString('en-PK')}.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Adjustment failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Adjust wallet — ${user.username}`} onClose={onClose}>
      {result ? (
        <>
          <p className="rounded-input border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{result}</p>
          <button onClick={onClose} className="mt-4 w-full rounded-input bg-accent py-2.5 text-sm font-bold text-white">Close</button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-2">Bucket</span>
              <select value={bucket} onChange={(e) => setBucket(e.target.value)} className="w-full rounded-input border border-line bg-white/[3%] px-3 py-2.5 text-sm text-fg outline-none [color-scheme:dark]">
                <option value="CASH">Cash</option>
                <option value="COINS">Coins</option>
                <option value="WINNING">Winning</option>
                <option value="BONUS">Bonus</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-2">Amount (± whole PKR)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))} placeholder="e.g. 500 or -250"
                className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-2">Note (required, audited)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the adjustment"
                className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent" />
            </label>
          </div>
          {error && <p className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
          <button
            onClick={submit}
            disabled={busy || !amount || note.trim().length < 3}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-input bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : null} Apply adjustment
          </button>
        </>
      )}
    </Modal>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <UsersInner />
    </Suspense>
  );
}
