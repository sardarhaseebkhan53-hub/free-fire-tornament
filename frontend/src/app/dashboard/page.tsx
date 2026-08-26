'use client';
// Player dashboard (seed of the Phase 8 user app) — real wallet + profile data
// from GET /auth/me with the bearer token.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, LogOut, Swords, Trophy, Wallet as WalletIcon, Zap } from 'lucide-react';
import { money } from '@/lib/format';
import { Avatar } from '@/components/ui';

interface Me {
  id: string;
  username: string;
  email: string;
  role: string;
  isVerified: boolean;
  referralCode: string;
  profile: { fullName: string; freeFireIGN: string | null; freeFireUID: string | null; city: string | null } | null;
  wallet: { cashBalance: string; coinBalance: string; winningBalance: string; bonusBalance: string } | null;
  stats: { matchesPlayed: number; wins: number; kills: number; totalPoints: number; earnings: string } | null;
}

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'authed' | 'anon'>('loading');

  useEffect(() => {
    const token = localStorage.getItem('cn_access');
    if (!token) {
      setState('anon');
      return;
    }
    fetch('/api/backend/auth/me', { headers: { authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const json = await r.json();
        if (json.success) {
          setMe(json.data);
          setState('authed');
        } else {
          setState('anon');
        }
      })
      .catch(() => setState('anon'));
  }, []);

  async function logout() {
    await fetch('/api/backend/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    localStorage.removeItem('cn_access');
    window.dispatchEvent(new Event('storage'));
    setState('anon');
  }

  if (state === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  if (state === 'anon' || !me) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to see your dashboard</h1>
        <p className="mt-2 text-sm text-fg-2">Wallet, matches, teams and results live here.</p>
        <Link href="/login?next=/dashboard" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">
          Sign In
        </Link>
      </div>
    );
  }

  const w = me.wallet;
  const s = me.stats;
  const winRate = s && s.matchesPlayed > 0 ? Math.round((s.wins / s.matchesPlayed) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-card p-6">
        <div className="flex items-center gap-4">
          <Avatar name={me.username} size={52} />
          <div>
            <h1 className="font-display text-xl font-bold text-fg">{me.profile?.fullName ?? me.username}</h1>
            <p className="text-sm text-fg-3">
              @{me.username} {me.profile?.freeFireIGN ? `· ${me.profile.freeFireIGN}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-pill border border-line px-3 py-1 text-xs font-semibold text-fg-2">
            Code: <span className="text-accent">{me.referralCode}</span>
          </span>
          <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-input border border-line px-3 py-1.5 text-xs font-semibold text-fg-2 hover:text-danger">
            <LogOut size={13} /> Logout
          </button>
        </div>
      </div>

      {/* Wallet */}
      <h2 className="mt-8 mb-3 flex items-center gap-2 font-display text-lg font-bold text-fg">
        <WalletIcon size={17} className="text-accent" /> Wallet
      </h2>
      {w ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Cash Balance', w.cashBalance, 'text-fg'],
            ['Tournament Credits', w.coinBalance, 'text-accent'],
            ['Winning Balance', w.winningBalance, 'text-reward'],
            ['Bonus Balance', w.bonusBalance, 'text-success'],
          ].map(([label, val, tone]) => (
            <div key={label} className="glass rounded-card px-5 py-4">
              <p className={`tabular font-display text-2xl font-bold ${tone}`}>{money(val as string)}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-fg-3">{label}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-fg-3">Wallet unavailable.</p>
      )}

      {/* Stats */}
      <h2 className="mt-8 mb-3 flex items-center gap-2 font-display text-lg font-bold text-fg">
        <Swords size={17} className="text-accent" /> Competitive Record
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Matches', String(s?.matchesPlayed ?? 0)],
          ['Wins', String(s?.wins ?? 0)],
          ['Win rate', `${winRate}%`],
          ['Kills', String(s?.kills ?? 0)],
          ['Total earnings', money(s?.earnings ?? '0')],
        ].map(([label, val]) => (
          <div key={label} className="glass rounded-card px-5 py-4">
            <p className="tabular font-display text-2xl font-bold text-fg">{val}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-fg-3">{label}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <h2 className="mt-8 mb-3 flex items-center gap-2 font-display text-lg font-bold text-fg">
        <Zap size={17} className="text-accent" /> Quick Actions
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: '/tournaments', icon: Trophy, label: 'Join Tournament', desc: 'Browse open arenas' },
          { href: '/wallet', icon: WalletIcon, label: 'Wallet', desc: 'Add money & withdraw' },
          { href: '/leaderboard', icon: Swords, label: 'Leaderboard', desc: 'Check your rank' },
          { href: '/support', icon: Zap, label: 'Support', desc: 'Tickets & WhatsApp' },
        ].map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.label} href={a.href} className="glass group rounded-card p-5 transition hover:border-accent/40">
              <Icon size={19} className="text-accent" />
              <p className="mt-3 text-sm font-bold text-fg group-hover:text-accent">{a.label}</p>
              <p className="mt-0.5 text-xs text-fg-3">{a.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
