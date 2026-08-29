'use client';
// Teams — my teams, pending invites, create team (spec §36).
// All authed calls go through the shared API client: an expired access token
// is refreshed transparently (rotating cookie) and only a genuinely dead
// session falls back to the sign-in screen — never a raw 401 in the console.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Loader2, Shield, Users } from 'lucide-react';
import { Avatar, EmptyState } from '@/components/ui';
import { deferLoad } from '@/lib/session';
import { api, ApiClientError } from '@/lib/client-api';
import { useToast } from '@/components/toast';

interface MyTeam {
  role: string;
  team: {
    id: string; name: string; tag: string; type: string;
    joinCode: string | null;
    members: { userId: string }[];
    captain: { username: string };
  };
}
interface Invite {
  id: string; status: string; message: string | null;
  team: { id: string; name: string; tag: string; type: string };
  invitedBy: { username: string };
}

export default function TeamsPage() {
  const { toast } = useToast();
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [anon, setAnon] = useState(false);
  const [form, setForm] = useState({ name: '', tag: '', type: 'SQUAD' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [joinCode, setJoinCode] = useState('');

  const load = useCallback(async () => {
    if (!localStorage.getItem('cn_access')) return setAnon(true);
    try {
      const [t, i] = await Promise.all([
        api<MyTeam[]>('/teams/my'),
        api<Invite[]>('/teams/invites/my').catch(() => []),
      ]);
      setTeams(t);
      setInvites(i);
    } catch (e) {
      // Refresh failed → the session really is gone (or never existed).
      if (e instanceof ApiClientError && e.status === 401) setAnon(true);
      else setTeams([]);
    }
  }, []);

  useEffect(() => { deferLoad(load); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const created = await api<{ name: string; joinCode: string | null }>('/teams', {
        method: 'POST', body: form,
      });
      setMsg({
        ok: true,
        text: created.joinCode
          ? `Team ${created.name} created — join code ${created.joinCode}. Share it with your squad!`
          : `Team ${created.name} created — invite your squad!`,
      });
      toast({
        tone: 'success',
        title: 'Team created',
        description: created.joinCode
          ? `Join code ${created.joinCode} — share it with your squad.`
          : 'Invite your squad to join.',
      });
      setForm({ name: '', tag: '', type: 'SQUAD' });
      load();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) return setAnon(true);
      const text = err instanceof ApiClientError ? (err.message ?? 'Could not create team.') : 'Could not create team.';
      setMsg({ ok: false, text });
      toast({ tone: 'error', title: 'Could not create team', description: text });
    } finally {
      setBusy(false);
    }
  }

  async function respond(inviteId: string, accept: boolean) {
    try {
      await api(`/teams/invites/${inviteId}/${accept ? 'accept' : 'decline'}`, { method: 'POST' });
    } catch {
      /* re-render state comes from the reload below */
    }
    load();
  }

  async function joinByCode(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const out = await api<{ name: string; tag: string }>('/teams/join', { method: 'POST', body: { code: joinCode.trim() } });
      setMsg({ ok: true, text: `Joined ${out.name} [${out.tag}] — welcome to the team!` });
      toast({ tone: 'success', title: 'Joined the team', description: `${out.name} [${out.tag}] — welcome!` });
      setJoinCode('');
      load();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) return setAnon(true);
      const text = err instanceof ApiClientError ? (err.message ?? 'Could not join that team.') : 'Could not join that team.';
      setMsg({ ok: false, text });
      toast({ tone: 'error', title: 'Could not join', description: text });
    } finally {
      setBusy(false);
    }
  }

  if (anon) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to manage teams</h1>
        <Link href="/login?next=/teams" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">Sign In</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-2xl font-bold text-fg">Teams</h1>
      <p className="mt-1 text-sm text-fg-2">Build your duo or squad, invite teammates, enter team tournaments together.</p>

      {/* Invites */}
      {invites.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-fg-3">Pending invites</h2>
          <div className="space-y-3">
            {invites.map((inv) => (
              <div key={inv.id} className="glass flex flex-wrap items-center justify-between gap-3 rounded-card px-5 py-4">
                <div className="flex items-center gap-3">
                  <Avatar name={inv.team.name} size={38} />
                  <div>
                    <p className="text-sm font-bold text-fg">{inv.team.name} <span className="text-fg-3">[{inv.team.tag}]</span></p>
                    <p className="text-xs text-fg-3">{inv.team.type} · invited by {inv.invitedBy.username}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => respond(inv.id, true)} className="rounded-input bg-success px-4 py-2 text-xs font-bold text-white">Accept</button>
                  <button onClick={() => respond(inv.id, false)} className="rounded-input border border-line px-4 py-2 text-xs font-semibold text-fg-2">Decline</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My teams */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-fg-3">My teams</h2>
        {teams === null ? (
          <p className="flex items-center gap-2 text-sm text-fg-3"><Loader2 size={15} className="animate-spin" /> Loading…</p>
        ) : teams.length === 0 ? (
          <EmptyState title="No team yet" sub="Create a duo or squad below — you will be the captain." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {teams.map(({ team, role }) => (
              <Link key={team.id} href={`/teams/${team.id}`} className="glass rounded-card p-5 transition hover:border-accent/40">
                <div className="flex items-center gap-3">
                  <Avatar name={team.name} size={44} />
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-fg">{team.name} <span className="text-fg-3">[{team.tag}]</span></p>
                    <p className="text-xs text-fg-3">{team.type} · {team.members.length}/{team.type === 'DUO' ? 2 : 4} members</p>
                  </div>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold">
                  {role === 'CAPTAIN'
                    ? <><Shield size={13} className="text-reward" /> <span className="text-reward">Captain</span></>
                    : <><Users size={13} className="text-fg-3" /> <span className="text-fg-3">Member — captain: {team.captain.username}</span></>}
                </p>
                {role === 'CAPTAIN' && team.joinCode && (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-input border border-accent/30 bg-accent/10 px-3 py-1.5 font-mono text-xs font-bold tracking-wide text-accent">
                    <Copy size={12} /> {team.joinCode}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Join by code */}
      <section className="mt-10">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-fg-3">Join with a code</h2>
        <form onSubmit={joinByCode} className="glass flex max-w-lg flex-wrap items-center gap-2 rounded-card p-5">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="e.g. CNX-7K2F"
            aria-label="Team join code"
            className="min-w-40 flex-1 rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 font-mono text-sm text-fg outline-none placeholder:font-sans placeholder:text-fg-3 focus:border-accent"
          />
          <button type="submit" disabled={busy || !joinCode.trim()} className="rounded-input bg-accent px-5 py-2.5 text-sm font-bold text-white transition hover:bg-accent-strong disabled:opacity-60">
            Join team
          </button>
        </form>
      </section>

      {/* Create */}
      <section className="mt-10">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-fg-3">Create a team</h2>
        <form onSubmit={create} className="glass max-w-lg rounded-card p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Team name</span>
              <input required minLength={3} maxLength={24} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent" placeholder="Hyderabad Hawks" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Tag (2–5)</span>
              <input required minLength={2} maxLength={5} value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value.toUpperCase() })}
                className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent" placeholder="HHK" />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            {(['SQUAD', 'DUO'] as const).map((tt) => (
              <button key={tt} type="button" onClick={() => setForm({ ...form, type: tt })}
                className={`rounded-pill border px-4 py-1.5 text-xs font-semibold transition ${form.type === tt ? 'border-accent bg-accent/15 text-accent' : 'border-line text-fg-2'}`}>
                {tt === 'SQUAD' ? 'Squad (4)' : 'Duo (2)'}
              </button>
            ))}
          </div>
          {msg && <p className={`mt-4 rounded-input px-3 py-2.5 text-xs font-medium ${msg.ok ? 'border border-success/30 bg-success/10 text-success' : 'border border-danger/30 bg-danger/10 text-danger'}`}>{msg.text}</p>}
          <button type="submit" disabled={busy} className="mt-5 flex items-center justify-center gap-2 rounded-input bg-accent px-6 py-3 text-sm font-bold text-white transition hover:bg-accent-strong disabled:opacity-60">
            {busy && <Loader2 size={15} className="animate-spin" />} Create Team
          </button>
        </form>
      </section>
    </div>
  );
}
