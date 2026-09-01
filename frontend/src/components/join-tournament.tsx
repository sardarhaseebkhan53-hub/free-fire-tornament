'use client';
import Link from 'next/link';
// Join tournament flow — talks to the race-safe join engine.
// Solo: direct join (+ optional coupon) — NO team, NO /teams/my call.
// Team modes: captain picks their eligible team. All authed calls go through
// the shared API client, so an expired access token is transparently
// refreshed (rotating cookie) and a genuinely signed-out user is sent to
// login instead of being blocked by a stale 401.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { money, slotLabel } from '@/lib/format';
import { api, ApiClientError } from '@/lib/client-api';

const FRIENDLY: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'Not enough PKR balance — you or a team member needs to add money first.',
  TOURNAMENT_FULL: 'This tournament just filled up.',
  TOURNAMENT_CLOSED: 'Registration is closed for this tournament.',
  ALREADY_REGISTERED: 'Already registered for this tournament.',
  VALIDATION_ERROR: 'Please check your input and try again.',
};

interface MyTeam {
  team: { id: string; name: string; tag: string; type: string; members: { userId: string }[] };
  role: string;
}

interface JoinReceipt {
  totalPaid: number;
  balance: string | null;
  seatNumber: number | null;
  match: { round: number; matchNumber: number; map: string | null; scheduledAt: string } | null;
}

export function JoinTournament({
  slug, type, entryPerPlayer, entryPerTeam, teamSize, registrationOpen, slotsLeft, maxSlots,
  allowIndependentDuo = false,
  allowIndependentSquad = false,
}: {
  slug: string; type: string; entryPerPlayer: number; entryPerTeam: number;
  teamSize: number; registrationOpen: boolean; slotsLeft: number; maxSlots: number;
  allowIndependentDuo?: boolean;
  allowIndependentSquad?: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<'idle' | 'confirm' | 'busy' | 'done'>('idle');
  const [coupon, setCoupon] = useState('');
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [receipt, setReceipt] = useState<JoinReceipt | null>(null);
  // Independent registrations (spec §Modes): a player can register solo and be
  // paired by an admin later. Gated by the platform settings surfaced on the
  // details API for both DUO and SQUAD / Clash Squad.
  const independentDuo = type === 'DUO' && teamSize === 2 && Boolean(allowIndependentDuo);
  const independentSquad = (type === 'SQUAD' || type === 'CLASH_SQUAD') && teamSize === 4 && Boolean(allowIndependentSquad);
  const independentTeam = independentDuo || independentSquad;
  const modeLabel = type === 'DUO' ? 'duo'
    : type === 'SQUAD' || type === 'CLASH_SQUAD' ? 'squad'
    : type === 'LONE_WOLF' ? 'lone wolf'
    : type === 'CLASH_SQUAD_1V1' ? '1v1'
    : 'team';
  // Free-agent is the default for Duo/Squad/Clash: most players are not captains.
  // Captains with a full eligible team are switched onto the team tab once /teams/my loads.
  const [joinMode, setJoinMode] = useState<'team' | 'solo'>('solo');
  const [uid, setUid] = useState('');
  const [ign, setIgn] = useState('');
  // "Team" path = a full team registers together (the default for team modes).
  // "Solo" path = SOLO always, plus independent DUO / SQUAD when the player
  // opts to register alone and be paired by an admin later.
  const usingTeam = teamSize > 1 && !(independentTeam && joinMode === 'solo');

  // Solo path (SOLO, independent DUO/SQUAD): prefill the player's saved Free
  // Fire identity so the join form shows what the server already has, and the
  // player can correct it at join time (the backend requires both on every
  // non-team or free-agent registration).
  const soloPath = !usingTeam;
  useEffect(() => {
    if (!soloPath || stage !== 'confirm') return;
    let cancelled = false;
    api<{ profile: { freeFireUID: string | null; freeFireIGN: string | null } | null }>('/auth/me')
      .then((me) => {
        if (cancelled) return;
        setUid(me.profile?.freeFireUID ?? '');
        setIgn(me.profile?.freeFireIGN ?? '');
      })
      .catch(() => { /* prefill is best-effort; empty fields fall back to the profile server-side */ });
    return () => { cancelled = true; };
  }, [soloPath, stage]);

  // Load the player's eligible teams for TEAM MODES ONLY. SOLO registration
  // never calls /teams/my — it is not a prerequisite (spec: solo = no team).
  useEffect(() => {
    if (teamSize === 1 || stage !== 'confirm') return;
    let cancelled = false;
    api<MyTeam[]>('/teams/my')
      .then((data) => {
        if (cancelled) return;
        const need = type === 'DUO' ? 'DUO' : 'SQUAD';
        const eligible = (data ?? []).filter(
          (t) => t.team.type === need && t.role === 'CAPTAIN' && t.team.members.length === teamSize,
        );
        setTeams(eligible);
        if (eligible.length > 0) {
          setTeamId(eligible[0].team.id);
          // Captains with a full roster land on the team tab; everyone else stays
          // on free-agent / solo so they can actually enter.
          if (independentTeam) setJoinMode('team');
        } else if (independentTeam) {
          setJoinMode('solo');
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiClientError && e.status === 401) {
          // Refresh failed — the session really is gone. Prompt sign-in
          // instead of showing a misleading "no team" state.
          setTeams([]);
          setNeedsLogin(true);
        } else {
          setTeams([]);
        }
      });
    return () => { cancelled = true; };
  }, [stage, teamSize, type, independentTeam]);

  if (!registrationOpen) return null;

  function start() {
    const token = localStorage.getItem('cn_access');
    if (!token) return router.push(`/login?next=/tournaments/${slug}`);
    setNeedsLogin(false);
    setError(null);
    setStage('confirm');
  }

  async function confirm() {
    const token = localStorage.getItem('cn_access');
    if (!token) return router.push(`/login?next=/tournaments/${slug}`);
    if (usingTeam && !teamId) {
      setError('Pick your team — only full squads/duos led by you can register.');
      return;
    }
    if (!usingTeam) {
      // The join engine requires a valid Free Fire identity on every solo /
      // free-agent registration. Validate it client-side so the user sees a
      // clear message instead of the backend's generic 400.
      const idValid = /^\d{5,15}$/.test(uid.trim());
      const ignValid = ign.trim().length >= 2 && ign.trim().length <= 24;
      if (!idValid || !ignValid) {
        setError(
          idValid || ignValid
            ? 'Free Fire UID must be 5–15 digits and your nickname 2–24 characters.'
            : 'Enter your Free Fire UID and nickname to confirm your slot.',
        );
        return;
      }
    }
    setStage('busy');
    setError(null);
    try {
      const out = await api<{
        totalPaid: number;
        cashBalanceAfter: string | null;
        seatNumber: number | null;
        match: { round: number; matchNumber: number; map: string | null; scheduledAt: string } | null;
      }>('/tournaments/join', {
        method: 'POST',
        body: {
          tournamentSlug: slug,
          couponCode: coupon || undefined,
          // Never send a leftover teamId on the free-agent path — that is what
          // made the API answer "Only the team captain can register the team"
          // while the button still said Join solo.
          teamId: usingTeam && teamId ? teamId : undefined,
          freeFireUID: !usingTeam ? uid.trim() || undefined : undefined,
          freeFireIGN: !usingTeam ? ign.trim() || undefined : undefined,
        },
      });
      setReceipt({
        totalPaid: out.totalPaid,
        balance: out.cashBalanceAfter,
        seatNumber: out.seatNumber,
        match: out.match,
      });
      setStage('done');
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(`/login?next=/tournaments/${slug}`);
        return;
      }
      if (e instanceof ApiClientError) {
        // Always prefer the server's message. Mapping every FORBIDDEN to
        // "Only the team captain…" hid the real reasons (unverified email,
        // inactive account, team changed) behind a lie.
        const message = e.message || FRIENDLY[e.code] || 'Could not join right now.';
        setError(message);
      } else {
        setError('Could not reach the server. Please try again.');
      }
      setStage('confirm');
    }
  }

  if (stage === 'done' && receipt) {
    return (
      <div className="rounded-input border border-success/30 bg-success/10 px-5 py-4" data-testid="join-receipt">
        <p className="flex items-center gap-2 text-sm font-bold text-success">
          <ShieldCheck size={16} /> You are in! Entry of {money(receipt.totalPaid)} confirmed.
        </p>
        <p className="mt-1 text-xs text-fg-2">
          {receipt.seatNumber !== null && (
            <>
              Your assigned {teamSize > 1 ? 'team ' : ''}position is{' '}
              <strong className="text-fg">{slotLabel(receipt.seatNumber)}</strong>
              {receipt.match && (
                <> · {receipt.match.map ? `${receipt.match.map} · ` : ''}Match {receipt.match.matchNumber}
                  {receipt.match.round > 1 ? ` · Round ${receipt.match.round}` : ''}</>
              )}
              {' · '}
            </>
          )}
          Room details unlock 30 minutes before start — see{' '}
          <a href="/matches" className="font-semibold text-accent">My Matches</a>
          {receipt.balance ? ` · PKR balance now ${money(receipt.balance)}` : ''}.
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

        {independentTeam && (
          <div className="mt-3 flex gap-1 rounded-input border border-line bg-white/[3%] p-1" role="tablist" aria-label="Registration mode">
            <button type="button" onClick={() => setJoinMode('team')} disabled={stage === 'busy'}
              className={`flex-1 rounded-[8px] px-2 py-1.5 text-xs font-bold transition ${joinMode === 'team' ? 'bg-accent text-white' : 'text-fg-2 hover:text-fg'}`}>
              Register my {modeLabel}
            </button>
            <button type="button" onClick={() => setJoinMode('solo')} disabled={stage === 'busy'}
              className={`flex-1 rounded-[8px] px-2 py-1.5 text-xs font-bold transition ${joinMode === 'solo' ? 'bg-accent text-white' : 'text-fg-2 hover:text-fg'}`}>
              {teamSize === 4 ? 'Register solo · admin pairs squad' : 'Register solo · paired by admin'}
            </button>
          </div>
        )}

        {usingTeam ? (
          needsLogin ? (
            <div className="mt-3 rounded-input border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              Your session expired.{' '}
              <Link href={`/login?next=/tournaments/${slug}`} className="font-semibold underline">Sign in again</Link>{' '}
              to register your team.
            </div>
          ) : teams === null ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-fg-3"><Loader2 size={13} className="animate-spin" /> Loading your teams…</p>
          ) : teams.length === 0 ? (
            <div className="mt-3 rounded-input border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              {independentTeam ? (
                <>You have no full {teamSize}-player {modeLabel} where you are captain. You can still{' '}
                  <button onClick={() => setJoinMode('solo')} className="font-semibold underline">register solo</button> and get paired by an admin, or{' '}
                  <Link href="/teams" className="font-semibold underline">manage teams</Link>.
                </>
              ) : (
                <>You need a full {teamSize}-player {modeLabel} where you are captain.{' '}
                  <Link href="/teams" className="font-semibold underline">Manage teams</Link>
                </>
              )}
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
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Free Fire UID</span>
                <input
                  value={uid}
                  onChange={(e) => setUid(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  inputMode="numeric"
                  placeholder="e.g. 5231879640"
                  className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Free Fire IGN</span>
                <input
                  value={ign}
                  onChange={(e) => setIgn(e.target.value.slice(0, 24))}
                  maxLength={24}
                  placeholder="In-game name"
                  className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
                />
              </label>
            </div>
            {independentTeam && (
              <p className="mt-3 text-xs text-fg-3">
                You&apos;ll be seated on your own; an admin pairs you with {teamSize === 4 ? 'other solo registrants' : 'another solo registrant'} before the match.
              </p>
            )}
            <input
              value={coupon}
              onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              placeholder="Coupon code (optional)"
              className="mt-3 w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
              aria-label="Coupon code"
            />
          </>
        )}

        {error && <p role="alert" data-testid="join-error" className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs font-medium text-danger">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            onClick={confirm}
            disabled={stage === 'busy'}
            data-testid="join-confirm"
            className="flex flex-1 items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white transition hover:bg-accent-strong disabled:opacity-60"
          >
            {stage === 'busy' && <Loader2 size={15} className="animate-spin" />}
            {usingTeam ? 'Join team' : 'Join solo'} — {money(entryPerPlayer)} / player
          </button>
          <button onClick={() => setStage('idle')} disabled={stage === 'busy'} className="rounded-input border border-line px-4 text-sm font-semibold text-fg-2 hover:text-fg">
            Back
          </button>
        </div>
      </div>
    );
  }

  if (slotsLeft <= 0) {
    return (
      <button
        disabled
        data-testid="join-full"
        className="w-full rounded-input border border-line bg-white/[3%] px-8 py-3.5 text-sm font-bold text-fg-3"
      >
        TOURNAMENT FULL — {maxSlots}/{maxSlots} seats taken
      </button>
    );
  }

  return (
    <button
      onClick={start}
      data-testid="join-open"
      className="w-full rounded-input bg-accent px-8 py-3.5 text-sm font-bold text-white shadow-[0_0_28px_rgba(139,92,246,0.45)] transition hover:bg-accent-strong"
    >
      JOIN TOURNAMENT — {money(teamSize > 1 ? entryPerTeam : entryPerPlayer)}
      {slotsLeft <= 5 && <span className="ml-2 rounded-pill bg-white/20 px-2 py-0.5 text-[10px] uppercase">only {slotsLeft} left</span>}
    </button>
  );
}
