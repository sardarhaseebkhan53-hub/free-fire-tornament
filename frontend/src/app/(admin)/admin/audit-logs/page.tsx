'use client';
// Audit logs — design 40: every sensitive action, filterable, full detail.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Modal, Pager, Table, Td, Tr, useAdminList } from '@/components/admin/kit';

interface Row {
  id: string; action: string; entity: string; entityId: string | null; actor: string;
  before: unknown; after: unknown; ip: string | null; createdAt: string;
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

export default function AdminAuditLogsPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Row | null>(null);
  const { data, loading } = useAdminList<Page>(`/admin/audit-logs?page=${page}&pageSize=20${action ? `&action=${encodeURIComponent(action)}` : ''}`, [action, page]);

  return (
    <div>
      <AdminPageTitle title="Audit Logs" sub="Every balance change, approval, ban and settings edit — immutable." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Prefix-ish chips: the API filters with `contains`, so 'ROOM' catches every
            ROOM_* action (UPDATED / HIDDEN / VISIBLE / CANCELLED / REACTIVATED). */}
        {['', 'DEPOSIT', 'WITHDRAWAL', 'BALANCE_ADJUSTED', 'RESULT', 'USER_', 'SETTING', 'TOURNAMENT', 'PRIZES', 'ROOM'].map((a) => (
          <button key={a || 'all'} onClick={() => { setAction(a); setPage(1); }}
            className={`rounded-input px-3.5 py-2 text-xs font-bold transition ${action === a ? 'bg-accent text-white' : 'border border-line bg-white/[2%] text-fg-2 hover:text-fg'}`}>
            {a === '' ? 'All' : a.replaceAll('_', ' ')}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['When', 'Actor', 'Action', 'Entity', 'Detail']}>
            {data?.items.map((a) => (
              <Tr key={a.id}>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(a.createdAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</Td>
                <Td className="font-semibold text-fg">{a.actor}</Td>
                <Td><span className={`text-xs font-bold ${(a.action.includes('REJECT') || a.action.includes('BAN') || a.action === 'ROOM_CANCELLED') ? 'text-danger' : a.action.includes('APPROVED') || a.action.includes('PAID') || a.action.includes('VERIFIED') || a.action === 'ROOM_VISIBLE' ? 'text-success' : a.action === 'ROOM_HIDDEN' ? 'text-warning' : 'text-fg-2'}`}>{a.action.replaceAll('_', ' ')}</span></Td>
                <Td className="text-xs text-fg-2">{a.entity}{a.entityId ? ` · ${a.entityId.slice(-6)}` : ''}</Td>
                <Td>
                  <button onClick={() => setDetail(a)} className="rounded-input border border-line px-2.5 py-1 text-[11px] font-bold text-fg-2 hover:text-accent">Inspect</button>
                </Td>
              </Tr>
            ))}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}

      {detail && (
        <Modal title={`${detail.action.replaceAll('_', ' ')} — ${detail.actor}`} onClose={() => setDetail(null)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-white/[3%] p-3.5">
              <p className="text-[11px] font-bold uppercase text-fg-3">Before</p>
              <pre className="mt-1.5 overflow-x-auto text-[11px] text-fg-2">{JSON.stringify(detail.before, null, 2) ?? '—'}</pre>
            </div>
            <div className="rounded-card border border-line bg-white/[3%] p-3.5">
              <p className="text-[11px] font-bold uppercase text-fg-3">After</p>
              <pre className="mt-1.5 overflow-x-auto text-[11px] text-fg-2">{JSON.stringify(detail.after, null, 2) ?? '—'}</pre>
            </div>
          </div>
          <p className="mt-3 text-xs text-fg-3">
            {detail.entity} · id {detail.entityId ?? '—'} · ip {detail.ip ?? '—'} ·{' '}
            {new Date(detail.createdAt).toLocaleString('en-PK')}
          </p>
        </Modal>
      )}
    </div>
  );
}
