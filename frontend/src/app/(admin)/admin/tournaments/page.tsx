'use client';
// Tournaments management — design 28: list, status transitions, create link.
import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { RoomPill } from '@/components/room-status';
import { TournamentRoomPanel } from '@/components/admin/tournament-room-panel';
import { api , apiGet } from '@/lib/client-api';
import { msToCountdown } from '@/lib/format';
import type { RoomState } from '@/lib/types';

interface Row {
  id: string; title: string; slug: string; type: string; status: string;
  entryFeePerPlayer: number; prizePool: number; maxSlots: number; registeredSlots: number;
  startTime: string; createdAt: string;
  /**
   * State + timing only (`RoomPublicView`) — the admin list never carries a password, so a
   * row in this table cannot be the thing that leaks one. The values are fetched on demand,
   * by the room panel, for the one event an admin is actually working on.
   */
  room?: RoomState | null;
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
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [roomFor, setRoomFor] = useState<string | null>(null);

  const refresh = async () => {
    const fresh = await apiGet<Page>(`/admin/tournaments?page=${page}&pageSize=15`);
    if (fresh) setData(fresh);
  };

  async function setStatus(id: string, status: string) {
    setBusy(id);
    try {
      await api(`/admin/tournaments/${id}/status`, { method: 'POST', body: { status } });
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Status change failed');
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: Row) {
    if (!window.confirm(`Remove "${t.title}" from the admin panel? Finished/unused tournaments are archived — money, winners and the ledger stay untouched.`)) return;
    setDeleting(true);
    try {
      await api(`/admin/tournaments/${t.id}`, { method: 'DELETE' });
      await refresh();
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
          <Table head={['Tournament', 'Type', 'Status', 'Room', 'Entry', 'Prize Pool', 'Slots', 'Starts', 'Actions']}>
            {data?.items.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <Link href={`/tournaments/${t.slug}`} target="_blank" className="font-semibold text-fg hover:text-accent">{t.title}</Link>
                  <p className="text-[11px] text-fg-3">/{t.slug}</p>
                </Td>
                <Td><span className="text-xs text-fg-2">{t.type.replace('_', ' ')}</span></Td>
                <Td><Pill status={t.status} /></Td>
                <Td>
                  {t.room ? (
                    <div className="flex flex-col items-start gap-1">
                      <RoomPill status={t.room.status} label={t.room.label} />
                      {/* An admin scanning a list cares about WHEN it goes out as much as
                          whether it is ready — a scheduled room with no countdown next to it
                          is a coin flip. Absent for NOT_ADDED/CANCELLED, where there is no
                          release to count. */}
                      {t.room.status === 'SCHEDULED' && t.room.releaseInMs !== null && t.room.releaseInMs > 0 ? (
                        <span className="tabular text-[10px] text-fg-3">in {msToCountdown(t.room.releaseInMs)}</span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-[10px] uppercase tracking-[0.12em] text-fg-3">No room</span>
                  )}
                </Td>
                <Td className="tabular text-fg-2">PKR {t.entryFeePerPlayer.toLocaleString('en-PK')}</Td>
                <Td className="tabular text-reward">PKR {t.prizePool.toLocaleString('en-PK')}</Td>
                <Td className="tabular text-xs text-fg-2">{t.registeredSlots}/{t.maxSlots}</Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(t.startTime).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => setRoomFor(t.id)}
                      className="inline-flex items-center gap-1 rounded-input bg-white/5 px-2.5 py-1 text-[11px] font-bold text-fg-2 transition hover:bg-white/10 hover:text-fg"
                    >
                      <KeyRound size={11} /> Room
                    </button>
                    {FLOW[t.status] && (
                      <button
                        onClick={() => setStatus(t.id, FLOW[t.status]!)}
                        disabled={busy === t.id}
                        className="rounded-input bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent disabled:opacity-50"
                      >
                        → {FLOW[t.status]!.replace('_', ' ')}
                      </button>
                    )}
                    {['DRAFT', 'REGISTRATION_OPEN', 'LIVE'].includes(t.status) && (
                      <button
                        onClick={async () => {
                          const confirmed = window.confirm(
                            `Cancel “${t.title}”? Every confirmed registration will be marked refunded and credited according to the tournament refund policy. This cannot be undone.`,
                          );
                          if (!confirmed) return;
                          setCancelling(t.id);
                          try {
                            await setStatus(t.id, 'CANCELLED');
                          } finally {
                            setCancelling(null);
                          }
                        }}
                        disabled={busy === t.id || cancelling === t.id}
                        className="rounded-input border border-danger/30 px-2.5 py-1 text-[11px] font-bold text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {cancelling === t.id ? 'Refunding…' : 'Cancel + refund'}
                      </button>
                    )}
                    {['DRAFT', 'CANCELLED', 'COMPLETED'].includes(t.status) && (
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

      {/* Mounted outside the list's conditional so closing it never unmounts the table. */}
      {roomFor ? (
        <TournamentRoomPanel
          tournamentId={roomFor}
          onClose={() => setRoomFor(null)}
          onChanged={() => void refresh()}
        />
      ) : null}
    </div>
  );
}
