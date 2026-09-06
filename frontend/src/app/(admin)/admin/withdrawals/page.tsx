'use client';
// Withdrawals — the admin PAYOUT DESK (design 33): PENDING → APPROVED →
// PROCESSING → PAID (with payout reference), or REJECT with reversal.
//
// The admin is the person who actually sends the money, so this screen shows the
// COMPLETE destination account — holder name, full account/phone number, method
// and any bank details — in the table and in every action popup, each with a
// one-tap copy. Masking (`0300•••123`) stays on the player-facing screens only.
import { useEffect, useState } from 'react';
import { Check, Copy, Download, Eye, Loader2, Search, X } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Modal, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api, apiGet, downloadProtectedFile } from '@/lib/client-api';
import { deferLoad } from '@/lib/session';

interface PayerUser {
  id: string; username: string; email: string; phone: string | null;
  status: string; role: string; isVerified: boolean; joinedAt: string;
  fullName: string | null; freeFireUID: string | null; freeFireIGN: string | null;
  city: string | null; country: string | null;
  wallet: { cash: number; winning: number; bonus: number; locked: number };
}
interface PayoutHistory {
  paidCount: number; paidTotal: number; pendingCount: number;
  openCount: number; rejectedCount: number; totalCount: number;
}
interface Row {
  id: string; amount: number; method: string; methodLabel: string;
  accountName: string; accountNumber: string; accountMasked: string; accountDetails: string | null;
  status: string; adminNote: string | null; paidReference: string | null;
  reviewedAt: string | null; paidAt: string | null; createdAt: string;
  reviewedBy: string | null; user: PayerUser; history: PayoutHistory;
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

interface Detail extends Row {
  fee: number; net: number; currency: string;
  ledger: Array<{
    id: string; bucket: string; type: string; direction: string; amount: number;
    balanceBefore: number; balanceAfter: number; reference: string | null;
    description: string | null; status: string; createdAt: string;
  }>;
  audit: Array<{
    id: string; action: string; by: string; ip: string | null;
    before: unknown; after: unknown; createdAt: string;
  }>;
  recentWithdrawals: Array<{
    id: string; amount: number; method: string; methodLabel: string;
    accountMasked: string; status: string; paidReference: string | null; createdAt: string;
  }>;
}

const TABS = [
  ['PENDING', 'Pending'],
  ['APPROVED', 'Approved'],
  ['PROCESSING', 'Processing'],
  ['PAID', 'Paid'],
  ['REJECTED', 'Rejected'],
] as const;

const METHODS = [
  ['', 'All methods'],
  ['JAZZCASH', 'JazzCash'],
  ['EASYPAISA', 'EasyPaisa'],
  ['NAYAPAY', 'NayaPay'],
  ['SADAPAY', 'SadaPay'],
  ['BANK_TRANSFER', 'Bank Transfer'],
] as const;

const NEXT: Record<string, { action: string; label: string; needsRef?: boolean }> = {
  PENDING: { action: 'APPROVE', label: 'Approve' },
  APPROVED: { action: 'PROCESS', label: 'Mark Processing' },
  PROCESSING: { action: 'PAID', label: 'Mark Paid', needsRef: true },
};

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;
const when = (d: string | null) => (d
  ? new Date(d).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
  : '—');

export default function AdminWithdrawalsPage() {
  const [tab, setTab] = useState('PENDING');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ row: Row; action: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const params = new URLSearchParams({ status: tab, page: String(page), pageSize: '15' });
  if (method) params.set('method', method);
  if (q.trim()) params.set('q', q.trim());
  const path = `/admin/withdrawals?${params}`;
  const { data, loading, setData } = useAdminList<Page>(path, [tab, method, q, page]);

  async function refresh() {
    const fresh = await apiGet<Page>(path);
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

  function exportCsv() {
    const csvParams = new URLSearchParams(params);
    csvParams.set('format', 'csv');
    csvParams.set('pageSize', '200');
    downloadProtectedFile(`/admin/withdrawals?${csvParams}`, 'clutchnex-withdrawals.csv')
      .catch((e) => alert(e instanceof Error ? e.message : 'Export failed — try again.'));
  }

  const pendingTotal = (data?.items ?? [])
    .filter((w) => ['PENDING', 'APPROVED', 'PROCESSING'].includes(w.status))
    .reduce((s, w) => s + w.amount, 0);

  return (
    <div>
      <AdminPageTitle
        title="Withdrawals"
        sub="Payout desk — the complete destination account is shown for every request so you can send the money, then approve, process, mark paid with the reference, or reject to release the holding."
        action={
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-input bg-accent px-4 py-2.5 text-sm font-bold text-white">
            <Download size={15} /> Export CSV
          </button>
        }
      />

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

      {/* Filters — search hits the real account number too, so you can paste the
          number you are about to pay and find the request instantly. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search account no, title, player, email, phone, FF UID, reference…"
            className="w-[22rem] max-w-full rounded-input border border-line bg-white/[3%] py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
          />
        </div>
        <select
          value={method}
          onChange={(e) => { setMethod(e.target.value); setPage(1); }}
          className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]"
        >
          {METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {pendingTotal > 0 && (
          <span className="rounded-input border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-bold text-warning">
            {pkr(pendingTotal)} to pay on this page
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['Player', 'Amount', 'Method', 'Pay To (complete account)', 'Status', 'Requested', 'Actions']}>
            {data?.items.map((w) => (
              <Tr key={w.id}>
                <Td>
                  <p className="font-semibold text-fg">{w.user.username}</p>
                  {w.user.fullName && <p className="text-[11px] text-fg-2">{w.user.fullName}</p>}
                  <p className="text-[11px] text-fg-3">{w.user.email}</p>
                  <p className="text-[11px] text-fg-3">
                    {w.user.phone ?? 'no phone'}{w.user.freeFireUID ? ` · UID ${w.user.freeFireUID}` : ''}
                  </p>
                </Td>
                <Td>
                  <p className="tabular font-bold text-fg">{pkr(w.amount)}</p>
                  <p className="text-[10px] text-fg-3">
                    {w.history.paidCount} paid before · {pkr(w.history.paidTotal)}
                  </p>
                </Td>
                <Td><span className="text-xs text-fg-2">{w.methodLabel}</span></Td>
                <Td>
                  {/* The whole point of this screen: nothing hidden, one tap to copy. */}
                  <p className="text-[11px] font-semibold text-fg-2">{w.accountName}</p>
                  <CopyValue value={w.accountNumber} mono strong />
                  {w.accountDetails && <p className="mt-0.5 text-[11px] text-fg-3">{w.accountDetails}</p>}
                  <CopyPayout row={w} />
                </Td>
                <Td>
                  <Pill status={w.status} />
                  {w.paidReference && <p className="mt-0.5 font-mono text-[10px] text-fg-3">{w.paidReference}</p>}
                  {w.reviewedBy && <p className="mt-0.5 text-[10px] text-fg-3">by {w.reviewedBy}</p>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{when(w.createdAt)}</Td>
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
                    <button
                      onClick={() => setDetailId(w.id)}
                      className="inline-flex items-center gap-1 rounded-input border border-line px-2.5 py-1 text-[11px] font-bold text-fg-2 hover:border-accent/40 hover:text-accent"
                    >
                      <Eye size={12} /> Full details
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
            {data?.items.length === 0 && (
              <Tr><Td className="py-8 text-center text-fg-3">No {tab.toLowerCase()} withdrawals{q.trim() ? ` for “${q.trim()}”` : ''}.</Td></Tr>
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

      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy helpers — the admin must never re-type an account number by hand.
// ---------------------------------------------------------------------------

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function useCopied() {
  const [copied, setCopied] = useState(false);
  const copy = async (value: string) => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      alert('Copy failed — select the text and copy manually.');
    }
  };
  return { copied, copy };
}

/** A value shown in full with its own copy button. */
function CopyValue({ value, mono, strong, label }: { value: string; mono?: boolean; strong?: boolean; label?: string }) {
  const { copied, copy } = useCopied();
  return (
    <span className="mt-0.5 flex items-center gap-1.5">
      {label && <span className="text-[10px] uppercase tracking-wide text-fg-3">{label}</span>}
      <span
        className={`select-all break-all text-fg ${mono ? 'font-mono' : ''} ${strong ? 'text-sm font-bold' : 'text-xs'}`}
        title={value}
      >
        {value}
      </span>
      <button
        onClick={() => void copy(value)}
        aria-label={`Copy ${label ?? 'value'}`}
        title="Copy"
        className="inline-flex shrink-0 items-center gap-1 rounded-input border border-line px-1.5 py-0.5 text-[10px] font-bold text-fg-3 transition hover:border-accent/40 hover:text-accent"
      >
        {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
        {copied ? 'Copied' : ''}
      </button>
    </span>
  );
}

/** Copies the whole payout instruction as one block (paste into notes/WhatsApp). */
function CopyPayout({ row }: { row: Row }) {
  const { copied, copy } = useCopied();
  const block = [
    `Player: ${row.user.username}${row.user.fullName ? ` (${row.user.fullName})` : ''}`,
    `Amount: ${pkr(row.amount)}`,
    `Method: ${row.methodLabel}`,
    `Account title: ${row.accountName}`,
    `Account number: ${row.accountNumber}`,
    row.accountDetails ? `Details: ${row.accountDetails}` : '',
  ].filter(Boolean).join('\n');
  return (
    <button
      onClick={() => void copy(block)}
      className="mt-1 inline-flex items-center gap-1 rounded-input border border-line px-2 py-0.5 text-[10px] font-bold text-fg-3 transition hover:border-accent/40 hover:text-accent"
    >
      {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
      {copied ? 'Payout details copied' : 'Copy payout details'}
    </button>
  );
}

/** The "send the money" block repeated in the action popup and the dossier. */
function PayoutCard({ row, fee, net }: { row: Row; fee?: number; net?: number }) {
  return (
    <div className="rounded-input border border-accent/30 bg-accent/[6%] p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Send this payment</p>
      <p className="tabular mt-1 font-display text-2xl font-bold text-fg">{pkr(row.amount)}</p>
      {typeof fee === 'number' && fee > 0 && (
        <p className="text-[11px] text-fg-3">Fee {pkr(fee)} · player receives {pkr(net ?? row.amount - fee)}</p>
      )}
      <div className="mt-2.5 space-y-1.5 border-t border-accent/20 pt-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-fg-3">Account title</p>
          <CopyValue value={row.accountName} strong />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-fg-3">
            {row.method === 'BANK_TRANSFER' ? 'Account / IBAN' : 'Mobile account number'}
          </p>
          <CopyValue value={row.accountNumber} mono strong />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-2">
          <span>{row.methodLabel}</span>
          {row.accountDetails && <span>{row.accountDetails}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action popup — approve / process / mark paid / reject
// ---------------------------------------------------------------------------

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
    REJECT: { title: 'Reject withdrawal', hint: 'Returns the holding to the player’s balance.', cta: 'Reject & release', tone: 'bg-danger' },
  };
  const c = copy[action]!;

  return (
    <Modal title={c.title} onClose={onClose}>
      <p className="text-sm text-fg-2">{c.hint}</p>

      {/* Complete destination account, copyable — this is what the admin pays. */}
      <div className="mt-3">
        <PayoutCard row={row} />
      </div>

      <div className="mt-3 rounded-input border border-line bg-white/[3%] p-3 text-xs text-fg-3">
        <p><b className="text-fg-2">{row.user.username}</b> · {row.user.email} · {row.user.phone ?? 'no phone'}</p>
        {row.user.freeFireUID && <p>FF UID {row.user.freeFireUID}{row.user.freeFireIGN ? ` · ${row.user.freeFireIGN}` : ''}</p>}
        <p>Wallet now — Winning {pkr(row.user.wallet.winning)} · Cash {pkr(row.user.wallet.cash)}</p>
        <p>History — {row.history.paidCount} paid ({pkr(row.history.paidTotal)}) · {row.history.openCount} open · {row.history.rejectedCount} rejected</p>
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

// ---------------------------------------------------------------------------
// Full dossier — everything about one payout on a single screen
// ---------------------------------------------------------------------------

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);

  // Fetch on open. deferLoad keeps the setState out of the commit phase, the
  // same pattern useAdminList uses everywhere else in the admin kit.
  useEffect(() => {
    let cancelled = false;
    deferLoad(() => apiGet<Detail>(`/admin/withdrawals/${id}`)
      .then((d) => { if (!cancelled) { if (d) setDetail(d); else setFailed(true); } })
      .catch(() => { if (!cancelled) setFailed(true); }));
    return () => { cancelled = true; };
  }, [id]);

  return (
    <Modal title="Withdrawal — full details" onClose={onClose} wide>
      {!detail && !failed && (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-accent" /></div>
      )}
      {failed && <p className="py-10 text-center text-sm text-fg-3">Could not load this withdrawal.</p>}
      {detail && (
        <div className="space-y-4">
          <PayoutCard row={detail} fee={detail.fee} net={detail.net} />

          <section>
            <SectionTitle>Player</SectionTitle>
            <div className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
              <Info label="Username" value={detail.user.username} />
              <Info label="Full name" value={detail.user.fullName ?? '—'} />
              <Info label="Email" value={detail.user.email} copy />
              <Info label="Phone" value={detail.user.phone ?? '—'} copy={!!detail.user.phone} />
              <Info label="FF UID" value={detail.user.freeFireUID ?? '—'} copy={!!detail.user.freeFireUID} />
              <Info label="FF name" value={detail.user.freeFireIGN ?? '—'} />
              <Info label="City / Country" value={[detail.user.city, detail.user.country].filter(Boolean).join(', ') || '—'} />
              <Info label="Account" value={`${detail.user.status}${detail.user.isVerified ? ' · verified' : ' · unverified'} · joined ${when(detail.user.joinedAt)}`} />
            </div>
          </section>

          <section>
            <SectionTitle>Wallet & payout history</SectionTitle>
            <div className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
              <Info label="Winning balance" value={pkr(detail.user.wallet.winning)} />
              <Info label="Cash balance" value={pkr(detail.user.wallet.cash)} />
              <Info label="Bonus / Locked" value={`${pkr(detail.user.wallet.bonus)} / ${pkr(detail.user.wallet.locked)}`} />
              <Info label="Lifetime paid" value={`${detail.history.paidCount} withdrawals · ${pkr(detail.history.paidTotal)}`} />
              <Info label="Open requests" value={String(detail.history.openCount)} />
              <Info label="Rejected" value={String(detail.history.rejectedCount)} />
            </div>
          </section>

          <section>
            <SectionTitle>This request</SectionTitle>
            <div className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
              <Info label="Amount" value={`${pkr(detail.amount)} (${detail.currency})`} />
              <Info label="Fee / net" value={`${pkr(detail.fee)} / ${pkr(detail.net)}`} />
              <Info label="Method" value={detail.methodLabel} />
              <Info label="Status" value={detail.status} />
              <Info label="Requested" value={when(detail.createdAt)} />
              <Info label="Reviewed" value={`${when(detail.reviewedAt)}${detail.reviewedBy ? ` by ${detail.reviewedBy}` : ''}`} />
              <Info label="Paid at" value={when(detail.paidAt)} />
              <Info label="Payout reference" value={detail.paidReference ?? '—'} copy={!!detail.paidReference} />
              <Info label="Account title" value={detail.accountName} copy />
              <Info label="Account number" value={detail.accountNumber} mono copy />
              <Info label="Account details" value={detail.accountDetails ?? '—'} />
              <Info label="Admin note" value={detail.adminNote ?? '—'} />
              <Info label="Withdrawal ID" value={detail.id} mono copy />
            </div>
          </section>

          <section>
            <SectionTitle>Wallet ledger entries for this payout</SectionTitle>
            {detail.ledger.length === 0 ? (
              <p className="text-xs text-fg-3">No ledger entries.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase text-fg-3">
                      <th className="py-1.5">When</th><th className="py-1.5">Type</th>
                      <th className="py-1.5">Bucket</th><th className="py-1.5 text-right">Amount</th>
                      <th className="py-1.5 text-right">Balance after</th><th className="py-1.5">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.ledger.map((t) => (
                      <tr key={t.id} className="border-b border-line/50">
                        <td className="py-1.5 whitespace-nowrap text-fg-3">{when(t.createdAt)}</td>
                        <td className="py-1.5 font-semibold text-fg">{t.type.replace(/_/g, ' ')}</td>
                        <td className="py-1.5 text-fg-2">{t.bucket} · {t.direction}</td>
                        <td className="tabular py-1.5 text-right text-fg">{pkr(t.amount)}</td>
                        <td className="tabular py-1.5 text-right text-fg-2">{pkr(t.balanceAfter)}</td>
                        <td className="py-1.5 font-mono text-fg-3">{t.reference ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {detail.recentWithdrawals.length > 0 && (
            <section>
              <SectionTitle>Player’s other withdrawals</SectionTitle>
              <div className="space-y-1 text-[11px]">
                {detail.recentWithdrawals.map((r) => (
                  <p key={r.id} className="flex flex-wrap items-center gap-x-2 text-fg-3">
                    <span className="tabular font-bold text-fg-2">{pkr(r.amount)}</span>
                    <span>{r.methodLabel}</span>
                    <span className="font-mono">{r.accountMasked}</span>
                    <Pill status={r.status} />
                    <span>{when(r.createdAt)}</span>
                  </p>
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle>Audit trail</SectionTitle>
            {detail.audit.length === 0 ? (
              <p className="text-xs text-fg-3">Nothing recorded yet.</p>
            ) : (
              <div className="space-y-1.5 text-[11px]">
                {detail.audit.map((a) => (
                  <div key={a.id} className="rounded-input border border-line bg-white/[2%] px-2.5 py-1.5">
                    <p className="font-bold text-fg-2">{a.action.replace(/_/g, ' ')} <span className="font-normal text-fg-3">· {a.by} · {when(a.createdAt)}{a.ip ? ` · ${a.ip}` : ''}</span></p>
                    {(a.before || a.after) ? (
                      <p className="mt-0.5 break-all font-mono text-[10px] text-fg-3">
                        {a.before ? `before ${JSON.stringify(a.before)} → ` : ''}{a.after ? JSON.stringify(a.after) : ''}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-fg-3">{children}</p>;
}

function Info({ label, value, mono, copy }: { label: string; value: string; mono?: boolean; copy?: boolean }) {
  const { copied, copy: doCopy } = useCopied();
  return (
    <div className="flex items-start justify-between gap-2 border-b border-line/40 py-1">
      <span className="shrink-0 text-fg-3">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-right">
        <span className={`break-all text-fg-2 ${mono ? 'font-mono' : ''}`}>{value}</span>
        {copy && (
          <button
            onClick={() => void doCopy(value)}
            aria-label={`Copy ${label}`}
            title="Copy"
            className="shrink-0 rounded-input border border-line px-1 py-0.5 text-fg-3 transition hover:border-accent/40 hover:text-accent"
          >
            {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
          </button>
        )}
      </span>
    </div>
  );
}
