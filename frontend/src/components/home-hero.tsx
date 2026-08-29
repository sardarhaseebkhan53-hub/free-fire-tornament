'use client';
// Animated home hero — aurora atmosphere, shimmering gradient headline, live
// match glass card with a real countdown (server-computed startsInMs), recent
// wins ticker and trust strip. Data arrives as serializable props from the
// server page; every clock value flows through the client-time hooks so SSR
// and hydration always agree.
import Link from 'next/link';
import { ArrowRight, Play, ShieldCheck } from 'lucide-react';
import { useNow, useTimeUntil } from '@/lib/client-time';
import { StatCard } from '@/components/ui';
import { InstallButton } from '@/components/pwa';
import { money, MODE_LABEL } from '@/lib/format';

export interface HeroTournament {
  slug: string;
  title: string;
  type: string;
  entryFeePerPlayer: number;
  prizePool: number;
  registeredSlots: number;
  maxSlots: number;
  startsInMs: number | null;
  registrationOpen: boolean;
}

export interface HeroWinner {
  amount: string;
  user: { username: string } | null;
  team: { name: string; tag: string } | null;
  tournament: { title: string };
}

export interface HeroStats {
  totalPlayers: number;
  totalTournaments: number;
  liveTournaments: number;
  totalPrizeDistributed: string;
}

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/** Countdown split into H/M/S boxes; renders placeholders until the first
 * client clock sample so hydration matches the server output. The hook lives
 * in its own component so it is never called conditionally. */
function TimeBoxes({ targetMs }: { targetMs: number | null }) {
  return targetMs === null ? <StaticBoxes values={['--', '--', '--']} /> : <LiveBoxes targetMs={targetMs} />;
}

function StaticBoxes({ values }: { values: string[] }) {
  return (
    <>
      {['Hrs', 'Min', 'Sec'].map((u, i) => (
        <div key={u} className="flex-1 rounded-input border border-line bg-base/60 px-1 py-2 text-center">
          <b className="tabular block font-display text-xl font-bold text-fg">{values[i]}</b>
          <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-fg-3">{u}</span>
        </div>
      ))}
    </>
  );
}

function LiveBoxes({ targetMs }: { targetMs: number }) {
  const left = useTimeUntil(targetMs, 1000);
  if (left === null) return <StaticBoxes values={['--', '--', '--']} />;
  const safe = Math.max(0, left);
  const h = Math.floor(safe / 3600000);
  const m = Math.floor((safe % 3600000) / 60000);
  const s = Math.floor((safe % 60000) / 1000);
  return <StaticBoxes values={[pad(h), pad(m), pad(s)]} />;
}

export function HomeHero({
  featured,
  stats,
  winners,
}: {
  featured: HeroTournament[];
  stats: HeroStats | null;
  winners: HeroWinner[];
}) {
  const hero = featured[0] ?? null;
  const liveCount = stats?.liveTournaments ?? (hero?.registrationOpen ? 1 : 0);

  // startsInMs is relative to page load. The clock is sampled by the
  // useNow() hook (rAF + interval, null until the first client sample), so
  // rendering stays pure: SSR and the first client render agree on a
  // placeholder, then the countdown starts ticking.
  const now = useNow(1000);
  const heroDeadline = hero && hero.startsInMs !== null && now !== null
    ? now + hero.startsInMs
    : null;

  const fillPct = hero ? Math.min(100, Math.round((hero.registeredSlots / hero.maxSlots) * 100)) : 0;
  const tickerItems = winners.slice(0, 6).map((w) => ({
    label: w.user?.username ?? (w.team ? `${w.team.name} [${w.team.tag}]` : '—'),
    amount: money(w.amount),
    tournament: w.tournament.title,
  }));

  return (
    <section className="relative overflow-hidden">
      {/* Aurora atmosphere */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="animate-aurora-1 absolute -left-[18vw] -top-[22vw] h-[55vw] w-[55vw] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.5),transparent_65%)] blur-[90px]" />
        <div className="animate-aurora-2 absolute -right-[16vw] top-[4vh] h-[46vw] w-[46vw] rounded-full bg-[radial-gradient(circle,rgba(124,58,237,0.4),transparent_65%)] blur-[90px]" />
        <div className="animate-aurora-3 absolute bottom-[-24vw] left-[22vw] h-[40vw] w-[40vw] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.14),transparent_65%)] blur-[90px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 lg:pb-16 lg:pt-14">
        <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.95fr]">
          {/* Copy */}
          <div>
            <span className="inline-flex items-center gap-2 rounded-pill border border-accent/30 bg-accent/10 px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.22em] text-accent">
              <span className="animate-blink h-1.5 w-1.5 rounded-full bg-success" />
              Pakistan&rsquo;s Free Fire arena
            </span>
            <h1 className="mt-5 font-display text-[2.1rem] font-bold uppercase italic leading-[1.02] tracking-tight text-fg sm:text-5xl lg:text-6xl">
              Play verified.
              <br />
              <span className="animate-gradient-shift bg-[linear-gradient(92deg,#C4B5FD_0%,#8B5CF6_45%,#F5B942_100%)] bg-[length:220%_100%] bg-clip-text text-transparent">
                Win with confidence.
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-fg-2 sm:text-base">
              Join skill-based Free Fire tournaments with verified rooms, fair results and PKR payouts —
              add money via JazzCash or EasyPaisa, lock your slot and clutch the prize.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="/tournaments"
                className="inline-flex items-center gap-2 rounded-input bg-accent px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-[0_0_28px_rgba(139,92,246,0.45)] transition duration-200 hover:bg-accent-strong hover:shadow-[0_0_34px_rgba(139,92,246,0.6)] active:scale-[0.98]"
              >
                <Play size={16} /> Find a tournament
              </Link>
              <Link
                href="/legal/how-it-works"
                className="inline-flex items-center gap-2 rounded-input border border-line bg-white/[3%] px-6 py-3 text-sm font-semibold uppercase tracking-wide text-fg-2 transition duration-200 hover:border-accent/40 hover:text-fg active:scale-[0.98]"
              >
                How It Works <ArrowRight size={15} />
              </Link>
              <InstallButton />
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-semibold text-fg-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-success">✓</span> Verified prizes
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-success">✓</span> Manual payment review
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-success">✓</span> Secure room credentials
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-success">✓</span> Fast withdrawals
              </span>
            </div>
          </div>

          {/* Live match card */}
          {hero ? (
            <div className="animate-float-y relative mx-auto w-full max-w-md lg:mx-0">
              <div
                className="relative rounded-card border border-line bg-surface/70 p-5 backdrop-blur-xl"
                style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)' }}
              >
                <div className="absolute -inset-px rounded-card bg-[linear-gradient(140deg,rgba(139,92,246,0.5),transparent_40%,transparent_60%,rgba(245,185,66,0.3))] [mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] [mask-composite:exclude] p-px" aria-hidden />
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-pill bg-danger px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-white shadow-[0_0_14px_rgba(239,68,68,0.5)]">
                    <span className="animate-blink h-1.5 w-1.5 rounded-full bg-white" />
                    {hero.registrationOpen ? 'Registration open' : 'Next match'}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                    {MODE_LABEL[hero.type as keyof typeof MODE_LABEL] ?? hero.type} · BR
                  </span>
                </div>
                <Link href={`/tournaments/${hero.slug}`} className="mt-2.5 block font-display text-xl font-bold text-fg transition hover:text-accent">
                  {hero.title}
                </Link>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-pill border border-line bg-white/5 px-2.5 py-1 text-[10px] font-bold text-fg-2">
                    Entry PKR {hero.entryFeePerPlayer}
                  </span>
                  <span className="rounded-pill border border-line bg-white/5 px-2.5 py-1 text-[10px] font-bold text-fg-2">
                    {hero.registeredSlots}/{hero.maxSlots} seats
                  </span>
                </div>
                <div className="mt-3.5 flex items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fg-3">Prize pool</span>
                  <span className="animate-gold-shimmer bg-[linear-gradient(100deg,#F5B942_20%,#FFE9A8_45%,#F5B942_70%)] bg-[length:200%_100%] bg-clip-text font-display text-[1.7rem] font-bold leading-none text-transparent">
                    {money(hero.prizePool)}
                  </span>
                </div>
                <div className="mt-3.5 flex gap-2">
                  <TimeBoxes targetMs={heroDeadline} />
                </div>
                <div className="mt-3.5">
                  <div className="mb-1.5 flex justify-between text-[11px] font-bold text-fg-2">
                    <span>Seats filled</span>
                    <span className="tabular">
                      <b className="text-accent">{hero.registeredSlots}</b> / {hero.maxSlots}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-pill bg-white/[7%]">
                    <div
                      className="h-full rounded-pill bg-gradient-to-r from-accent to-[#C4B5FD] shadow-[0_0_12px_rgba(139,92,246,0.6)] transition-[width] duration-1000 ease-out"
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                </div>
                <Link
                  href={`/tournaments/${hero.slug}`}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-input bg-accent px-5 py-3 text-sm font-bold text-white shadow-[0_4px_18px_rgba(139,92,246,0.4)] transition hover:bg-accent-strong active:scale-[0.98]"
                >
                  <ShieldCheck size={15} /> {hero.registrationOpen ? 'Enter the arena' : 'View tournament'}
                </Link>
              </div>
            </div>
          ) : (
            <div className="glass mx-auto flex max-w-md items-center justify-center rounded-card p-8 text-sm text-fg-2">
              New tournaments are being scheduled — check back soon.
            </div>
          )}
        </div>

        {/* Recent wins ticker */}
        {tickerItems.length > 0 && (
          <div className="mt-8 flex items-center overflow-hidden rounded-input border border-line bg-surface/60">
            <span className="inline-flex shrink-0 items-center gap-1.5 bg-gradient-to-r from-reward to-amber-600 px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-white">
              🏆 Recent wins
            </span>
            <div className="group relative flex-1 overflow-hidden">
              <div className="animate-ticker flex w-max gap-12 whitespace-nowrap pl-6 text-xs font-semibold text-fg-2 group-hover:[animation-play-state:paused]">
                {[...tickerItems, ...tickerItems].map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5">
                    <b className="text-reward">{t.label}</b> won <b>{t.amount}</b> — {t.tournament}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="animate-fade-up">
              <StatCard label="Total Players" value={stats.totalPlayers.toLocaleString()} />
            </div>
            <div className="animate-fade-up" style={{ animationDelay: '60ms' }}>
              <StatCard label="Tournaments" value={stats.totalTournaments.toLocaleString()} />
            </div>
            <div className="animate-fade-up" style={{ animationDelay: '120ms' }}>
              <StatCard label="Prize Distributed" value={money(stats.totalPrizeDistributed)} accent />
            </div>
            <div className="animate-fade-up" style={{ animationDelay: '180ms' }}>
              <StatCard label="Live Now" value={String(liveCount)} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
