'use client';
// My Matches — registrations with TIMED room-credential release (spec §16/§37).
// Credentials render ONLY when the server says unlocked; until then a countdown.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, KeyRound, Loader2, Lock } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { Countdown } from '@/components/countdown';
import { MODE_LABEL, dateTime } from '@/lib/format';

interface MyMatch {
  id: string; matchNumber: number; round: number; map: string | null;
  scheduledAt: string; status: string;
  roomId: string | null; roomPassword: string | null;
  releaseInMs: number | null; unlocked: boolean;
}
interface Item {
  tournament: { id: string; title: string; slug: string; type: string; map: string | null; status: string; startTime: string };
  team: { name: string; tag: string } | null;
  matches: MyMatch[];
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

export default function MyMatchesPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [anon, setAnon] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem('cn_access');
    if (!token) return setAnon(true);
    fetch('/api/backend/matches/my', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setItems(json.data);
        else setAnon(true);
      })
      .catch(() => setAnon(true));
    // re-poll so credentials unlock live without a refresh
    return undefined;
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  if (anon) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to see your matches</h1>
        <Link href="/login?next=/matches" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">Sign In</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-2xl font-bold text-fg">My Matches</h1>
      <p className="mt-1 text-sm text-fg-2">
        Room credentials unlock 30 minutes before each match — only here, only for registered players.
      </p>

      {items === null ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-fg-3"><Loader2 size={15} className="animate-spin" /> Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No matches yet" sub="Join a tournament and your matches will appear here." />
          <div className="mt-4 text-center">
            <Link href="/tournaments" className="inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">Browse tournaments</Link>
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-5">
          {items.map((it) => (
            <div key={it.tournament.id + (it.team?.tag ?? '')} className="glass rounded-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/tournaments/${it.tournament.slug}`} className="font-display text-base font-bold text-fg hover:text-accent">
                    {it.tournament.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-fg-3">
                    {MODE_LABEL[it.tournament.type]}{it.team ? ` · ${it.team.name} [${it.team.tag}]` : ''} · starts {dateTime(it.tournament.startTime)}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {it.matches.map((m) => (
                  <div key={m.id} className="rounded-input border border-line bg-white/[3%] px-4 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-fg">
                        Match {m.matchNumber}{m.round > 1 ? ` · R${m.round}` : ''}{m.map ? ` · ${m.map}` : ''}
                      </p>
                      <p className="text-xs text-fg-3">{dateTime(m.scheduledAt)}</p>
                    </div>
                    <div className="mt-3">
                      {m.unlocked && m.roomId ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-pill bg-success/15 px-2.5 py-1 text-[11px] font-bold uppercase text-success">
                            <KeyRound size={11} /> Room open
                          </span>
                          <CopyChip label="Room ID" value={m.roomId} />
                          {m.roomPassword && <CopyChip label="Password" value={m.roomPassword} />}
                        </div>
                      ) : (
                        <p className="inline-flex items-center gap-2 rounded-pill bg-white/[5%] px-3 py-1.5 text-xs font-semibold text-fg-2">
                          <Lock size={12} className="text-fg-3" />
                          Room details available in{' '}
                          {m.releaseInMs !== null && m.releaseInMs > 0
                            ? <Countdown targetMs={m.releaseInMs} className="text-warning" />
                            : 'a moment'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
