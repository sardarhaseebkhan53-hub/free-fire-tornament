'use client';
import Link from 'next/link';
// Join tournament flow — talks to the race-safe join engine.
// Solo: direct join (+ optional coupon). Team modes: captain picks their team.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { money } from '@/lib/format';

const FRIENDLY: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'Not enough cash balance — you or a team member needs to add money first.',
  TOURNAMENT_FULL: 'This tournament just filled up.',
  TOURNAMENT_CLOSED: 'Registration is closed for this tournament.',
  ALREADY_REGISTERED: 'Already registered for this tournament.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  FORBIDDEN: 'Only the team captain can register the team.',
};

interface MyTeam {
  team: { id: string; name: string; tag: string; type: string; members: { userId: string }[] };
  role: string;
}

export function JoinTournament({
  slug, type, entryPerPlayer, entryPerTeam, teamSize, registrationOpen,
}: {
  slug: string; type: string; entryPerPlayer: number; entryPerTeam: number;
  teamSize: number; registrationOpen: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<'idle' | 'confirm' | 'busy' | 'done'>('idle');
  const [coupon, setCoupon] = useState('');
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ totalPaid: number; balance: string | null } | null>(null);

  // Load the player's eligible teams for team modes
  useEffect(() => {
    if (teamSize === 1 || stage !== 'confirm') return;
    const token = localStorage.getItem('cn_access');
    if (!token) return;
    fetch('/api/backend/teams/my', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) return setTeams([]);
        const need = type === 'DUO' ? 'DUO' : 'SQUAD';
        const eligible = (json.data as MyTeam[]).filter(
          (t) => t.team.type === need && t.role === 'CAPTAIN' && t.team.members.length === teamSize,
        );
        setTeams(eligible);
        if (eligible.length > 0) setTeamId(eligible[0].team.id);
      })
      .catch(() => setTeams([]));
  }, [stage, teamSize, type]);

  if (!registrationOpen) return null;

  function start() {
    const token = localStorage.getItem('cn_access');
    if (!token) return router.push(`/login?next=/tournaments/${slug}`);
    setError(null);
    setStage('confirm');
  }

  async function confirm() {
    const token = localStorage.getItem('cn_access');
    if (!token) return router.push(`/login?next=/tournaments/${slug}`);
    if (teamSize > 1 && !teamId) {
      setError('Pick your team — only full squads/duos led by you can register.');
      return;
    }
    setStage('busy');
    setError(null);
    try {
      const res = await fetch('/api/backend/tournaments/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tournamentSlug: slug,
          couponCode: coupon || undefined,
          teamId: teamSize > 1 ? teamId : undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setReceipt({ totalPaid: json.data.totalPaid, balance: json.data.cashBalanceAfter });
        setStage('done');
      } else {
        setError(FRIENDLY[json.code] ?? json.message ?? 'Could not join right now.');
        setStage('confirm');
      }
    } catch {
      setError('Could not reach the server. Please try again.');
      setStage('confirm');
    }
  }

  if (stage === 'done' && receipt) {
    return (
      <div className="rounded-input border border-success/30 bg-success/10 px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-bold text-success">
          <ShieldCheck size={16} /> You are in! Entry of {money(receipt.totalPaid)} confirmed.
        </p>
        <p className="mt-1 text-xs text-fg-2">
          Room details unlock 30 minutes before start — see{' '}
          <a href="/matches" className="font-semibold text-accent">My Matches</a>
          {receipt.balance ? ` · cash balance now ${money(receipt.balance)}` : ''}.
        </p>
      </div>
    );
  }

  if (stage === 'confirm' || stage === 'busy') {
    return (
      <div className="glass rounded-card p-5">
        <h3 className="font-display text-base font-bold text-fg">Confirm Entry</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-fg-2">Entry fee (per player)</dt><dd className="tabular font-semibold text-fg">{money(entryPerPlayer)}</dd></div>
          {teamSize > 1 && <div className="flex justify-between"><dt className="text-fg-2">Team total ({teamSize} players, each pays their share)</dt><dd className="tabular font-semibold text-fg">{money(entryPerTeam)}</dd></div>}
        </dl>

        {teamSize > 1 ? (
          teams === null ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-fg-3"><Loader2 size={13} className="animate-spin" /> Loading your teams…</p>
          ) : teams.length === 0 ? (
            <div className="mt-3 rounded-input border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              You need a full {teamSize}-player {type === 'DUO' ? 'duo' : 'squad'} where you are captain.{' '}
              <Link href="/teams" className="font-semibold underline">Manage teams</Link>
            </div>
          ) : (
            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Your team</span>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full rounded-input border border-line bg-elevated px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
              >
                {teams.map((t) => (
                  <option key={t.team.id} value={t.team.id}>
                    {t.team.name} [{t.team.tag}]
                  </option>
                ))}
              </select>
            </label>
          )
        ) : (
          <input
            value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            placeholder="Coupon code (optional)"
            className="mt-3 w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
            aria-label="Coupon code"
          />
        )}

        {error && <p role="alert" className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs font-medium text-danger">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            onClick={confirm}
            disabled={stage === 'busy'}
            className="flex flex-1 items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white transition hover:bg-accent-strong disabled:opacity-60"
          >
            {stage === 'busy' && <Loader2 size={15} className="animate-spin" />}
            Join — {money(teamSize > 1 ? entryPerPlayer : entryPerPlayer)} / player
          </button>
          <button onClick={() => setStage('idle')} disabled={stage === 'busy'} className="rounded-input border border-line px-4 text-sm font-semibold text-fg-2 hover:text-fg">
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={start}
      className="w-full rounded-input bg-accent px-8 py-3.5 text-sm font-bold text-white shadow-[0_0_28px_rgba(139,92,246,0.45)] transition hover:bg-accent-strong"
    >
      JOIN TOURNAMENT — {money(teamSize > 1 ? entryPerTeam : entryPerPlayer)}
    </button>
  );
}
