'use client';
// Result verification — design 31: status tabs, submission queue, review panel
// with kill/placement override + auto points, screenshot proof, standings draft
// and the idempotent prize-distribution trigger.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, RefreshCcw, Trash2, Trophy, X } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { AuthedImage, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { MatchTableModal } from '@/components/admin/match-table';
import { api , apiGet, downloadProtectedFile } from '@/lib/client-api';

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

/** Per-tournament scoring comes from the public tournament payload — the
 * platform never hard-codes placement points or kill rates (spec §35). */
const DEFAULT_TABLE = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const pointsFor = (placement: number, kills: number, perKill: number, table: number[]) => {
  const base = placement >= 1 && placement <= table.length ? table[placement - 1]! : 0;
  return base + Math.max(0, kills) * Math.max(0, perKill);
};

export default function AdminResultsPage() {
  const [tab, setTab] = useState('PENDING');
  const queue = useAdminListState<Page>(`/admin/results?status=${tab}&pageSize=50`, [tab]);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [tournaments, setTournaments] = useState<Array<{ id: string; title: string }>>([]);
  const [tourId, setTourId] = useState('');
  const standings = useTournamentStandings(tourId);
  const [busy, setBusy] = useState(false);
  // Review form state is keyed by the submission it belongs to, so selecting a
  // different submission resets the form by derivation instead of an effect.
  const [draft, setDraft] = useState<{ id: string; placement: string; kills: string; note: string } | null>(null);
  const form = draft && draft.id === selected?.id
    ? draft
    : {
        id: selected?.id ?? '',
        placement: selected?.placement?.toString() ?? '',
        kills: selected?.kills?.toString() ?? '',
        note: '',
      };
  const { placement, kills, note } = form;
  const setPlacement = (v: string) => setDraft({ ...form, placement: v });
  const setKills = (v: string) => setDraft({ ...form, kills: v });
  const setNote = (v: string) => setDraft({ ...form, note: v });
  const [distributed, setDistributed] = useState<string | null>(null);
  // Default to Publish & Prizes so an admin lands on the match list where they
  // can Add / Enter Results immediately instead of an empty submission queue.
  const [view, setView] = useState<'submissions' | 'publish'>('publish');
  const [scoring, setScoring] = useState<{ pointsPerKill: number; placementTable: number[]; bonusPoints: number; penaltyPoints: number } | null>(null);
  const [openTable, setOpenTable] = useState<string | null>(null);

  // Live per-tournament scoring for the selected submission's points preview.
  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      // Deferred so no setState happens synchronously inside the effect body.
      void Promise.resolve().then(() => { if (!cancelled) setScoring(null); });
      return () => { cancelled = true; };
    }
    fetch(`/api/backend/public/tournaments/${selected.match.tournament.slug}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setScoring(j.success ? j.data.scoring : null); })
      .catch(() => { if (!cancelled) setScoring(null); });
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    apiGet<{ items: Array<{ id: string; title: string }> }>('/admin/tournaments?pageSize=50')
      .then((j) => { if (j) setTournaments(j.items); })
      .catch(() => {});
  }, []);

  // Auto-calculated points preview from the tournament's own scoring config.
  const perKill = scoring?.pointsPerKill ?? 0;
  const table = scoring?.placementTable ?? DEFAULT_TABLE;
  const previewPoints = useMemo(() => {
    const p = Number(placement), k = Number(kills);
    if (!Number.isInteger(p) || p < 1 || !Number.isInteger(k) || k < 0) return null;
    return pointsFor(p, k, perKill, table);
  }, [placement, kills, perKill, table]);

  async function refreshQueue() {
    const fresh = await apiGet<Page>(`/admin/results?status=${tab}&pageSize=50`);
    if (fresh) queue.setData(fresh);
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

      <div className="mb-4 flex gap-1.5">
        {(['submissions', 'publish'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-input px-4 py-2 text-xs font-bold transition ${view === v ? 'bg-accent text-white' : 'border border-line bg-white/[2%] text-fg-2 hover:text-fg'}`}>
            {v === 'submissions' ? 'Player Submissions' : 'Publish & Prizes'}
          </button>
        ))}
      </div>

      {view === 'submissions' ? (
      <>
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
            <p className="text-[11px] font-bold uppercase tracking-wide text-fg-3">Points System — this tournament</p>
            {scoring ? (
              <div className="mt-2 flex flex-col gap-1 text-xs">
                <div className="flex justify-between"><span className="text-fg-2">Kill</span><span className="font-bold text-accent">+{scoring.pointsPerKill} pts</span></div>
                {scoring.placementTable.map((p, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-fg-2">Rank #{i + 1}</span>
                    <span className="font-bold text-accent">+{p} pts</span>
                  </div>
                ))}
                <div className="mt-1 border-t border-line/60 pt-1">
                  <div className="flex justify-between"><span className="text-fg-2">Bonus</span><span className="font-bold text-success">+{scoring.bonusPoints}</span></div>
                  <div className="flex justify-between"><span className="text-fg-2">Penalty</span><span className="font-bold text-danger">−{scoring.penaltyPoints}</span></div>
                </div>
              </div>
            ) : (
              <p className="py-4 text-[11px] text-fg-3">Select a submission to load its tournament&rsquo;s scoring rules.</p>
            )}
          </div>
        </div>
      </div>
      </>
      ) : (
        <PublishWorkflow
          tournaments={tournaments}
          openTable={openTable}
          setOpenTable={setOpenTable}
        />
      )}
    </div>
  );
}

function PublishWorkflow({ tournaments, openTable, setOpenTable }: {
  tournaments: Array<{ id: string; title: string }>;
  openTable: string | null;
  setOpenTable: (id: string | null) => void;
}) {
  const router = useRouter();
  const [tourId, setTourId] = useState('');
  const [q, setQ] = useState('');
  const qs = new URLSearchParams({ page: '1', pageSize: '50', sort: 'scheduledAt', dir: 'desc' });
  if (tourId) qs.set('tournamentId', tourId);
  if (q) qs.set('q', q);
  const { data, loading, setData } = useAdminList<Page2>(`/admin/matches?${qs}`, [tourId, q]);
  const refresh = async () => {
    const fresh = await apiGet<Page2>(`/admin/matches?${qs}`);
    if (fresh) setData(fresh);
  };
  const removeMatch = async (id: string, label: string) => {
    if (!window.confirm(`Remove match ${label}? Results, participants and financial records stay archived/audited.`)) return;
    try {
      await api(`/admin/matches/${id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Remove failed');
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={tourId} onChange={(e) => setTourId(e.target.value)}
          className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]">
          <option value="">All tournaments</option>
          {tournaments.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tournament…"
          className="w-56 rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none placeholder:text-fg-3 focus:border-accent" />
        <p className="text-[11px] text-fg-3">
          Workflow: <b className="text-fg-2">Draft</b> → <b className="text-fg-2">Under Review</b> → <b className="text-fg-2">Confirmed</b> → <b className="text-fg-2">Calculate &amp; Publish</b>.
          Results stay hidden from the public site until every match is PUBLISHED.
        </p>
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table
            head={['Tournament', 'Match', 'Scheduled', 'Status', 'Results', 'Actions']}
          >
            {data?.items.map((m) => (
              <Tr key={m.id}>
                <Td><span className="font-semibold text-fg">{m.tournament.title}</span></Td>
                <Td className="text-xs text-fg-2">#{m.matchNumber}{m.round > 1 ? ` · R${m.round}` : ''}</Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(m.scheduledAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</Td>
                <Td><Pill status={m.status} /></Td>
                <Td><Pill status={m.resultsStatus} /></Td>
                <Td>
                  <div className="flex gap-1.5">
                    <button onClick={() => setOpenTable(m.id)}
                      className="rounded-input bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent">
                      {m.resultsStatus === 'PUBLISHED' ? 'View Results' : 'Enter Results'}
                    </button>
                    <button onClick={() => void downloadProtectedFile(`/matches/${m.id}/export`, `match-${m.id.slice(0, 8)}.csv`)}
                      className="rounded-input border border-line px-2.5 py-1 text-[11px] font-bold text-fg-2 hover:text-fg">CSV</button>
                    <button onClick={() => void removeMatch(m.id, `#${m.matchNumber}${m.round > 1 ? ` · R${m.round}` : ''}`)}
                      className="inline-flex items-center gap-1 rounded-input border border-danger/30 px-2.5 py-1 text-[11px] font-bold text-danger hover:bg-danger/10">
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
            {data?.items.length === 0 && <Tr><Td className="py-8 text-center text-fg-3">No matches yet.</Td></Tr>}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={() => undefined} />}
        </>
      )}

      {openTable && (
        <MatchTableModal
          matchId={openTable}
          onClose={() => setOpenTable(null)}
          onChanged={refresh}
          onOpenSlots={(tournamentId: string) => {
            setOpenTable(null);
            setTourId(tournamentId);
            router.push(`/admin/slots?tournament=${tournamentId}`);
          }}
        />
      )}
    </div>
  );
}

interface Page2 { items: Array<{
  id: string; matchNumber: number; round: number; map: string | null; scheduledAt: string;
  status: string; resultsStatus: string; participants: number;
  tournament: { title: string; slug: string; type: string };
}>; total: number; page: number; pageSize: number }

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

/**
 * Tournament standings only exist when a tournament is selected. Avoid sending
 * a dummy `/admin/results?status=NONE` request (which the API correctly rejects
 * with 400) by not fetching at all until a tournament is chosen.
 */
function useTournamentStandings(tourId: string) {
  const [data, setData] = useState<Standings | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!tourId) {
      void Promise.resolve().then(() => { if (!cancelled) setData(null); });
      return () => { cancelled = true; };
    }
    api<Standings>(`/admin/tournaments/${tourId}/results`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [tourId]);
  return { data };
}
