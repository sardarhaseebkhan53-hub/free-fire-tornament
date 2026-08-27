'use client';
// Deposits review — design 32: status tabs, screenshot proof viewer,
// approve (credits the ledger) / reject with note.
import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { AuthedImage, Modal, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api } from '@/lib/client-api';

interface Row {
  id: string; amount: number; method: string; methodLabel: string; transactionId: string;
  senderName: string; senderAccount: string | null; status: string; adminNote: string | null;
  screenshot: string | null; createdAt: string;
  user: { username: string; email: string };
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

const TABS = [
  ['PENDING', 'Pending'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
] as const;

export default function AdminDepositsPage() {
  const [tab, setTab] = useState<string>('PENDING');
  const [page, setPage] = useState(1);
  const [review, setReview] = useState<{ row: Row; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [proof, setProof] = useState<Row | null>(null);
  const { data, loading, setData } = useAdminList<Page>(`/admin/deposits?status=${tab}&page=${page}&pageSize=15`, [tab, page]);

  async function decide(action: 'APPROVE' | 'REJECT', note: string) {
    if (!review) return;
    try {
      await api(`/admin/deposits/${review.row.id}/review`, { method: 'POST', body: { action, note } });
      setReview(null);
      const fresh = await fetch(`/api/backend/admin/deposits?status=${tab}&page=${page}&pageSize=15`,
        { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } }).then((r) => r.json());
      if (fresh.success) setData(fresh.data);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Review failed');
    }
  }

  return (
    <div>
      <AdminPageTitle title="Deposits" sub="Manual payment proofs — approve to credit the cash ledger exactly once." />

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
          <Table head={['Player', 'Amount', 'Method', 'Transaction ID', 'Sender', 'Status', 'Date', 'Actions']}>
            {data?.items.map((d) => (
              <Tr key={d.id}>
                <Td>
                  <p className="font-semibold text-fg">{d.user.username}</p>
                  <p className="text-[11px] text-fg-3">{d.user.email}</p>
                </Td>
                <Td className="tabular font-bold text-success">PKR {d.amount.toLocaleString('en-PK')}</Td>
                <Td><span className="text-xs text-fg-2">{d.methodLabel}</span></Td>
                <Td><span className="font-mono text-xs text-fg-2">{d.transactionId}</span></Td>
                <Td>
                  <p className="text-xs text-fg-2">{d.senderName}</p>
                  <p className="text-[11px] text-fg-3">{d.senderAccount ?? '—'}</p>
                </Td>
                <Td><Pill status={d.status} /></Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(d.createdAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {d.screenshot && (
                      <button onClick={() => setProof(d)} className="rounded-input border border-line px-2.5 py-1 text-[11px] font-bold text-fg-2 hover:text-fg">
                        Proof
                      </button>
                    )}
                    {d.status === 'PENDING' && (
                      <>
                        <button onClick={() => setReview({ row: d, action: 'APPROVE' })} className="inline-flex items-center gap-1 rounded-input bg-success/15 px-2.5 py-1 text-[11px] font-bold text-success">
                          <Check size={12} /> Approve
                        </button>
                        <button onClick={() => setReview({ row: d, action: 'REJECT' })} className="inline-flex items-center gap-1 rounded-input bg-danger/15 px-2.5 py-1 text-[11px] font-bold text-danger">
                          <X size={12} /> Reject
                        </button>
                      </>
                    )}
                    {d.status !== 'PENDING' && d.adminNote && <span className="text-[11px] text-fg-3" title={d.adminNote}>📝</span>}
                  </div>
                </Td>
              </Tr>
            ))}
            {data?.items.length === 0 && (
              <Tr><Td className="py-8 text-center text-fg-3">No {tab.toLowerCase()} deposits.</Td></Tr>
            )}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}

      {proof && (
        <Modal title={`Payment proof — ${proof.user.username}`} onClose={() => setProof(null)} wide>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p className="text-fg-2">Amount: <span className="font-bold text-success">PKR {proof.amount.toLocaleString('en-PK')}</span></p>
            <p className="text-fg-2">Method: <span className="font-bold text-fg">{proof.methodLabel}</span></p>
            <p className="text-fg-2 sm:col-span-2">TID: <span className="font-mono text-fg">{proof.transactionId}</span></p>
          </div>
          <AuthedImage src={proof.screenshot!} alt="Payment screenshot" className="mt-4 max-h-[420px] w-full rounded-card border border-line object-contain" />
        </Modal>
      )}

      {review && (
        <ReviewModal
          action={review.action}
          playerName={review.row.user.username}
          amount={review.row.amount}
          onClose={() => setReview(null)}
          onConfirm={decide}
        />
      )}
    </div>
  );
}

function ReviewModal({ action, playerName, amount, onClose, onConfirm }: {
  action: 'APPROVE' | 'REJECT'; playerName: string; amount: number;
  onClose: () => void; onConfirm: (action: 'APPROVE' | 'REJECT', note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={action === 'APPROVE' ? 'Approve deposit' : 'Reject deposit'} onClose={onClose}>
      <p className="text-sm text-fg-2">
        {action === 'APPROVE'
          ? <>Credit <span className="font-bold text-success">PKR {amount.toLocaleString('en-PK')}</span> to <span className="font-bold text-fg">{playerName}</span>&apos;s cash balance. This happens exactly once.</>
          : <>Reject <span className="font-bold text-fg">{playerName}</span>&apos;s deposit of PKR {amount.toLocaleString('en-PK')}. No money moves.</>}
      </p>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-semibold text-fg-2">Note {action === 'REJECT' ? '(shared with the player)' : '(optional)'}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === 'REJECT' ? 'e.g. TID not found in our statement' : 'internal note'}
          className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <button
        onClick={async () => { setBusy(true); await onConfirm(action, note); setBusy(false); }}
        disabled={busy}
        className={`mt-4 flex w-full items-center justify-center gap-2 rounded-input py-2.5 text-sm font-bold text-white disabled:opacity-50 ${action === 'APPROVE' ? 'bg-success' : 'bg-danger'}`}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : null}
        {action === 'APPROVE' ? 'Approve & credit' : 'Reject deposit'}
      </button>
    </Modal>
  );
}
