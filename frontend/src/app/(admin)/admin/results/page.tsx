'use client';
// Result verification — design 31: status tabs, submission queue, review panel
// with kill/placement override + auto points, screenshot proof, standings draft
// and the idempotent prize-distribution trigger.
import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RefreshCcw, Trophy, X } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { AuthedImage, Modal, Pill, useAdminList } from '@/components/admin/kit';
import { api } from '@/lib/client-api';

interface Submission {
  id: string; status: string; placement: number | null; kills: number | null;
  notes: string | null; screenshot: string | null; createdAt: string;
  submittedBy: { username: string; ign: string | null };
  match: { id: string; matchNumber: number; round: number; tournament: { id: string; title: string; slug: string; type: string } };
}
interface Page { items: Submission[]; total: number; page: number; pageSize: number }
interface Standings { standings: Array<{ key: string; label: string; points: number; kills: number }>; tournament: { title: string } }

const TABS = [
  ['PENDING', 'Pending'],
  ['UNDER_REVIEW', 'Under Review'],
  ['VERIFIED', 'Verified'],
  ['REJECTED', 'Rejected'],
] as const;

const PLACEMENT_POINTS = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const pointsFor = (placement: number, kills: number, perKill: number) =>
  (placement >= 1 && placement <= 10 ? PLACEMENT_POINTS[placement - 1]! : 0) + kills * perKill;

export default function AdminResultsPage() {
  const [tab, setTab] = useState('PENDING');
  const queue = useAdminListState<Page>(`/admin/results?status=${tab}&pageSize=50`, [tab]);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [tournaments, setTournaments] = useState<Array<{ id: string; title: string }>>([]);
  const [tourId, setTourId] = useState('');
  const standings = useAdminList<Standings>(tourId ? `/admin/tournaments/${tourId}/results` : '/admin/results?status=NONE', [tourId]);
  const [busy, setBusy] = useState(false);
  const [placement, setPlacement] = useState('');
  const [kills, setKills] = useState('');
  const [note, setNote] = useState('');
  const [distributed, setDistributed] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/admin/tournaments?pageSize=50', { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } })
      .then((r) => r.json())
      .then((j) => { if (j.success) setTournaments(j.data.items); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selected) {
      setPlacement(selected.placement?.toString() ?? '');
      setKills(selected.kills?.toString() ?? '');
      setNote('');
    }
  }, [selected]);

  // Auto-calculated points preview (placement table + kills × tournament rate 1..N).
  const perKill = 1; // displayed as info; the server recomputes with the real rate
  const previewPoints = useMemo(() => {
    const p = Number(placement), k = Number(kills);
    if (!Number.isInteger(p) || p < 1 || !Number.isInteger(k) || k < 0) return null;
    return pointsFor(p, k, perKill);
  }, [placement, kills]);

  async function refreshQueue() {
    const fresh = await fetch(`/api/backend/admin/results?status=${tab}&pageSize=50`,
      { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } }).then((r) => r.json());
    if (fresh.success) queue.setData(fresh.data);
  }

  async function review(action: 'APPROVE' | 'REJECT' | 'DISQUALIFY') {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/admin/results/${selected.id}/review`, {
        method: 'POST',
        body: {
          action,
          note,
          ...(action === 'APPROVE' && placement ? { placement: Number(placement) } : {}),
          ...(action === 'APPROVE' && kills ? { kills: Number(kills) } : {}),
        },
      });
      setSelected(null);
      await refreshQueue();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  async function distribute() {
    if (!tourId) return;
    if (!window.confirm('Distribute prizes for this tournament? This credits winning balances and can only run once.')) return;
    setBusy(true);
    try {
      const out = await api<{ totalPaid: number; awards: unknown[] }>(`/admin/tournaments/${tourId}/distribute-prizes`, { method: 'POST', body: {} });
      setDistributed(`Distributed PKR ${out.totalPaid.toLocaleString('en-PK')} across ${out.awards.length} awards.`);
    } catch (e) {
      setDistributed(null);
      alert(e instanceof Error ? e.message : 'Distribution failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <AdminPageTitle
        title="Result Verification"
        sub="Approve, correct or disqualify player-submitted results — points and standings update automatically."
        action={
          <button onClick={() => refreshQueue()} className="inline-flex items-center gap-1.5 rounded-input border border-line px-3.5 py-2 text-xs font-bold text-fg-2 hover:text-fg">
            <RefreshCcw size={13} /> Refresh
          </button>
        }
      />

      {/* Status tabs + tournament selector — design 31 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setSelected(null); }}
              className={`rounded-input px-4 py-2 text-xs font-bold transition ${tab === key ? 'bg-accent text-white' : 'border border-line bg-white/[2%] text-fg-2 hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={tourId}
            onChange={(e) => setTourId(e.target.value)}
            className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-xs text-fg-2 outline-none [color-scheme:dark]"
          >
            <option value="">Select tournament…</option>
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <button
            onClick={distribute}
            disabled={!tourId || busy}
            className="inline-flex items-center gap-1.5 rounded-input bg-reward/20 px-3.5 py-2 text-xs font-bold text-reward transition hover:bg-reward/30 disabled:opacity-40"
          >
            <Trophy size={13} /> Distribute Prizes
          </button>
        </div>
      </div>

      {distributed && (
        <p className="mb-4 rounded-input border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">{distributed}</p>
      )}

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_300px]">
        {/* Submission queue */}
        <div className="glass max-h-[70vh] overflow-y-auto rounded-card p-3">
          <p className="px-1 pb-2 text-[11px] font-bold uppercase tracking-wide text-fg-3">Submissions ({queue.data?.total ?? 0})</p>
          {queue.loading && !queue.data && <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" /></div>}
          <div className="flex flex-col gap-2">
            {queue.data?.items.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className={`rounded-card border p-3 text-left transition ${selected?.id === s.id ? 'border-accent bg-accent/[8%]' : 'border-line bg-white/[2%] hover:border-fg-3/40'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold text-fg">{s.submittedBy.ign ?? s.submittedBy.username}</p>
                  <span className="shrink-0 text-[10px] text-fg-3">{timeAgo(s.createdAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-fg-3">
                  {s.match.tournament.title} · M{s.match.matchNumber}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Pill status={s.status} />
                  {s.placement !== null && <span className="text-[11px] text-fg-3">#{s.placement} · {s.kills} kills</span>}
                </div>
              </button>
            ))}
            {queue.data?.items.length === 0 && <p className="px-1 py-6 text-center text-xs text-fg-3">Nothing here.</p>}
          </div>
        </div>

        {/* Review panel */}
        <div className="glass rounded-card p-5">
          {!selected ? (
            <div className="flex min-h-72 items-center justify-center text-center">
              <p className="text-sm text-fg-3">Select a submission to review.<br />Points auto-calculate from placement + kills.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-bold text-fg">{selected.submittedBy.ign ?? selected.submittedBy.username}</p>
                  <p className="text-xs text-fg-3">
                    {selected.match.tournament.title} · Match {selected.match.matchNumber} · {selected.submittedBy.username}
                  </p>
                </div>
                <Pill status={selected.status} />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:items-end">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-fg-3">Kills</span>
                  <input value={kills} onChange={(e) => setKills(e.target.value.replace(/[^\d]/g, ''))}
                    className="w-full rounded-input border border-line bg-white/[3%] px-3 py-2.5 text-sm text-fg outline-none focus:border-accent" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-fg-3">Placement</span>
                  <input value={placement} onChange={(e) => setPlacement(e.target.value.replace(/[^\d]/g, ''))}
                    className="w-full rounded-input border border-line bg-white/[3%] px-3 py-2.5 text-sm text-fg outline-none focus:border-accent" />
                </label>
                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-fg-3">Points</span>
                  <p className="tabular rounded-input border border-accent/40 bg-accent/[8%] px-3 py-2.5 text-sm font-bold text-accent">
                    {previewPoints ?? '—'}
                  </p>
                </div>
                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-fg-3">Status</span>
                  <Pill status={selected.status} />
                </div>
              </div>

              {selected.notes && (
                <p className="mt-3 rounded-input border border-line bg-white/[2%] px-3.5 py-2.5 text-xs text-fg-2">
                  “{selected.notes}”
                </p>
              )}

              {selected.screenshot && (
                <div className="mt-4">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-fg-3">Submitted screenshot</p>
                  <AuthedImage src={selected.screenshot} alt="Result screenshot" className="max-h-72 w-full rounded-card border border-line object-contain" />
                </div>
              )}

              {selected.status === 'PENDING' || selected.status === 'UNDER_REVIEW' ? (
                <>
                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-fg-3">Review note (optional)</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)}
                      className="w-full rounded-input border border-line bg-white/[3%] px-3 py-2.5 text-sm text-fg outline-none focus:border-accent" />
                  </label>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <button onClick={() => review('APPROVE')} disabled={busy}
                      className="flex items-center justify-center gap-1.5 rounded-input bg-success py-2.5 text-sm font-bold text-white disabled:opacity-50">
                      <Check size={15} /> Verify
                    </button>
                    <button onClick={() => review('DISQUALIFY')} disabled={busy}
                      className="flex items-center justify-center gap-1.5 rounded-input bg-danger py-2.5 text-sm font-bold text-white disabled:opacity-50">
                      <X size={15} /> Disqualify
                    </button>
                    <button onClick={() => review('REJECT')} disabled={busy}
                      className="flex items-center justify-center gap-1.5 rounded-input border border-warning/50 bg-warning/10 py-2.5 text-sm font-bold text-warning disabled:opacity-50">
                      <RefreshCcw size={15} /> Reject (resubmit)
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-fg-3">
                    Reject asks the player for a corrected screenshot · Disqualify removes them from the match.
                  </p>
                </>
              ) : (
                <p className="mt-4 rounded-input border border-line bg-white/[2%] px-3.5 py-2.5 text-xs text-fg-3">
                  This submission was already reviewed.
                </p>
              )}
            </>
          )}
        </div>

        {/* Standings + points system — design 31 right column */}
        <div className="flex flex-col gap-4">
          <div className="glass max-h-96 overflow-y-auto rounded-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-fg-3">Match Standings (draft)</p>
            {standingsBody(standings.data)}
          </div>

          <div className="glass rounded-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-fg-3">Points System</p>
            <div className="mt-2 flex flex-col gap-1 text-xs">
              <div className="flex justify-between"><span className="text-fg-2">Kill</span><span className="font-bold text-accent">+Tournament rate</span></div>
              {PLACEMENT_POINTS.map((p, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-fg-2">Rank #{i + 1}</span>
                  <span className="font-bold text-accent">+{p} pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function standingsBody(data: Standings | null) {
  const st = data;
  if (st && st.standings.length > 0) {
    return (
      <table className="mt-2 w-full text-left text-xs">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase text-fg-3">
            <th className="py-1.5">#</th><th className="py-1.5">Team / Player</th>
            <th className="py-1.5 text-right">Kills</th><th className="py-1.5 text-right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {st.standings.map((s, i) => (
            <tr key={s.key} className={`border-b border-line/50 ${i === 0 ? 'bg-reward/[6%]' : ''}`}>
              <td className={`py-1.5 font-bold ${i === 0 ? 'text-reward' : 'text-fg-3'}`}>{i + 1}</td>
              <td className="py-1.5 font-semibold text-fg">{s.label}</td>
              <td className="tabular py-1.5 text-right text-fg-2">{s.kills}</td>
              <td className="tabular py-1.5 text-right font-bold text-fg">{s.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <p className="py-6 text-center text-[11px] text-fg-3">Select a tournament to see live standings.</p>;
}

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}m`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// Small wrapper so the queue can be refreshed in place.
function useAdminListState<T>(path: string, deps: unknown[]) {
  const { data, loading, setData } = useAdminList<T>(path, deps);
  return { data, loading, setData };
}
