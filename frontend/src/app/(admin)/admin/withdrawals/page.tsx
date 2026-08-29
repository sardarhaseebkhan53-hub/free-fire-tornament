'use client';
// Withdrawals review — design 33: approval chain PENDING → APPROVED →
// PROCESSING → PAID (with payout reference), or REJECT with reversal.
import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Modal, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api , apiGet } from '@/lib/client-api';

interface Row {
  id: string; amount: number; method: string; methodLabel: string;
  accountName: string; accountMasked: string; accountDetails: string | null;
  status: string; adminNote: string | null; paidReference: string | null; createdAt: string;
  user: { username: string; email: string };
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

const TABS = [
  ['PENDING', 'Pending'],
  ['APPROVED', 'Approved'],
  ['PROCESSING', 'Processing'],
  ['PAID', 'Paid'],
  ['REJECTED', 'Rejected'],
] as const;

const NEXT: Record<string, { action: string; label: string; needsRef?: boolean }> = {
  PENDING: { action: 'APPROVE', label: 'Approve' },
  APPROVED: { action: 'PROCESS', label: 'Mark Processing' },
  PROCESSING: { action: 'PAID', label: 'Mark Paid', needsRef: true },
};

export default function AdminWithdrawalsPage() {
  const [tab, setTab] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ row: Row; action: string } | null>(null);
  const { data, loading, setData } = useAdminList<Page>(`/admin/withdrawals?status=${tab}&page=${page}&pageSize=15`, [tab, page]);

  async function refresh() {
    const fresh = await apiGet<Page>(`/admin/withdrawals?status=${tab}&page=${page}&pageSize=15`);
    if (fresh) setData(fresh);
  }

  async function run(row: Row, action: string, extra: { note?: string; paidReference?: string }) {
    try {
      await api(`/admin/withdrawals/${row.id}/review`, { method: 'POST', body: { action, ...extra } });
      setModal(null);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    }
  }

  return (
    <div>
      <AdminPageTitle title="Withdrawals" sub="Approval chain — approve, process, mark paid with the payout reference, or reject to release the holding." />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); }}
            className={`rounded-input px-4 py-2 text-xs font-bold transition ${tab === key ? 'bg-accent text-white' : 'border border-line bg-white/[2%] text-fg-2 hover:text-fg'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['Player', 'Amount', 'Method', 'Account', 'Status', 'Requested', 'Actions']}>
            {data?.items.map((w) => (
              <Tr key={w.id}>
                <Td>
                  <p className="font-semibold text-fg">{w.user.username}</p>
                  <p className="text-[11px] text-fg-3">{w.accountName}</p>
                </Td>
                <Td className="tabular font-bold text-fg">PKR {w.amount.toLocaleString('en-PK')}</Td>
                <Td><span className="text-xs text-fg-2">{w.methodLabel}</span></Td>
                <Td><span className="font-mono text-xs text-fg-2">{w.accountMasked}</span></Td>
                <Td>
                  <Pill status={w.status} />
                  {w.paidReference && <p className="mt-0.5 font-mono text-[10px] text-fg-3">{w.paidReference}</p>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(w.createdAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {NEXT[w.status] && (
                      <button
                        onClick={() => setModal({ row: w, action: NEXT[w.status]!.action })}
                        className="inline-flex items-center gap-1 rounded-input bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent"
                      >
                        <Check size={12} /> {NEXT[w.status]!.label}
                      </button>
                    )}
                    {['PENDING', 'APPROVED', 'PROCESSING'].includes(w.status) && (
                      <button
                        onClick={() => setModal({ row: w, action: 'REJECT' })}
                        className="inline-flex items-center gap-1 rounded-input bg-danger/15 px-2.5 py-1 text-[11px] font-bold text-danger"
                      >
                        <X size={12} /> Reject
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
            {data?.items.length === 0 && (
              <Tr><Td className="py-8 text-center text-fg-3">No {tab.toLowerCase()} withdrawals.</Td></Tr>
            )}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}

      {modal && (
        <WithdrawModal
          row={modal.row}
          action={modal.action}
          onClose={() => setModal(null)}
          onConfirm={(note, ref) => run(modal.row, modal.action, { note, paidReference: ref })}
        />
      )}
    </div>
  );
}

function WithdrawModal({ row, action, onClose, onConfirm }: {
  row: Row; action: string; onClose: () => void; onConfirm: (note: string, ref: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);

  const copy: Record<string, { title: string; hint: string; cta: string; tone: string }> = {
    APPROVE: { title: 'Approve withdrawal', hint: 'Queued for payout.', cta: 'Approve', tone: 'bg-accent' },
    PROCESS: { title: 'Mark processing', hint: 'Funds are being sent.', cta: 'Mark Processing', tone: 'bg-info' },
    PAID: { title: 'Mark paid', hint: 'Requires the payout transaction reference.', cta: 'Mark Paid', tone: 'bg-success' },
    REJECT: { title: 'Reject withdrawal', hint: 'Returns the holding to the player’s Winning balance.', cta: 'Reject & release', tone: 'bg-danger' },
  };
  const c = copy[action]!;

  return (
    <Modal title={c.title} onClose={onClose}>
      <p className="text-sm text-fg-2">{c.hint}</p>
      <div className="mt-3 rounded-input border border-line bg-white/[3%] p-3 text-sm">
        <p className="font-bold text-fg">{row.user.username} — PKR {row.amount.toLocaleString('en-PK')}</p>
        <p className="mt-0.5 text-xs text-fg-3">{row.methodLabel} · {row.accountMasked} · {row.accountName}</p>
      </div>
      {action === 'PAID' && (
        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Payout reference *</span>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. EWP-991199"
            className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent" />
        </label>
      )}
      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-semibold text-fg-2">Note {action === 'REJECT' ? '(shared with the player)' : '(optional)'}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <button
        onClick={async () => { setBusy(true); await onConfirm(note, ref); setBusy(false); }}
        disabled={busy || (action === 'PAID' && !ref.trim())}
        className={`mt-4 flex w-full items-center justify-center gap-2 rounded-input py-2.5 text-sm font-bold text-white disabled:opacity-50 ${c.tone}`}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : null} {c.cta}
      </button>
    </Modal>
  );
}
