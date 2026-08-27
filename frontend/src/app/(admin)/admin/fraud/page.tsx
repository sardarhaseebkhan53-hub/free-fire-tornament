'use client';
// Fraud & abuse review — Phase 14.
//
// Every alert here was raised by a detector that DELIBERATELY does nothing
// except write a row: no balance moved, no account was locked. A human decides.
import { useState } from 'react';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Kpi, Modal, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api } from '@/lib/client-api';

interface Row {
  id: string;
  kind: string;
  label: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: string;
  details: Record<string, unknown> | null;
  user: { id: string; username: string; email: string } | null;
  reviewedAt: string | null;
  createdAt: string;
}
interface Page {
  items: Row[]; total: number; page: number; pageSize: number;
  statusCounts: Record<string, number>;
}

const TABS = [
  ['OPEN', 'Open'],
  ['REVIEWED', 'Reviewed'],
  ['DISMISSED', 'Dismissed'],
] as const;

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-danger/15 text-danger border-danger/30',
  HIGH: 'bg-warning/15 text-warning border-warning/30',
  MEDIUM: 'bg-accent/15 text-accent border-accent/30',
  LOW: 'bg-white/5 text-fg-3 border-line',
};

function detailRows(details: Record<string, unknown> | null): Array<[string, string]> {
  if (!details) return [];
  return Object.entries(details)
    .filter(([k]) => !['fingerprint'].includes(k))
    .map(([k, v]) => [
      k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
      typeof v === 'object' ? JSON.stringify(v) : String(v),
    ]);
}

export default function AdminFraudPage() {
  const [tab, setTab] = useState<string>('OPEN');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Row | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, loading, setData } = useAdminList<Page>(
    `/admin/fraud?status=${tab}&page=${page}&pageSize=15`,
    [tab, page],
  );

  async function decide(action: 'REVIEWED' | 'DISMISSED') {
    if (!open) return;
    setBusy(true);
    try {
      await api(`/admin/fraud/${open.id}/review`, { method: 'POST', body: { action, note } });
      setOpen(null);
      setNote('');
      const fresh = await fetch(`/api/backend/admin/fraud?status=${tab}&page=${page}&pageSize=15`, {
        headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` },
      }).then((r) => r.json());
      if (fresh.success) setData(fresh.data);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  const counts = data?.statusCounts ?? {};
  const sorted = [...(data?.items ?? [])].sort(
    (a, b) =>
      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.severity) -
      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.severity),
  );

  return (
    <div>
      <AdminPageTitle
        title="Fraud & Abuse"
        sub="Automatic detectors flag patterns — they never move money or lock accounts. You decide."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open alerts" value={String(counts.OPEN ?? 0)} icon={<AlertTriangle className="h-4 w-4" />} />
        <Kpi label="Reviewed" value={String(counts.REVIEWED ?? 0)} icon={<ShieldCheck className="h-4 w-4" />} />
        <Kpi label="Dismissed" value={String(counts.DISMISSED ?? 0)} />
        <Kpi label="Critical / High" value={String(sorted.filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH').length)} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); }}
            className={`rounded-input px-4 py-2 text-xs font-bold transition ${tab === key ? 'bg-accent text-white' : 'border border-line bg-white/[2%] text-fg-2 hover:text-fg'}`}
          >
            {label}
            {counts[key] ? <span className="ml-1.5 opacity-70">{counts[key]}</span> : null}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : sorted.length === 0 ? (
        <div className="rounded-card border border-line bg-white/[2%] p-10 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-success" />
          <p className="mt-3 font-display text-base font-bold text-fg">Nothing flagged</p>
          <p className="mt-1 text-xs text-fg-3">
            Detectors watch deposits, withdrawals, logins, registrations, joins, coupons and result claims.
          </p>
        </div>
      ) : (
        <>
          <Table head={['Severity', 'Signal', 'Player', 'Detail', 'When', 'Status', '']}>
            {sorted.map((a) => (
              <Tr key={a.id}>
                <Td>
                  <span className={`inline-flex rounded-pill border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[a.severity]}`}>
                    {a.severity}
                  </span>
                </Td>
                <Td>
                  <p className="font-semibold text-fg">{a.kind.replaceAll('_', ' ')}</p>
                  <p className="max-w-[34ch] text-[11px] text-fg-3">{a.label}</p>
                </Td>
                <Td>
                  {a.user ? (
                    <>
                      <p className="font-semibold text-fg">{a.user.username}</p>
                      <p className="text-[11px] text-fg-3">{a.user.email}</p>
                    </>
                  ) : (
                    <span className="text-xs text-fg-3">—</span>
                  )}
                </Td>
                <Td className="max-w-[42ch] text-xs text-fg-2">{String(a.details?.title ?? '—')}</Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">
                  {new Date(a.createdAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                </Td>
                <Td><Pill status={a.status} /></Td>
                <Td>
                  <button
                    onClick={() => { setOpen(a); setNote(''); }}
                    className="rounded-input border border-line px-2.5 py-1 text-[11px] font-bold text-fg-2 hover:text-accent"
                  >
                    Review
                  </button>
                </Td>
              </Tr>
            ))}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}

      {open && (
        <Modal title={open.kind.replaceAll('_', ' ')} onClose={() => setOpen(null)} wide>
          <p className="text-sm text-fg-2">{open.label}</p>
          <div className="mt-4 rounded-card border border-line bg-white/[3%] p-3.5">
            <p className="text-[11px] font-bold uppercase text-fg-3">Evidence</p>
            <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {detailRows(open.details).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wide text-fg-3">{k}</dt>
                  <dd className="truncate text-xs text-fg-2" title={v}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <label className="mt-4 block text-[11px] font-bold uppercase text-fg-3" htmlFor="fraud-note">
            Review note (stored on the alert + audit trail)
          </label>
          <textarea
            id="fraud-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="What did you check, and what did you decide?"
            className="mt-1.5 w-full rounded-input border border-line bg-white/[3%] p-3 text-sm text-fg outline-none focus:border-accent"
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              onClick={() => decide('DISMISSED')}
              disabled={busy}
              className="rounded-input border border-line px-4 py-2 text-xs font-bold text-fg-2 hover:text-fg disabled:opacity-50"
            >
              Dismiss (false positive)
            </button>
            <button
              onClick={() => decide('REVIEWED')}
              disabled={busy}
              className="rounded-input bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Mark reviewed'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
