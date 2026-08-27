// Home — spec §66: hero, live indicator, stats, featured, modes, how-it-works,
// why CLUTCHNEX, leaderboard, winners, referral, PWA install, FAQ, WhatsApp.
import Link from 'next/link';
import {
  BadgeCheck, Gamepad2, Gift, Play, Radio, ShieldCheck, Smartphone,
  Sparkles, Trophy, Users, Wallet, ArrowRight, MessageCircle, Download,
} from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import type { Faq, HomeStats, LeaderboardEntry, TournamentSummary, WinnerRow } from '@/lib/types';
import { money, compact, MODE_LABEL } from '@/lib/format';
import { SectionHeading, StatCard, Badge, Avatar } from '@/components/ui';
import { TournamentCard } from '@/components/tournament-card';
import { FaqList } from '@/components/faq-list';
import { FeaturedMobile } from '@/components/featured-mobile';
import { InstallButton } from '@/components/pwa';
import { JsonLd, faqJsonLd, organizationJsonLd, pageMetadata, websiteJsonLd } from '@/lib/seo';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: 'home',
    title: 'CLUTCHNEX — Free Fire Tournaments in Pakistan',
    description:
      'Join competitive Free Fire tournaments — Solo, Duo, Squad and Clash Squad. Verified prize pools, manual payment verification, fast withdrawals. Compete. Clutch. Conquer.',
    path: '/',
    keywords: 'free fire tournament pakistan, FF tournament, free fire pkr prizes, esports pakistan',
  });
}

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
  // Mobile featured card (design 41): first open tournament, else the first listed.
  const heroCard = featured.find((t) => t.registrationOpen) ?? featured[0] ?? null;

  return (
    <>
      {/* Structured data — Organization, WebSite, FAQ (Phase 12) */}
      <JsonLd data={[organizationJsonLd(String(settings?.['platform.whatsappNumber'] ?? '')), websiteJsonLd()]} />
      {(faqs ?? []).length > 0 && <JsonLd data={faqJsonLd((faqs ?? []).slice(0, 8))} />}
      {/* MOBILE HERO — design 41: compact banner card with art */}
      <section className="px-4 pt-4 lg:hidden">
        <div className="animate-fade-up relative overflow-hidden rounded-card border border-line shadow-[0_18px_44px_-18px_rgba(0,0,0,0.7)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/art/hero-mobile.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-[70%_30%]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-base via-base/85 to-base/10" />
          <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-pill bg-danger/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse-dot" /> Live
          </span>
          <div className="relative p-5">
            <h1 className="font-display text-[2rem] font-bold uppercase italic leading-[1.02] text-fg drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
              The Arena<br />
              <span className="text-accent drop-shadow-[0_0_18px_rgba(139,92,246,0.6)]">Is Calling</span>
            </h1>
            <p className="mt-2.5 max-w-52 text-xs leading-relaxed text-fg-2 drop-shadow">
              Are you ready to clutch?
              <br />
              Compete, build your squad, climb the leaderboard.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href="/tournaments"
                className="inline-flex items-center gap-1.5 rounded-input bg-accent px-5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-[0_0_22px_rgba(139,92,246,0.5)] transition duration-200 hover:bg-accent-strong hover:shadow-[0_0_26px_rgba(139,92,246,0.65)] active:scale-95"
              >
                Explore Tournaments <span aria-hidden>›</span>
              </Link>
              <Link
                href="/legal/how-it-works"
                className="inline-flex items-center gap-1.5 rounded-input border border-line bg-base/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-fg-2 transition duration-200 hover:text-fg hover:border-accent/40 active:scale-95"
              >
                How It Works
              </Link>
            </div>
          </div>
        </div>
        {/* carousel dots — design 41 */}
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          <span className="h-1.5 w-4 rounded-pill bg-accent" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
        </div>
      </section>

      {/* DESKTOP HERO — design 01 */}
      <section className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.18),transparent_55%)]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <div className="mb-6 flex justify-center animate-fade-up">
            <Badge tone="accent" live>
              {stats && stats.liveTournaments > 0 ? `${stats.liveTournaments} tournaments live now` : 'The arena is open'}
            </Badge>
          </div>
          <h1 className="animate-fade-up mx-auto max-w-3xl font-display text-4xl font-bold leading-[1.08] tracking-tight text-fg sm:text-6xl" style={{ animationDelay: '60ms' }}>
            THE ARENA IS <span className="text-accent drop-shadow-[0_0_24px_rgba(139,92,246,0.5)]">CALLING</span>
          </h1>
          <p className="animate-fade-up mt-3 font-display text-lg font-bold uppercase tracking-[0.18em] text-accent/90 sm:text-xl" style={{ animationDelay: '120ms' }}>
            Are you ready to clutch?
          </p>
          <p className="animate-fade-up mx-auto mt-5 max-w-2xl text-base text-fg-2 sm:text-lg" style={{ animationDelay: '180ms' }}>
            Compete in competitive Free Fire tournaments, build your squad, climb the leaderboard and
            prove your skills.
          </p>
          <div className="animate-fade-up mt-8 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: '240ms' }}>
            <Link
              href="/tournaments"
              className="inline-flex items-center gap-2 rounded-input bg-accent px-7 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[0_0_28px_rgba(139,92,246,0.45)] transition duration-200 hover:bg-accent-strong hover:shadow-[0_0_34px_rgba(139,92,246,0.6)] active:scale-[0.98]"
            >
              <Play size={16} /> Explore Tournaments
            </Link>
            <Link
              href="/legal/how-it-works"
              className="inline-flex items-center gap-2 rounded-input border border-line bg-white/[3%] px-7 py-3.5 text-sm font-semibold uppercase tracking-wide text-fg transition duration-200 hover:border-accent/40 hover:bg-white/[5%] active:scale-[0.98]"
            >
              How It Works <ArrowRight size={15} />
            </Link>
            <InstallButton />
          </div>

          {/* STATS */}
          {stats && (
            <div className="animate-fade-up mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4" style={{ animationDelay: '300ms' }}>
              <StatCard label="Total Players" value={compact(stats.totalPlayers)} />
              <StatCard label="Tournaments" value={compact(stats.totalTournaments)} />
              <StatCard label="Prize Distributed" value={money(stats.totalPrizeDistributed)} accent />
              <StatCard label="Live Now" value={String(stats.liveTournaments)} />
            </div>
          )}
        </div>
      </section>

      {/* MOBILE FEATURED TOURNAMENT — design 41 */}
      {heroCard && (
        <FeaturedMobile
          t={{
            slug: heroCard.slug,
            title: heroCard.title,
            type: heroCard.type,
            entryFeePerPlayer: Number(heroCard.entryFeePerPlayer),
            prizePool: Number(heroCard.prizePool),
            registeredSlots: heroCard.registeredSlots,
            maxSlots: heroCard.maxSlots,
            startsInMs: heroCard.startsInMs,
            banner: heroCard.banner,
          }}
        />
      )}

      {/* MOBILE STATS */}
      {stats && (
        <section className="mx-auto max-w-7xl px-4 pt-6 lg:hidden">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Total Players" value={compact(stats.totalPlayers)} />
            <StatCard label="Tournaments" value={compact(stats.totalTournaments)} />
            <StatCard label="Prize Distributed" value={money(stats.totalPrizeDistributed)} accent />
            <StatCard label="Live Now" value={String(stats.liveTournaments)} />
          </div>
        </section>
      )}

      {/* FEATURED TOURNAMENTS (desktop — design 01; mobile uses the design-41 card) */}
      <section className="mx-auto hidden max-w-7xl px-4 py-14 sm:px-6 lg:block">
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

      {/* PWA INSTALL — design v2 §PWA install. Web app / PWA only: no store badges. */}
      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <div className="glass relative overflow-hidden rounded-card px-6 py-10 sm:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_-20%,rgba(139,92,246,0.18),transparent_60%)]" />
          <div className="relative grid gap-8 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-pill border border-line bg-white/[4%] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-fg-3">
                <Smartphone size={12} className="text-accent" /> Install Web App
              </span>
              <h2 className="mt-4 font-display text-2xl font-bold uppercase tracking-tight text-fg sm:text-3xl">
                Your tournament hub. <span className="text-accent">Anywhere.</span>
              </h2>
              <p className="mt-3 max-w-xl text-sm text-fg-2">
                Install CLUTCHNEX on your device for a fast, app-like experience.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <InstallButton variant="primary" />
                <Link
                  href="/tournaments"
                  className="inline-flex items-center gap-2 rounded-input px-5 py-3.5 text-sm font-semibold text-fg-2 transition hover:text-fg"
                >
                  Continue in Browser <ArrowRight size={15} />
                </Link>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {['Add to Home Screen', 'Works offline', 'Instant launch', 'Match notifications'].map((f) => (
                  <span
                    key={f}
                    className="rounded-pill border border-line bg-white/[3%] px-3 py-1.5 text-[11px] font-semibold text-fg-3"
                  >
                    {f}
                  </span>
                ))}
              </div>
              <p className="mt-5 text-[11px] leading-relaxed text-fg-3">
                CLUTCHNEX is currently available as a web application / PWA — install it directly from
                your browser. It is not distributed on Google Play or the Apple App Store.
              </p>
            </div>

            {/* Browser → home-screen illustration (pure CSS, no store artwork) */}
            <div className="relative mx-auto flex w-full max-w-sm items-end justify-center gap-4">
              <div className="w-full rounded-card border border-line bg-base/70 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
                <div className="flex items-center gap-1.5 rounded-input bg-white/[4%] px-2 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-danger/70" />
                  <span className="h-2 w-2 rounded-full bg-warning/70" />
                  <span className="h-2 w-2 rounded-full bg-success/70" />
                  <span className="ml-2 flex-1 truncate rounded-pill bg-base/80 px-2 py-1 text-[9px] text-fg-3">
                    clutchnex.com
                  </span>
                  <span className="rounded bg-accent/20 px-1.5 py-1 text-accent">
                    <Download size={10} />
                  </span>
                </div>
                <div className="mt-2 space-y-2 rounded-input bg-white/[3%] p-3">
                  <div className="h-2 w-24 rounded-pill bg-accent/50" />
                  <div className="h-2 w-full rounded-pill bg-white/10" />
                  <div className="h-2 w-4/5 rounded-pill bg-white/10" />
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div className="h-9 rounded bg-white/[6%]" />
                    <div className="h-9 rounded bg-white/[6%]" />
                    <div className="h-9 rounded bg-white/[6%]" />
                  </div>
                </div>
              </div>
              <div className="-ml-14 w-24 shrink-0 rounded-[1.25rem] border border-line bg-base p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
                <div className="rounded-[0.9rem] bg-surface p-2">
                  <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-[0.6rem] bg-gradient-to-br from-accent to-accent-strong font-display text-sm font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.6)]">
                    C
                  </span>
                  <p className="mt-1 text-center text-[7px] font-bold text-fg-2">CLUTCHNEX</p>
                  <div className="mt-2 grid grid-cols-3 gap-1" aria-hidden>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <span key={i} className="h-4 rounded bg-white/[6%]" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
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
