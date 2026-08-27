'use client';
// Matches management — design 30: per-tournament list, scheduling, status control.
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Modal, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api } from '@/lib/client-api';

interface Row {
  id: string; matchNumber: number; round: number; map: string | null; scheduledAt: string;
  status: string; resultsFinalized: boolean; participants: number; submissions: number;
  tournament: { title: string; slug: string; type: string };
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }
interface TList { items: Array<{ id: string; title: string }> }

export default function AdminMatchesPage() {
  const [tourId, setTourId] = useState('');
  const [page, setPage] = useState(1);
  const [createFor, setCreateFor] = useState(false);
  const tours = useAdminList<TList>('/admin/tournaments?pageSize=50');
  const { data, loading, setData } = useAdminList<Page>(`/admin/matches?page=${page}&pageSize=15${tourId ? `&tournamentId=${tourId}` : ''}`, [tourId, page]);

  async function refresh() {
    const fresh = await fetch(`/api/backend/admin/matches?page=${page}&pageSize=15${tourId ? `&tournamentId=${tourId}` : ''}`,
      { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } }).then((r) => r.json());
    if (fresh.success) setData(fresh.data);
  }

  async function setStatus(id: string, status: string) {
    try {
      await api(`/admin/matches/${id}/status`, { method: 'POST', body: { status } });
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Status change failed');
    }
  }

  return (
    <div>
      <AdminPageTitle
        title="Matches"
        sub="Schedule rounds, sync participants and drive match state."
        action={
          <button onClick={() => setCreateFor(true)} className="inline-flex items-center gap-1.5 rounded-input bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.35)]">
            <Plus size={15} /> Schedule Match
          </button>
        }
      />

      <div className="mb-4">
        <select value={tourId} onChange={(e) => { setTourId(e.target.value); setPage(1); }}
          className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]">
          <option value="">All tournaments</option>
          {tours.data?.items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['Tournament', 'Match', 'Map', 'Scheduled', 'Players', 'Submissions', 'Status', 'Actions']}>
            {data?.items.map((m) => (
              <Tr key={m.id}>
                <Td><span className="text-sm font-semibold text-fg">{m.tournament.title}</span></Td>
                <Td className="text-xs text-fg-2">#{m.matchNumber}{m.round > 1 ? ` · R${m.round}` : ''}</Td>
                <Td className="text-xs text-fg-2">{m.map ?? '—'}</Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(m.scheduledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</Td>
                <Td className="tabular text-xs text-fg-2">{m.participants}</Td>
                <Td className="tabular text-xs text-fg-2">{m.submissions}</Td>
                <Td><Pill status={m.status} /></Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {m.status === 'SCHEDULED' && (
                      <button onClick={() => setStatus(m.id, 'LIVE')} className="rounded-input bg-danger/15 px-2.5 py-1 text-[11px] font-bold text-danger">Go Live</button>
                    )}
                    {m.status === 'LIVE' && (
                      <button onClick={() => setStatus(m.id, 'COMPLETED')} className="rounded-input bg-success/15 px-2.5 py-1 text-[11px] font-bold text-success">Complete</button>
                    )}
                    {m.status === 'COMPLETED' && !m.resultsFinalized && <span className="text-[11px] text-fg-3">results open</span>}
                  </div>
                </Td>
              </Tr>
            ))}
            {data?.items.length === 0 && <Tr><Td className="py-8 text-center text-fg-3">No matches{tourId ? ' for this tournament' : ''}.</Td></Tr>}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}

      {createFor && (
        <CreateMatchModal
          tournaments={tours.data?.items ?? []}
          defaultTournament={tourId}
          onClose={() => setCreateFor(false)}
          onDone={async () => { setCreateFor(false); await refresh(); }}
        />
      )}
    </div>
  );
}

function CreateMatchModal({ tournaments, defaultTournament, onClose, onDone }: {
  tournaments: Array<{ id: string; title: string }>; defaultTournament: string;
  onClose: () => void; onDone: () => void;
}) {
  const [tournamentId, setTournamentId] = useState(defaultTournament || tournaments[0]?.id || '');
  const [matchNumber, setMatchNumber] = useState('1');
  const [round, setRound] = useState('1');
  const [map, setMap] = useState('Bermuda');
  const [scheduledAt, setScheduledAt] = useState('');
  const [roomId, setRoomId] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('/matches', {
        method: 'POST',
        body: {
          tournamentId, matchNumber: Number(matchNumber), round: Number(round), map,
          scheduledAt: new Date(scheduledAt).toISOString(),
          ...(roomId ? { roomId } : {}), ...(roomPassword ? { roomPassword } : {}),
        },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scheduling failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Schedule match" onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Tournament *</span>
          <select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)} className={inputCls}>
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Match number *</span>
          <input value={matchNumber} onChange={(e) => setMatchNumber(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Round</span>
          <input value={round} onChange={(e) => setRound(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Map</span>
          <select value={map} onChange={(e) => setMap(e.target.value)} className={inputCls}>
            <option>Bermuda</option><option>Purgatory</option><option>Kalahari</option><option>Alpine</option><option>NeXTerra</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Scheduled at *</span>
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Room ID (auto if empty)</span>
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Room password (auto if empty)</span>
          <input value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} className={inputCls} />
        </label>
      </div>
      {error && <p className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
      <button onClick={submit} disabled={busy || !tournamentId || !scheduledAt}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-input bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : null} Schedule & sync participants
      </button>
    </Modal>
  );
}

const inputCls = 'w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent';
