'use client';
// Tournaments management — design 28: list, status transitions, create link.
import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api , apiGet } from '@/lib/client-api';

interface Row {
  id: string; title: string; slug: string; type: string; status: string;
  entryFeePerPlayer: number; prizePool: number; maxSlots: number; registeredSlots: number;
  startTime: string; createdAt: string;
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

const FLOW: Record<string, string | null> = {
  DRAFT: 'REGISTRATION_OPEN',
  REGISTRATION_OPEN: 'LIVE',
  LIVE: 'COMPLETED',
};

export default function AdminTournamentsPage() {
  const [page, setPage] = useState(1);
  const { data, loading, setData } = useAdminList<Page>(`/admin/tournaments?page=${page}&pageSize=15`, [page]);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function setStatus(id: string, status: string) {
    setBusy(id);
    try {
      await api(`/admin/tournaments/${id}/status`, { method: 'POST', body: { status } });
      const fresh = await apiGet<Page>(`/admin/tournaments?page=${page}&pageSize=15`);
      if (fresh) setData(fresh);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Status change failed');
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: Row) {
    if (!window.confirm(`Delete draft tournament "${t.title}"? This permanently removes its prizes and cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api(`/admin/tournaments/${t.id}`, { method: 'DELETE' });
      const fresh = await apiGet<Page>(`/admin/tournaments?page=${page}&pageSize=15`);
      if (fresh) setData(fresh);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <AdminPageTitle
        title="Tournaments"
        sub="Create, publish and steer the arena's calendar."
        action={
          <Link href="/admin/tournaments/new" className="inline-flex items-center gap-1.5 rounded-input bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.35)]">
            <Plus size={15} /> New Tournament
          </Link>
        }
      />

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['Tournament', 'Type', 'Status', 'Entry', 'Prize Pool', 'Slots', 'Starts', 'Actions']}>
            {data?.items.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <Link href={`/tournaments/${t.slug}`} target="_blank" className="font-semibold text-fg hover:text-accent">{t.title}</Link>
                  <p className="text-[11px] text-fg-3">/{t.slug}</p>
                </Td>
                <Td><span className="text-xs text-fg-2">{t.type.replace('_', ' ')}</span></Td>
                <Td><Pill status={t.status} /></Td>
                <Td className="tabular text-fg-2">PKR {t.entryFeePerPlayer.toLocaleString('en-PK')}</Td>
                <Td className="tabular text-reward">PKR {t.prizePool.toLocaleString('en-PK')}</Td>
                <Td className="tabular text-xs text-fg-2">{t.registeredSlots}/{t.maxSlots}</Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(t.startTime).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {FLOW[t.status] && (
                      <button
                        onClick={() => setStatus(t.id, FLOW[t.status]!)}
                        disabled={busy === t.id}
                        className="rounded-input bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent disabled:opacity-50"
                      >
                        → {FLOW[t.status]!.replace('_', ' ')}
                      </button>
                    )}
                    {['DRAFT', 'REGISTRATION_OPEN'].includes(t.status) && (
                      <button
                        onClick={() => { if (window.confirm('Cancel this tournament? Only possible with no confirmed players.')) setStatus(t.id, 'CANCELLED'); }}
                        disabled={busy === t.id}
                        className="rounded-input border border-danger/30 px-2.5 py-1 text-[11px] font-bold text-danger disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                    {t.status === 'DRAFT' && (
                      <button
                        onClick={() => remove(t)}
                        disabled={deleting}
                        className="inline-flex items-center gap-1 rounded-input border border-danger/30 px-2.5 py-1 text-[11px] font-bold text-danger hover:bg-danger/10 disabled:opacity-50"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
