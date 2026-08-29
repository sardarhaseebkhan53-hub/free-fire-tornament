'use client';
// Team details — members, FF identities, invite/remove/transfer/leave (spec §36).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Copy, Crown, Loader2, RefreshCcw, Shield } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { money } from '@/lib/format';
import { deferLoad } from '@/lib/session';
import { authedFetch } from '@/lib/client-api';
import { useToast } from '@/components/toast';

interface Member {
  userId: string; role: string; joinedAt: string;
  user: {
    username: string;
    profile: { freeFireUID: string | null; freeFireIGN: string | null; fullName: string } | null;
    stats: { wins: number; matchesPlayed: number; kills: number; totalPoints: number } | null;
  };
}
interface Team {
  id: string; name: string; tag: string; type: string; captainId: string;
  joinCode: string | null;
  captain: { username: string };
  members: Member[];
  registrations: { registeredAt: string; tournament: { title: string; slug: string; type: string; status: string } }[];
  winnings: { position: number; amount: string; creditedAt: string }[];
}


export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = params.id;
  const { toast } = useToast();
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem('cn_access');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setMeId(payload.sub);
      } catch { /* ignore */ }
    }
    const res = await authedFetch(`/teams/${teamId}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      setError(res.status === 403 ? 'Only members of this team can view its roster.' : (json.message ?? 'Team not found.'));
      return;
    }
    setError(null);
    setTeam(json.data);
    // Every team is created with a join code now; show it immediately instead
    // of waiting for the separate join-code GET (kept as a fallback below for
    // legacy teams created before the fix).
    if (json.data?.joinCode) setJoinCode(json.data.joinCode);
  }, [teamId]);

  useEffect(() => { deferLoad(load); }, [load]);

  /** Run an action, show its outcome, reload on success. Returns true on success
   * so callers can reset form state only when the action actually succeeded. */
  async function act(fn: () => Promise<Response>, okText: string, failText = 'Action failed'): Promise<boolean> {
    setBusy(true); setMsg(null);
    try {
      const json = await (await fn()).json();
      if (json.success) {
        setMsg({ ok: true, text: okText });
        toast({ tone: 'success', title: okText });
        load();
        return true;
      }
      // Validation failures carry the real reason in errors[] (e.g. "Username
      // must be at least 3 characters") while message is just "Validation
      // failed" — show the field message so users know what to fix.
      const detail = json.errors?.[0];
      const text = detail ? `${detail.path}: ${detail.message}` : (json.message ?? failText);
      setMsg({ ok: false, text });
      toast({ tone: 'error', title: failText, description: text });
      return false;
    } catch {
      const text = 'Could not reach the server.';
      setMsg({ ok: false, text });
      toast({ tone: 'error', title: failText, description: text });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Captains see the shareable join code (spec §8): GET returns the existing
  // code, `?rotate=1` rotates it server-side (captain-only endpoint).
  useEffect(() => {
    if (!team || meId !== team.captainId) return;
    let cancelled = false;
    authedFetch(`/teams/${teamId}/join-code`)
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: { code?: string } }) => {
        if (!cancelled && j.success && j.data?.code) setJoinCode(j.data.code);
      })
      .catch(() => { /* non-fatal — the section just shows nothing yet */ });
    return () => { cancelled = true; };
  }, [team, meId, teamId]);

  async function rotateCode() {
    setBusy(true); setMsg(null);
    try {
      const res = await authedFetch(`/teams/${teamId}/join-code?rotate=1`);
      const json = await res.json();
      if (json.success && json.data?.code) setJoinCode(json.data.code);
      if (json.success) {
        setMsg({ ok: true, text: 'New code generated — the old one stopped working.' });
        toast({ tone: 'success', title: 'New join code generated' });
      } else {
        setMsg({ ok: false, text: json.message ?? 'Rotation failed' });
        toast({ tone: 'error', title: 'Rotation failed', description: json.message ?? 'Try again.' });
      }
    } catch {
      const text = 'Could not reach the server.';
      setMsg({ ok: false, text });
      toast({ tone: 'error', title: 'Rotation failed', description: text });
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!joinCode) return;
    const ok = await navigator.clipboard?.writeText(joinCode).then(() => true).catch(() => false) ?? false;
    if (ok) toast({ tone: 'success', title: 'Join code copied', description: joinCode });
    else toast({ tone: 'error', title: 'Copy failed', description: 'Select the code and copy it manually.' });
    setMsg({ ok: true, text: 'Join code copied to clipboard.' });
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Team unavailable</h1>
        <p className="mt-2 text-sm text-fg-2">{error}</p>
        <Link href="/teams" className="mt-6 inline-block rounded-input bg-accent px-5 py-2.5 text-sm font-bold text-white">Back to teams</Link>
      </div>
    );
  }
  if (!team) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 size={24} className="animate-spin text-accent" /></div>;
  }

  const isCaptain = meId !== null && meId === team.captainId;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/teams" className="text-sm font-semibold text-fg-3 hover:text-accent">← My teams</Link>
      <div className="glass mt-4 rounded-card p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={team.name} size={56} />
          <div>
            <h1 className="font-display text-2xl font-bold text-fg">{team.name} <span className="text-fg-3">[{team.tag}]</span></h1>
            <p className="text-sm text-fg-3">{team.type} · captain {team.captain.username}</p>
          </div>
        </div>
      </div>

      {/* Members */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-fg-3">Members ({team.members.length}/{team.type === 'DUO' ? 2 : 4})</h2>
        <div className="space-y-3">
          {team.members.map((m) => (
            <div key={m.user.username} className="glass flex flex-wrap items-center justify-between gap-3 rounded-card px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={m.user.username} size={38} />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold text-fg">
                    {m.user.username}
                    {m.role === 'CAPTAIN' && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-reward"><Crown size={11} /> Captain</span>}
                  </p>
                  <p className="truncate text-xs text-fg-3">
                    {m.user.profile?.freeFireIGN ?? m.user.profile?.fullName ?? '—'}
                    {m.user.profile?.freeFireUID ? ` · UID ${m.user.profile.freeFireUID}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {m.user.stats && (
                  <p className="tabular hidden text-xs text-fg-3 sm:block">
                    {m.user.stats.wins}W / {m.user.stats.matchesPlayed}M · {m.user.stats.kills} kills
                  </p>
                )}
                {isCaptain && m.userId !== team.captainId && (
                  <div className="flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() => act(() => authedFetch(`/teams/${teamId}/transfer`, { method: 'POST', body: JSON.stringify({ userId: m.userId }) }), 'Captaincy transferred')}
                      className="rounded-input border border-line px-3 py-1.5 text-xs font-semibold text-fg-2 hover:text-reward"
                    >
                      Make captain
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => act(() => authedFetch(`/teams/${teamId}/remove`, { method: 'POST', body: JSON.stringify({ userId: m.userId }) }), 'Member removed')}
                      className="rounded-input border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Captain tools */}
      {isCaptain && team.members.length < (team.type === 'DUO' ? 2 : 4) && (
        <section className="glass mt-8 rounded-card p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-fg-3">Share join code</h2>
          <p className="mt-1 text-xs text-fg-3">Anyone with this code can join your {team.type.toLowerCase()} instantly — no invite needed.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-input border border-line bg-white/[4%] px-4 py-2.5 font-mono text-sm font-bold tracking-wide text-accent">
              {joinCode ?? '…'}
            </span>
            <button
              onClick={copyCode}
              disabled={!joinCode}
              className="inline-flex items-center gap-1.5 rounded-input border border-line px-3 py-2.5 text-xs font-semibold text-fg-2 transition hover:border-accent hover:text-accent disabled:opacity-40"
            >
              <Copy size={13} /> Copy
            </button>
            <button
              onClick={rotateCode}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-input border border-warning/30 px-3 py-2.5 text-xs font-semibold text-warning transition hover:bg-warning/10 disabled:opacity-40"
            >
              <RefreshCcw size={13} /> New code
            </button>
          </div>
        </section>
      )}

      {/* Captain tools */}
      {isCaptain && team.members.length < (team.type === 'DUO' ? 2 : 4) && (
        <section className="glass mt-8 rounded-card p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-fg-3">Invite a player</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await act(
                () => authedFetch(`/teams/${teamId}/invite`, { method: 'POST', body: JSON.stringify({ username: inviteName }) }),
                'Invite sent',
              );
              // Only clear the field after a real success — a failed invite
              // keeps the typed username so the captain can fix it.
              if (ok) setInviteName('');
            }}
          >
            <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} required placeholder="username" autoComplete="off"
              className="flex-1 rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent" />
            <button type="submit" disabled={busy} className="rounded-input bg-accent px-5 text-sm font-bold text-white hover:bg-accent-strong disabled:opacity-60">Invite</button>
          </form>
          <p className="mt-2 text-[11px] text-fg-3">Invite by the player&apos;s exact username (e.g. <span className="font-mono text-fg-2">areeb_ff</span>) — case doesn&apos;t matter.</p>
        </section>
      )}

      {!isCaptain && (
        <section className="mt-8">
          <button
            disabled={busy}
            onClick={() => act(() => authedFetch(`/teams/${teamId}/leave`, { method: 'POST' }), 'You left the team')}
            className="rounded-input border border-danger/30 px-5 py-2.5 text-sm font-semibold text-danger"
          >
            Leave team
          </button>
        </section>
      )}

      {msg && <p className={`mt-5 rounded-input px-3 py-2.5 text-xs font-medium ${msg.ok ? 'border border-success/30 bg-success/10 text-success' : 'border border-danger/30 bg-danger/10 text-danger'}`}>{msg.text}</p>}

      {/* History */}
      {(team.registrations.length > 0 || team.winnings.length > 0) && (
        <section className="mt-10 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-fg-3">Tournament history</h2>
            <div className="space-y-2">
              {team.registrations.map((r, i) => (
                <Link key={i} href={`/tournaments/${r.tournament.slug}`} className="glass block rounded-input px-4 py-3 text-sm text-fg-2 transition hover:border-accent/40">
                  <span className="font-semibold text-fg">{r.tournament.title}</span>
                  <span className="ml-2 text-xs text-fg-3">{r.tournament.status}</span>
                </Link>
              ))}
            </div>
          </div>
          <div>
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-fg-3"><Shield size={12} /> Winnings</h2>
            <div className="space-y-2">
              {team.winnings.length === 0 && <p className="text-sm text-fg-3">No payouts yet.</p>}
              {team.winnings.map((w, i) => (
                <p key={i} className="glass rounded-input px-4 py-3 text-sm text-fg-2">
                  #{w.position} — <span className="tabular font-bold text-reward">{money(w.amount)}</span>
                </p>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
