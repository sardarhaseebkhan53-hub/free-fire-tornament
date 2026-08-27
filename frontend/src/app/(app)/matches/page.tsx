'use client';
// My Matches — design 13. Tabs (Upcoming/Live/Completed), rich match cards,
// timed room credentials, per-match results, and the Phase 8 result-submission
// flow (placement + kills + screenshot → staff verification).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check, Copy, Eye, EyeOff, KeyRound, Loader2, Lock, Trophy, Upload, X, XCircle,
} from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { Countdown } from '@/components/countdown';
import { MODE_LABEL } from '@/lib/format';
import { api, getToken } from '@/lib/client-api';

interface MyMatch {
  id: string; matchNumber: number; round: number; map: string | null;
  scheduledAt: string; status: string;
  roomId: string | null; roomPassword: string | null;
  releaseInMs: number | null; unlocked: boolean;
  result: { placement: number | null; kills: number | null; points: number | null; status: string } | null;
  mySubmission: { status: string; placement: number | null; kills: number | null; note: string | null } | null;
}
interface Item {
  tournament: {
    id: string; title: string; slug: string; type: string; map: string | null;
    status: string; startTime: string; entryFeePerPlayer: number; prizePool: number;
  };
  team: { name: string; tag: string } | null;
  slotNumber: number;
  myEarnings: number;
  matches: MyMatch[];
}
interface Standings {
  tournament: { title: string };
  standings: Array<{ rank: number; label: string; points: number; kills: number }>;
  winners: Array<{ position: number; label: string; amount: number; recipient: string }>;
}

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-input border border-line bg-white/[4%] px-3 py-1.5 text-xs font-semibold text-fg transition hover:border-accent/40"
      aria-label={`Copy ${label}`}
    >
      <span className="text-fg-3">{label}:</span> <span className="tabular">{value}</span>
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} className="text-fg-3" />}
    </button>
  );
}

type Tab = 'upcoming' | 'live' | 'completed';

function classify(it: Item): Tab {
  if (it.tournament.status === 'COMPLETED' || it.matches.every((m) => m.status === 'COMPLETED')) return 'completed';
  const hasLive = it.matches.some((m) => m.status === 'LIVE' || (m.unlocked && m.status !== 'COMPLETED'));
  if (hasLive || it.tournament.status === 'LIVE') return 'live';
  return 'upcoming';
}

function Thumb({ seed }: { seed: string }) {
  const hue = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 3;
  const grads = [
    'from-accent/40 via-surface to-base',
    'from-reward/30 via-surface to-base',
    'from-info/30 via-surface to-base',
  ];
  return (
    <div className={`flex h-24 w-36 shrink-0 items-center justify-center rounded-card border border-line bg-gradient-to-br sm:h-28 sm:w-44 ${grads[hue]}`}>
      <Trophy size={30} className="text-fg-2/70" />
    </div>
  );
}

export default function MyMatchesPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [anon, setAnon] = useState(false);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [pwVisible, setPwVisible] = useState<Record<string, boolean>>({});
  const [resultFor, setResultFor] = useState<{ item: Item; match: MyMatch } | null>(null);
  const [standingsFor, setStandingsFor] = useState<Item | null>(null);

  const load = useCallback(() => {
    const token = localStorage.getItem('cn_access');
    if (!token) return setAnon(true);
    api<Item[]>('/matches/my').then(setItems).catch(() => setAnon(true));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  if (anon) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to see your matches</h1>
        <Link href="/login?next=/matches" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">Sign In</Link>
      </div>
    );
  }

  const groups = items === null ? null : {
    upcoming: items.filter((i) => classify(i) === 'upcoming'),
    live: items.filter((i) => classify(i) === 'live'),
    completed: items.filter((i) => classify(i) === 'completed'),
  };
  const visible = groups ? groups[tab] : [];
  const total = items?.length ?? 0;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">My Matches</h1>

      {/* Tabs */}
      <div className="mt-5 flex w-fit gap-1 rounded-card border border-line bg-white/[2%] p-1">
        {([
          ['upcoming', 'Upcoming', groups?.upcoming.length ?? 0, false],
          ['live', 'Live', groups?.live.length ?? 0, true],
          ['completed', 'Completed', groups?.completed.length ?? 0, false],
        ] as Array<[Tab, string, number, boolean]>).map(([key, label, count, dot]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-input px-5 py-2.5 text-sm font-bold transition ${
              tab === key ? 'bg-accent text-white shadow-[0_4px_16px_rgba(139,92,246,0.35)]' : 'text-fg-2 hover:text-fg'
            }`}
          >
            {label}
            <span className={`flex h-5 min-w-5 items-center justify-center rounded-pill px-1.5 text-[11px] font-bold ${
              tab === key ? 'bg-white/20 text-white' : 'bg-accent/15 text-accent'
            }`}>
              {count}
            </span>
            {dot && count > 0 && <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse-dot" />}
          </button>
        ))}
      </div>

      {groups === null ? (
        <p className="mt-10 flex items-center gap-2 text-sm text-fg-3"><Loader2 size={15} className="animate-spin" /> Loading…</p>
      ) : visible.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={tab === 'upcoming' ? 'No upcoming matches' : tab === 'live' ? 'Nothing is live right now' : 'No completed matches yet'}
            sub={tab === 'completed' ? 'Once tournaments finish, your placements and prizes appear here.' : 'Join a tournament and your matches will appear here.'}
          />
          {tab !== 'completed' && (
            <div className="mt-4 text-center">
              <Link href="/tournaments" className="inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">Browse tournaments</Link>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-6 space-y-4">
            {visible.map((it) => {
              const m = it.matches[0];
              const mode = MODE_LABEL[it.tournament.type] ?? it.tournament.type;
              return (
                <article key={it.tournament.id + (it.team?.tag ?? '')} className="glass rounded-card p-4 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <Thumb seed={it.tournament.slug} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/tournaments/${it.tournament.slug}`} className="font-display text-lg font-bold text-fg hover:text-accent">
                          {it.tournament.title}
                        </Link>
                        <span className="rounded-pill border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">{mode}</span>
                      </div>
                      <p className="mt-1 flex items-center gap-2 text-xs text-fg-3">
                        🗓 {new Date(it.tournament.startTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        · ⏰ {new Date(it.tournament.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </p>

                      <div className="mt-3 grid grid-cols-3 gap-3 sm:w-fit sm:gap-8">
                        {tab !== 'completed' ? (
                          <>
                            <Metric label="ENTRY FEE" value={`₹${it.tournament.entryFeePerPlayer.toLocaleString('en-IN')}`} />
                            <Metric label="PRIZE POOL" value={`₹${it.tournament.prizePool.toLocaleString('en-IN')}`} gold />
                            <Metric label="YOUR SLOT" value={`#${it.slotNumber}`} />
                          </>
                        ) : (
                          <>
                            <Metric label="PLACEMENT" value={m?.result?.placement ? `#${m.result.placement}` : '—'} gold />
                            <Metric label="KILLS" value={String(m?.result?.kills ?? 0)} />
                            <Metric label="POINTS" value={String(m?.result?.points ?? 0)} />
                            <Metric label="EARNINGS" value={`${it.myEarnings > 0 ? '+' : ''}₹${it.myEarnings.toLocaleString('en-IN')}`} green={it.myEarnings > 0} />
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-start gap-2 lg:items-end">
                      <StatusPill tab={tab} tournamentStatus={it.tournament.status} />
                      {tab === 'completed' && (
                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          <button
                            onClick={() => setStandingsFor(it)}
                            className="text-xs font-bold text-accent hover:underline"
                          >
                            View Result →
                          </button>
                          {m && <SubmitResultButton item={it} match={m} onSubmit={() => setResultFor({ item: it, match: m })} />}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Credentials strip */}
                  {tab !== 'completed' && m && (
                    <div className="mt-4 rounded-input border border-line bg-base/60 px-4 py-3">
                      {m.unlocked && m.roomId ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-pill bg-danger/15 px-3 py-1 text-[11px] font-bold uppercase text-danger">
                            <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse-dot" /> Live
                          </span>
                          <CopyChip label="Room ID" value={m.roomId} />
                          {m.roomPassword && (
                            <span className="inline-flex items-center gap-1.5 rounded-input border border-line bg-white/[4%] px-3 py-1.5 text-xs font-semibold text-fg">
                              <span className="text-fg-3">Password:</span>
                              <span className="tabular">{pwVisible[m.id] ? m.roomPassword : '•••••'}</span>
                              <button onClick={() => setPwVisible((v) => ({ ...v, [m.id]: !v[m.id] }))} aria-label="Toggle password visibility">
                                {pwVisible[m.id] ? <EyeOff size={12} className="text-fg-3" /> : <Eye size={12} className="text-fg-3" />}
                              </button>
                              <button onClick={() => navigator.clipboard?.writeText(m.roomPassword ?? '').catch(() => {})} aria-label="Copy password">
                                <Copy size={12} className="text-fg-3" />
                              </button>
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="flex items-center gap-3 text-sm text-fg-2">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white/[4%]"><Lock size={15} className="text-warning" /></span>
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            Room details available in
                            {m.releaseInMs !== null && m.releaseInMs > 0
                              ? <Countdown targetMs={m.releaseInMs} className="tabular text-base font-bold text-accent" />
                              : 'a moment'}
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Completed-match result strip */}
                  {tab === 'completed' && m && (m.result || m.mySubmission) && (
                    <div className="mt-4 rounded-input border border-line bg-base/60 px-4 py-3 text-xs">
                      {m.result?.status === 'PLAYED' ? (
                        <p className="text-fg-2">
                          <span className="font-bold text-success">✓ Verified result:</span> #{m.result.placement} · {m.result.kills} kills · {m.result.points} points
                        </p>
                      ) : m.mySubmission?.status === 'PENDING' ? (
                        <p className="text-fg-2"><span className="font-bold text-warning">⏳ Result under review</span> — our team is verifying your screenshot.</p>
                      ) : m.mySubmission?.status === 'REJECTED' ? (
                        <p className="text-fg-2">
                          <span className="inline-flex items-center gap-1 font-bold text-danger"><XCircle size={13} /> Result rejected</span>
                          {m.mySubmission.note ? ` — ${m.mySubmission.note}` : ''} — you can submit a corrected result.
                        </p>
                      ) : (
                        <p className="text-fg-2">Your result hasn&apos;t been submitted yet.</p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <p className="mt-6 text-center text-xs text-fg-3">Showing 1 to {visible.length} of {total} matches</p>
        </>
      )}

      {resultFor && <SubmitResultModal data={resultFor} onClose={() => setResultFor(null)} onDone={() => { setResultFor(null); load(); }} />}
      {standingsFor && <StandingsModal item={standingsFor} onClose={() => setStandingsFor(null)} />}
    </div>
  );
}

function Metric({ label, value, gold, green }: { label: string; value: string; gold?: boolean; green?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-fg-3">{label}</p>
      <p className={`tabular mt-0.5 font-display text-lg font-bold sm:text-xl ${gold ? 'text-reward' : green ? 'text-success' : 'text-fg'}`}>{value}</p>
    </div>
  );
}

function StatusPill({ tab, tournamentStatus }: { tab: Tab; tournamentStatus: string }) {
  if (tab === 'completed') {
    return <span className="rounded-pill border border-success/30 bg-success/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-success">Completed</span>;
  }
  if (tab === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-pill border border-danger/30 bg-danger/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-danger">
        <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse-dot" /> Live
      </span>
    );
  }
  return <span className="rounded-pill border border-info/30 bg-info/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-info">Upcoming</span>;
}

function SubmitResultButton({ item, match, onSubmit }: { item: Item; match: MyMatch; onSubmit: () => void }) {
  if (match.result?.status === 'PLAYED') {
    return <span className="text-xs font-semibold text-success">✓ Result verified</span>;
  }
  if (match.mySubmission?.status === 'PENDING') {
    return <span className="text-xs font-semibold text-warning">⏳ Under review</span>;
  }
  if (match.mySubmission?.status === 'REJECTED') {
    return (
      <button onClick={onSubmit} className="rounded-input border border-danger/40 px-3 py-1.5 text-xs font-bold text-danger transition hover:bg-danger/10">
        Resubmit Result
      </button>
    );
  }
  void item;
  return (
    <button onClick={onSubmit} className="rounded-input bg-accent px-3.5 py-1.5 text-xs font-bold text-white transition hover:brightness-110">
      Submit Result
    </button>
  );
}

function SubmitResultModal({ data, onClose, onDone }: { data: { item: Item; match: MyMatch }; onClose: () => void; onDone: () => void }) {
  const [placement, setPlacement] = useState(data.match.mySubmission?.placement?.toString() ?? '');
  const [kills, setKills] = useState(data.match.mySubmission?.kills?.toString() ?? '');
  const [notes, setNotes] = useState(data.match.mySubmission?.note ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    setError(null);
    const p = Number(placement);
    const k = Number(kills);
    if (!Number.isInteger(p) || p < 1) return setError('Enter your placement (1 or higher).');
    if (!Number.isInteger(k) || k < 0) return setError('Enter your kill count.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('placement', String(p));
      fd.append('kills', String(k));
      if (notes.trim()) fd.append('notes', notes.trim());
      if (file) fd.append('screenshot', file);
      await api(`/matches/${data.match.id}/result`, { method: 'POST', form: fd });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-[20px] border border-line bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-fg">Submit Result</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-3 hover:text-fg" aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <p className="mt-1 text-xs text-fg-3">
          {data.item.tournament.title} · Match {data.match.matchNumber} — our team verifies every submission before it counts.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-fg-2">Placement *</span>
            <input
              value={placement}
              onChange={(e) => setPlacement(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="#1"
              className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-fg-2">Kills *</span>
            <input
              value={kills}
              onChange={(e) => setKills(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="0"
              className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything the reviewers should know (optional)"
            className="w-full resize-none rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
          />
        </label>

        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold text-fg-2">Scoreboard Screenshot</p>
          {!file ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
              className={`flex w-full flex-col items-center gap-1.5 rounded-card border-2 border-dashed px-4 py-6 transition ${drag ? 'border-accent bg-accent/[8%]' : 'border-accent/40 bg-accent/[3%] hover:border-accent/70'}`}
            >
              <Upload size={20} className="text-accent" />
              <span className="text-xs font-semibold text-fg">Drop screenshot or <span className="text-accent underline">browse</span></span>
              <span className="text-[10px] text-fg-3">JPG/PNG, max 5MB — recommended</span>
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-input border border-success/30 bg-success/[6%] p-2.5">
              <span className="text-[10px] font-bold uppercase text-success">IMG</span>
              <p className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">{file.name}</p>
              <button onClick={() => setFile(null)} aria-label="Remove"><X size={14} className="text-fg-3 hover:text-danger" /></button>
            </div>
          )}
          <input ref={(el) => { inputRef.current = el; }} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
        </div>

        {error && <p className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-3.5 py-2 text-xs text-danger">{error}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-input bg-gradient-to-r from-accent to-accent-strong py-3 font-display text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={15} />}
          Submit for Verification
        </button>
      </div>
    </div>
  );
}

function StandingsModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const [data, setData] = useState<Standings | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/backend/public/tournaments/${item.tournament.slug}/results`)
      .then((r) => r.json())
      .then((j) => (j.success ? setData(j.data) : setError(true)))
      .catch(() => setError(true));
  }, [item.tournament.slug]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[20px] border border-line bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-fg">Final Standings</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-3 hover:text-fg" aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <p className="mt-1 text-xs text-fg-3">{item.tournament.title}</p>

        {!data && !error && <p className="mt-8 flex justify-center"><Loader2 className="animate-spin text-accent" /></p>}
        {error && <p className="mt-6 text-sm text-danger">Standings are not available yet.</p>}

        {data && (
          <>
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-fg-3">
                  <th className="py-2 font-semibold">#</th>
                  <th className="py-2 font-semibold">Player / Team</th>
                  <th className="py-2 text-right font-semibold">Kills</th>
                  <th className="py-2 text-right font-semibold">Points</th>
                </tr>
              </thead>
              <tbody>
                {data.standings.map((s) => (
                  <tr key={s.rank} className={`border-b border-line/50 ${s.rank === 1 ? 'bg-reward/[6%]' : ''}`}>
                    <td className={`py-2.5 font-display font-bold ${s.rank === 1 ? 'text-reward' : 'text-fg-2'}`}>{s.rank}</td>
                    <td className="py-2.5 font-semibold text-fg">{s.label}</td>
                    <td className="tabular py-2.5 text-right text-fg-2">{s.kills}</td>
                    <td className="tabular py-2.5 text-right font-bold text-fg">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {data.winners.length > 0 && (
              <>
                <h3 className="mt-5 font-display text-sm font-bold text-reward">🏆 Prizes Credited</h3>
                <div className="mt-2 flex flex-col gap-1.5">
                  {data.winners.map((w, i) => (
                    <div key={`${w.position}-${i}`} className="flex items-center justify-between rounded-input border border-line bg-white/[2%] px-3.5 py-2 text-xs">
                      <span className="font-semibold text-fg-2">{w.label}</span>
                      <span className="text-fg-3">{w.recipient}</span>
                      <span className="tabular font-bold text-success">+₹{w.amount.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
