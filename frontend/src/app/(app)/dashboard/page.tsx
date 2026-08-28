'use client';
// Player dashboard — design 12. Live wallet buckets, quick actions, upcoming
// match with countdown, recent ledger activity, top leaderboard, refer banner.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, Coins, Copy, Check, Crown, Gamepad2, Gift, Headphones,
  Lock, Plus, Target, Swords, Trophy, Upload, Users, Wallet as WalletIcon,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import { useHasSession } from '@/lib/session';
import { useNow, useTimeUntil } from '@/lib/client-time';
import { msToCountdown } from '@/lib/format';
import { TypeChip } from '@/components/wallet/bits';
import { Skeleton } from '@/components/ui';
import { TournamentImage } from '@/components/tournament-image';
import { RankBadge } from '@/components/rank-badge';
import { fmt } from '@/lib/format';
import type { RankInfo } from '@/lib/types';

interface Me {
  username: string; isVerified: boolean; referralCode: string;
  profile: { fullName: string; freeFireIGN: string | null; freeFireUID: string | null } | null;
  wallet: { cashBalance: number; coinBalance: number; winningBalance: number; bonusBalance: number } | null;
  stats: { matchesPlayed: number; wins: number; kills: number; totalPoints: number; earnings: string } | null;
  rankInfo?: RankInfo;
}
interface Reg {
  id: string; status: string; registeredAt: string; seatNumber: number | null;
  tournament: { id: string; title: string; slug: string; type: string; map: string | null; status: string; startTime: string; banner: string | null };
  team: { name: string; tag: string } | null;
}
interface Tx { id: string; type: string; amount: number; direction: string; createdAt: string; description: string | null }
interface LbRow { rank: number; user: { username: string; profile: { freeFireIGN: string | null } }; totalPoints: number }

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [lb, setLb] = useState<LbRow[]>([]);
  const [loaded, setLoaded] = useState<'loading' | 'authed' | 'anon'>('loading');
  const [copied, setCopied] = useState(false);
  const hasSession = useHasSession();
  const now = useNow(30_000);
  // No token → anonymous without waiting for a request.
  const state = hasSession === false ? 'anon' : hasSession === null ? 'loading' : loaded;

  useEffect(() => {
    if (!hasSession) return;
    Promise.all([
      api<Me>('/auth/me'),
      api<Reg[]>('/tournaments/my').catch(() => []),
      api<{ items: Tx[]; recentTransactions?: Tx[] }>('/wallet/transactions?pageSize=5').catch(() => ({ items: [] as Tx[] })),
      fetch('/api/backend/public/leaderboard?limit=5').then((r) => r.json()).then((j) => j.data.items as LbRow[]).catch(() => []),
    ])
      .then(([m, r, w, l]) => {
        setMe(m);
        setRegs(r);
        setTxs((w as { items?: Tx[] }).items ?? []);
        setLb(l ?? []);
        setLoaded('authed');
      })
      .catch(() => setLoaded('anon'));
  }, [hasSession]);

  const upcoming = useMemo(
    () => regs
      .filter((r) => r.status === 'CONFIRMED' && new Date(r.tournament.startTime).getTime() > (now ?? 0) - 3 * 3600_000)
      .sort((a, b) => +new Date(a.tournament.startTime) - +new Date(b.tournament.startTime))[0],
    [regs, now],
  );

  if (state === 'loading') {
    // Skeleton mirrors the real layout (title + bucket cards + rows) so the
    // page shape is stable and nothing jumps when data lands.
    return (
      <div className="mx-auto max-w-6xl" aria-busy="true" aria-label="Loading dashboard">
        <Skeleton className="h-8 w-64" />
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }
  if (state === 'anon' || !me) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to see your dashboard</h1>
        <p className="mt-2 text-sm text-fg-2">Wallet, matches, teams and results live here.</p>
        <Link href="/login?next=/dashboard" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">Sign In</Link>
      </div>
    );
  }

  const w = me.wallet ?? { cashBalance: 0, coinBalance: 0, winningBalance: 0, bonusBalance: 0 };
  // ONE primary PKR wallet: the money you can actually use — entries (cash)
  // plus winnings (withdrawable). No artificial coins on player screens.
  const availableBalance = Number(w.cashBalance) + Number(w.winningBalance);
  const s = me.stats ?? { matchesPlayed: 0, wins: 0, kills: 0, totalPoints: 0, earnings: '0' };
  const winRate = s.matchesPlayed > 0 ? Math.round((s.wins / s.matchesPlayed) * 1000) / 10 : 0;

  const bucketCards = [
    { label: 'AVAILABLE BALANCE (PKR)', value: availableBalance, icon: WalletIcon, tone: 'text-fg', chip: 'bg-success/15 text-success', link: { label: 'Add Money', href: '/wallet/add-money' } },
    { label: 'WINNINGS · WITHDRAWABLE', value: w.winningBalance, icon: Trophy, tone: 'text-reward', chip: 'bg-reward/15 text-reward', gold: true, link: { label: 'Withdraw', href: '/wallet/withdraw' } },
    ...(Number(w.bonusBalance) > 0
      ? [{ label: 'BONUS (PKR)', value: w.bonusBalance, icon: Gift, tone: 'text-success', chip: 'bg-success/15 text-success', link: { label: 'View Details', href: '/wallet' } }]
      : []),
  ];

  async function copyInvite() {
    const url = `${window.location.origin}/register?ref=${me!.referralCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">
        Welcome back, <span className="text-accent">{me.profile?.freeFireIGN ?? me.username}</span>{' '}
        {me.isVerified && <Crown size={20} className="mb-1 inline text-reward" />}
        {me.rankInfo && <RankBadge rankInfo={me.rankInfo} small />}
      </h1>

      {/* MOBILE — design 42: wallet balance card + quick actions */}
      <div className="mt-4 lg:hidden">
        <div className="relative overflow-hidden rounded-card border border-accent/25 bg-gradient-to-r from-accent/[14%] via-surface to-surface p-5">
          <WalletIcon size={54} className="absolute right-4 top-4 text-accent/40" aria-hidden />
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-3">Available Balance</p>
          <p className="tabular mt-1 font-display text-3xl font-bold text-fg">
            {fmt(availableBalance)}
          </p>
          <div className="mt-4 flex gap-3">
            <Link href="/wallet/add-money" className="flex flex-1 items-center justify-center gap-1.5 rounded-input bg-accent py-2.5 text-xs font-bold text-white shadow-[0_4px_18px_rgba(139,92,246,0.4)]">
              <Plus size={14} /> Add Money
            </Link>
            <Link href="/wallet/withdraw" className="flex flex-1 items-center justify-center gap-1.5 rounded-input border border-line bg-white/[3%] py-2.5 text-xs font-bold text-fg">
              <Upload size={14} /> Withdraw
            </Link>
          </div>
        </div>

        <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.18em] text-fg-3">Quick Actions</p>
        <div className="grid grid-cols-4 gap-2.5">
          {[
            { label: 'Join', sub: 'Matches', href: '/tournaments', icon: Gamepad2 },
            { label: 'Teams', sub: 'My Team', href: '/teams', icon: Users },
            { label: 'Wallet', sub: 'Balance', href: '/wallet', icon: WalletIcon },
            { label: 'Support', sub: 'Help Center', href: '/support', icon: Headphones },
          ].map((a) => {
            const Icon = a.icon;
            return (
              <Link key={a.label} href={a.href} className="glass flex flex-col items-center gap-1.5 rounded-card px-2 py-3.5 text-center transition hover:border-accent/40">
                <Icon size={20} className="text-accent" />
                <span className="text-[11px] font-bold leading-none text-fg">{a.label}</span>
                <span className="text-[9px] leading-none text-fg-3">{a.sub}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Bucket cards (desktop — design 12) */}
      <div className="mt-6 hidden gap-4 sm:grid-cols-2 lg:grid xl:grid-cols-4">
        {bucketCards.map((b) => {
          const Icon = b.icon;
          return (
            <div key={b.label} className={`glass rounded-card p-5 ${b.gold ? 'border-reward/30 bg-reward/[3%]' : ''}`}>
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-full ${b.chip}`}>
                  <Icon size={17} />
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">{b.label}</p>
              </div>
              <p className={`tabular mt-3 font-display text-3xl font-bold ${b.tone}`}>{fmt(b.value)}</p>
              <Link href={b.link.href} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-accent hover:underline">
                {b.link.label} <ArrowRight size={13} />
              </Link>
            </div>
          );
        })}
      </div>

      {/* Quick actions (desktop — design 12) */}
      <div className="mt-4 hidden grid-cols-2 gap-4 lg:grid xl:grid-cols-4">
        <Link href="/tournaments" className="flex items-center justify-center gap-2 rounded-card bg-gradient-to-r from-accent to-accent-strong px-4 py-3.5 font-display text-sm font-bold text-white shadow-[0_6px_20px_rgba(139,92,246,0.35)] transition hover:brightness-110">
          <Swords size={17} /> Join Tournament <ArrowRight size={15} />
        </Link>
        <Link href="/wallet/add-money" className="glass flex items-center justify-center gap-2 rounded-card px-4 py-3.5 font-display text-sm font-bold text-fg transition hover:border-accent/40">
          <WalletIcon size={17} className="text-accent" /> Add Money
        </Link>
        <Link href="/teams" className="glass flex items-center justify-center gap-2 rounded-card px-4 py-3.5 font-display text-sm font-bold text-fg transition hover:border-accent/40">
          <Users size={17} className="text-accent" /> Create Team
        </Link>
        <Link href="/wallet/withdraw" className="glass flex items-center justify-center gap-2 rounded-card px-4 py-3.5 font-display text-sm font-bold text-fg transition hover:border-accent/40">
          <WalletIcon size={17} className="text-reward" /> Withdraw
        </Link>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        {/* Left: upcoming match + stats + refer */}
        <div className="flex flex-col gap-5">
          <section className="glass rounded-card p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Upcoming Match</p>
            {upcoming ? (
              <UpcomingMatch reg={upcoming} />
            ) : (
              <div className="mt-4 flex flex-col items-start gap-3 rounded-card border border-line bg-white/[2%] p-5">
                <p className="font-display text-base font-semibold text-fg">No matches on the horizon</p>
                <p className="text-sm text-fg-2">Join an open tournament and the countdown appears here.</p>
                <Link href="/tournaments" className="rounded-input bg-accent px-4 py-2 text-xs font-bold text-white">Browse Tournaments</Link>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 divide-line rounded-card border border-line bg-base/50 sm:grid-cols-4 sm:divide-x">
              {[
                { label: 'MATCHES PLAYED', value: String(s.matchesPlayed), icon: Gamepad2 },
                { label: 'MATCHES WON', value: String(s.wins), icon: Trophy },
                { label: 'WIN RATE', value: `${winRate}%`, icon: Target },
                { label: 'TOTAL WINNINGS', value: fmt(Number(s.earnings)), icon: Coins, tone: 'text-reward' },
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="flex items-center gap-3 px-4 py-3.5">
                    <Icon size={18} className={`shrink-0 ${stat.tone ?? 'text-accent'}`} />
                    <div>
                      <p className="text-[10px] font-semibold tracking-wide text-fg-3">{stat.label}</p>
                      <p className={`tabular font-display text-lg font-bold ${stat.tone ?? 'text-fg'}`}>{stat.value}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <Link
            href="/tournaments"
            className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-card border border-accent/30 bg-gradient-to-r from-accent/[12%] via-surface to-surface p-5 transition hover:border-accent/60"
          >
            <div>
              <p className="font-display text-xl font-bold text-fg">REFER &amp; EARN</p>
              <p className="mt-0.5 text-sm text-fg-2">
                Earn up to <span className="font-bold text-reward">PKR 500</span> for every friend you invite!
              </p>
              <p className="mt-1 text-[11px] text-fg-3">Your code: <span className="font-mono font-bold text-accent">{me.referralCode}</span></p>
            </div>
            <button
              onClick={(e) => { e.preventDefault(); copyInvite(); }}
              className="flex items-center gap-2 rounded-input bg-accent px-4 py-2.5 text-xs font-bold text-white transition hover:brightness-110"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Invite link copied!' : 'Copy invite link'}
            </button>
            <span className="pointer-events-none absolute -right-6 -top-6 text-[120px] opacity-[6%]" aria-hidden>🎁</span>
          </Link>
        </div>

        {/* Right: recent transactions + leaderboard */}
        <div className="flex flex-col gap-5">
          <section className="glass rounded-card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Recent Transactions</p>
              <Link href="/wallet/transactions" className="text-xs font-semibold text-accent hover:underline">View All →</Link>
            </div>
            <div className="mt-3 flex flex-col divide-y divide-line/60">
              {txs.length === 0 && <p className="py-4 text-sm text-fg-3">No transactions yet.</p>}
              {txs.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <TypeChip type={t.type} />
                    <p className="mt-0.5 truncate pl-9 text-[11px] text-fg-3">
                      {t.description ?? ''} · {new Date(t.createdAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                    </p>
                  </div>
                  <span className={`tabular shrink-0 text-sm font-bold ${t.direction === 'CREDIT' ? 'text-success' : 'text-danger'}`}>
                    {t.direction === 'CREDIT' ? '+' : '-'}{fmt(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="glass rounded-card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Top Leaderboard</p>
              <Link href="/leaderboard" className="text-xs font-semibold text-accent hover:underline">View Full Leaderboard →</Link>
            </div>
            <div className="mt-2 flex flex-col divide-y divide-line/60">
              {lb.map((row) => (
                <div key={row.rank} className={`flex items-center gap-3 py-2.5 ${row.user.username === me.username ? 'rounded-input bg-accent/10 px-2' : ''}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    row.rank === 1 ? 'bg-reward/20 text-reward' : row.rank === 2 ? 'bg-white/10 text-fg-2' : row.rank === 3 ? 'bg-[#cd7f32]/20 text-[#e0954f]' : 'text-fg-3'
                  }`}>
                    {row.rank}
                  </span>
                  <Link href={`/players/${row.user.username}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-fg hover:text-accent">
                    {row.user.profile?.freeFireIGN ?? row.user.username}
                  </Link>
                  <span className="tabular text-sm font-bold text-fg">{row.totalPoints.toLocaleString('en-PK')}</span>
                </div>
              ))}
              {lb.length === 0 && <p className="py-4 text-sm text-fg-3">Leaderboard warming up.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function UpcomingMatch({ reg }: { reg: Reg }) {
  const left = useTimeUntil(reg.tournament.startTime) ?? 0;
  const days = Math.max(0, Math.floor(left / 86_400_000));
  const hrs = Math.max(0, Math.floor((left % 86_400_000) / 3600_000));
  const mins = Math.max(0, Math.floor((left % 3600_000) / 60_000));
  const secs = Math.max(0, Math.floor((left % 60_000) / 1000));

  return (
    <div className="mt-4 grid gap-5 sm:grid-cols-[200px_1fr]">
      <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-card border border-accent/25 bg-gradient-to-br from-accent/25 via-surface to-base text-center sm:h-auto">
        {reg.tournament.banner ? (
          <TournamentImage
            src={reg.tournament.banner}
            alt={reg.tournament.title}
            label={reg.tournament.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div>
            <Swords size={30} className="mx-auto text-accent" />
            <p className="mt-2 font-display text-lg font-bold uppercase text-fg">{reg.tournament.type.replace('_', ' ')}</p>
            <p className="text-xs text-fg-3">Showdown time</p>
          </div>
        )}
        {reg.seatNumber !== null && reg.status === 'CONFIRMED' && (
          <span className="absolute left-2 top-2 rounded-pill bg-base/80 px-2.5 py-1 text-[10px] font-bold text-accent backdrop-blur">
            SEAT #{String(reg.seatNumber).padStart(2, '0')}
          </span>
        )}
      </div>
      <div>
        <span className="rounded-pill bg-accent/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-accent">Tournament</span>
        <h2 className="mt-2 font-display text-xl font-bold text-fg">
          <Link href={`/tournaments/${reg.tournament.slug}`} className="hover:text-accent">{reg.tournament.title}</Link>
        </h2>
        <p className="mt-1 text-xs text-fg-3">
          {reg.team ? `${reg.team.name} [${reg.team.tag}] · ` : ''}{reg.tournament.type.replace('_', ' ')}{reg.tournament.map ? ` · ${reg.tournament.map}` : ''}
        </p>
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-fg-3">Starts In</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          {[['DAYS', days], ['HRS', hrs], ['MINS', mins], ['SECS', secs]].map(([label, v]) => (
            <div key={label as string} className="flex items-center gap-1.5">
              <div className="min-w-11 rounded-input border border-line bg-base/70 px-2 py-1.5 text-center">
                <p className="tabular font-display text-lg font-bold text-fg">{String(v).padStart(2, '0')}</p>
                <p className="text-[8px] font-bold tracking-wider text-fg-3">{label}</p>
              </div>
              {label !== 'SECS' && <span className="text-fg-3">·</span>}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2.5 rounded-input border border-line bg-base/60 px-3.5 py-2.5">
          <Lock size={14} className="text-warning" />
          <p className="text-xs text-fg-2">
            Room is locked — credentials unlock in My Matches{' '}
            <span className="text-warning">{msToCountdown(Math.max(0, left - 30 * 60_000))}</span> before start.
          </p>
        </div>
      </div>
    </div>
  );
}
