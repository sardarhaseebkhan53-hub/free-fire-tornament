// Home — spec §66: hero, live indicator, stats, featured, modes, how-it-works,
// why CLUTCHNEX, leaderboard, winners, referral, PWA install, FAQ, WhatsApp.
import Link from 'next/link';
import {
  BadgeCheck, Gamepad2, Gift, Play, Radio, ShieldCheck, Smartphone,
  Sparkles, Trophy, Users, Wallet, ArrowRight, MessageCircle,
} from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import type { Faq, HomeStats, LeaderboardEntry, TournamentSummary, WinnerRow } from '@/lib/types';
import { money, compact, MODE_LABEL } from '@/lib/format';
import { SectionHeading, StatCard, Badge, Avatar } from '@/components/ui';
import { TournamentCard } from '@/components/tournament-card';
import { FaqList } from '@/components/faq-list';

const MODES = [
  { type: 'SOLO', label: 'Solo', desc: 'One player. Pure skill — every kill counts.', icon: Gamepad2 },
  { type: 'DUO', label: 'Duo', desc: 'Two players. Coordinate, cover, clutch together.', icon: Users },
  { type: 'SQUAD', label: 'Squad', desc: 'Four players. Full-team battle royale warfare.', icon: ShieldCheck },
  { type: 'CLASH_SQUAD', label: 'Clash Squad', desc: '4v4 rounds. Fast, tactical, explosive.', icon: Sparkles },
];

const STEPS = [
  { n: '01', title: 'Register & verify', desc: 'Create your account and link your Free Fire UID.' },
  { n: '02', title: 'Add money', desc: 'Deposit via JazzCash, EasyPaisa or bank — verified by our team.' },
  { n: '03', title: 'Join a tournament', desc: 'Pick Solo, Duo, Squad or Clash Squad and lock your slot.' },
  { n: '04', title: 'Play & win', desc: 'Room details unlock before start. Verified results pay prizes fast.' },
];

const WHY = [
  { icon: BadgeCheck, title: 'Verified prize pools', desc: 'Every tournament shows the full breakdown — collection, prize pool and platform fee — before you join.' },
  { icon: Wallet, title: 'Manual payment verification', desc: 'Deposits are reviewed by real operators. Nothing is auto-credited, nothing goes missing.' },
  { icon: ShieldCheck, title: 'Fair play enforced', desc: 'Anti-cheat policy with evidence logs. Cheaters are banned and prizes protected.' },
  { icon: Smartphone, title: 'Installable (PWA)', desc: 'Add CLUTCHNEX to your home screen for an app-like experience — no store needed.' },
];

export default async function HomePage() {
  const [stats, tournaments, leaderboard, winners, faqs, settings] = await Promise.all([
    apiServerSafe<HomeStats>('/public/stats/home'),
    apiServerSafe<{ items: TournamentSummary[] }>('/public/tournaments?limit=6'),
    apiServerSafe<{ items: LeaderboardEntry[] }>('/public/leaderboard?limit=5'),
    apiServerSafe<WinnerRow[]>('/public/winners?limit=4'),
    apiServerSafe<Faq[]>('/public/faqs'),
    apiServerSafe<Record<string, unknown>>('/public/settings/public'),
  ]);

  const whatsapp = String(settings?.['platform.whatsappNumber'] ?? '');
  const featured = tournaments?.items ?? [];
  const openCount = featured.filter((t) => t.registrationOpen).length;

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.18),transparent_55%)]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <div className="mb-6 flex justify-center">
            <Badge tone="accent" live>
              {stats && stats.liveTournaments > 0 ? `${stats.liveTournaments} tournaments live now` : 'The arena is open'}
            </Badge>
          </div>
          <h1 className="mx-auto max-w-3xl font-display text-4xl font-bold leading-[1.08] tracking-tight text-fg sm:text-6xl">
            THE ARENA IS <span className="text-accent drop-shadow-[0_0_24px_rgba(139,92,246,0.5)]">CALLING</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-fg-2 sm:text-lg">
            Join competitive Free Fire tournaments, compete with skilled players, and win rewards.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-input bg-accent px-7 py-3.5 text-sm font-bold text-white shadow-[0_0_28px_rgba(139,92,246,0.45)] transition hover:bg-accent-strong"
            >
              <Play size={16} /> Play Now
            </Link>
            <Link
              href="/tournaments"
              className="inline-flex items-center gap-2 rounded-input border border-line bg-white/[3%] px-7 py-3.5 text-sm font-semibold text-fg transition hover:border-accent/40"
            >
              Explore Tournaments
            </Link>
            <Link
              href="/legal/how-it-works"
              className="inline-flex items-center gap-2 rounded-input px-5 py-3.5 text-sm font-semibold text-fg-2 transition hover:text-fg"
            >
              How It Works <ArrowRight size={15} />
            </Link>
          </div>

          {/* STATS */}
          {stats && (
            <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total Players" value={compact(stats.totalPlayers)} />
              <StatCard label="Tournaments" value={compact(stats.totalTournaments)} />
              <StatCard label="Prize Distributed" value={money(stats.totalPrizeDistributed)} accent />
              <StatCard label="Live Now" value={String(stats.liveTournaments)} />
            </div>
          )}
        </div>
      </section>

      {/* FEATURED TOURNAMENTS */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <SectionHeading
          kicker="Compete"
          title="Featured Tournaments"
          sub={`${openCount} arena${openCount === 1 ? '' : 's'} open for registration right now.`}
          action={
            <Link href="/tournaments" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong">
              View all <ArrowRight size={15} />
            </Link>
          }
        />
        {featured.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((t) => (
              <TournamentCard key={t.id} t={t} />
            ))}
          </div>
        ) : (
          <p className="glass rounded-card px-6 py-10 text-center text-sm text-fg-2">
            New tournaments are being scheduled — check back soon.
          </p>
        )}
      </section>

      {/* MODES */}
      <section className="border-y border-line bg-surface/60">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <SectionHeading kicker="Modes" title="Choose Your Battle" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <Link
                  key={m.type}
                  href={`/tournaments?type=${m.type}`}
                  className="glass group rounded-card p-6 transition hover:-translate-y-1 hover:border-accent/40"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-input bg-accent/15 text-accent">
                    <Icon size={20} />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-bold text-fg group-hover:text-accent">
                    {m.label}
                  </h3>
                  <p className="mt-1.5 text-sm text-fg-2">{m.desc}</p>
                  <p className="mt-3 text-xs font-semibold text-fg-3">
                    Entry {MODE_LABEL[m.type] === 'Solo' ? 'per player' : 'per team'} · transparent prize split
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <SectionHeading kicker="Simple by design" title="How It Works" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="glass rounded-card p-6">
              <p className="font-display text-3xl font-bold text-accent/70">{s.n}</p>
              <h3 className="mt-3 font-display text-base font-bold text-fg">{s.title}</h3>
              <p className="mt-1.5 text-sm text-fg-2">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* WHY CLUTCHNEX */}
      <section className="border-y border-line bg-surface/60">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <SectionHeading kicker="Trust" title="Why CLUTCHNEX" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WHY.map((w) => {
              const Icon = w.icon;
              return (
                <div key={w.title} className="glass rounded-card p-6">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-input bg-success/15 text-success">
                    <Icon size={20} />
                  </span>
                  <h3 className="mt-4 font-display text-base font-bold text-fg">{w.title}</h3>
                  <p className="mt-1.5 text-sm text-fg-2">{w.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* LEADERBOARD + WINNERS */}
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2">
        <div>
          <SectionHeading
            kicker="Rankings"
            title="Top Players"
            action={<Link href="/leaderboard" className="text-sm font-semibold text-accent hover:text-accent-strong">Full leaderboard</Link>}
          />
          <div className="glass divide-y divide-line rounded-card">
            {(leaderboard?.items ?? []).map((e) => (
              <div key={e.user.username} className="flex items-center gap-4 px-5 py-3.5">
                <span className={`tabular w-7 text-center font-display text-sm font-bold ${e.rank === 1 ? 'text-reward' : e.rank <= 3 ? 'text-fg-2' : 'text-fg-3'}`}>
                  {e.rank}
                </span>
                <Avatar name={e.user.username} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{e.user.username}</p>
                  <p className="text-xs text-fg-3">{e.wins} wins · {e.kills} kills</p>
                </div>
                <div className="text-right">
                  <p className="tabular text-sm font-bold text-accent">{e.totalPoints} pts</p>
                  <p className="tabular text-xs text-fg-3">{money(e.earnings)}</p>
                </div>
              </div>
            ))}
            {(leaderboard?.items ?? []).length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-fg-2">Rankings appear after the first verified results.</p>
            )}
          </div>
        </div>

        <div>
          <SectionHeading
            kicker="Proof"
            title="Recent Winners"
            action={<Link href="/winners" className="text-sm font-semibold text-accent hover:text-accent-strong">All winners</Link>}
          />
          <div className="space-y-3">
            {(winners ?? []).map((w, i) => (
              <div key={i} className="glass flex items-center gap-4 rounded-card px-5 py-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-reward/15 text-reward">
                  <Trophy size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">
                    {w.user?.username ?? w.team?.name ?? '—'}
                    <span className="ml-2 text-xs font-medium text-fg-3">#{w.position}</span>
                  </p>
                  <Link href={`/tournaments/${w.tournament.slug}`} className="block truncate text-xs text-fg-3 hover:text-accent">
                    {w.tournament.title}
                  </Link>
                </div>
                <p className="tabular font-display text-base font-bold text-reward">{money(w.amount)}</p>
              </div>
            ))}
            {(winners ?? []).length === 0 && (
              <p className="glass rounded-card px-5 py-8 text-center text-sm text-fg-2">Winners are published here after result verification.</p>
            )}
          </div>
        </div>
      </section>

      {/* REFERRAL */}
      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <div className="glass relative overflow-hidden rounded-card px-6 py-10 text-center sm:px-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(245,185,66,0.12),transparent_60%)]" />
          <Gift size={28} className="mx-auto text-reward" />
          <h2 className="mt-3 font-display text-2xl font-bold text-fg">Invite your squad. Earn together.</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-fg-2">
            Share your referral code. When your friend&apos;s first deposit is approved, the referral reward
            lands in your bonus balance — automatically.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-flex items-center gap-2 rounded-input bg-reward px-6 py-3 text-sm font-bold text-base transition hover:brightness-110"
          >
            Get your code <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* PWA INSTALL */}
      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <div className="glass flex flex-col items-center gap-6 rounded-card px-6 py-8 sm:flex-row sm:px-10">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-card bg-accent/15 text-accent">
            <Smartphone size={26} />
          </span>
          <div className="flex-1 text-center sm:text-left">
            <h2 className="font-display text-xl font-bold text-fg">Install CLUTCHNEX</h2>
            <p className="mt-1 text-sm text-fg-2">
              Faster access, notifications and an app-like experience — straight from your browser.
            </p>
          </div>
          <span className="rounded-input border border-line px-5 py-2.5 text-xs font-semibold text-fg-3">
            Use your browser menu → “Add to Home Screen”
          </span>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pb-14 sm:px-6">
        <SectionHeading kicker="Answers" title="Frequently Asked Questions" />
        {(faqs ?? []).length > 0 ? (
          <FaqList faqs={(faqs ?? []).slice(0, 6)} />
        ) : (
          <p className="text-sm text-fg-2">Visit the support center for help.</p>
        )}
      </section>

      {/* WHATSAPP STRIP */}
      {whatsapp && (
        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 rounded-card border border-success/25 bg-success/10 px-6 py-7 sm:flex-row sm:px-10">
            <div className="flex items-center gap-4">
              <Radio size={22} className="text-success" />
              <div>
                <p className="font-display text-lg font-bold text-fg">Need help? Talk to a human.</p>
                <p className="text-sm text-fg-2">WhatsApp support — average first response under 6 hours.</p>
              </div>
            </div>
            <a
              href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-input bg-success px-6 py-3 text-sm font-bold text-white transition hover:brightness-110"
            >
              <MessageCircle size={16} /> Chat on WhatsApp
            </a>
          </div>
        </section>
      )}
    </>
  );
}
