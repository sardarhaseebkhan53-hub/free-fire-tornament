// Mode landing page (Phase 12 SEO routes) — shared renderer for
// /tournaments/solo | duo | squad | clash-squad. Server-rendered, keyword-rich
// but honest copy, live tournament cards, mode-specific prize table and FAQ
// (FAQPage + BreadcrumbList structured data).
import Link from 'next/link';
import { apiServerSafe } from '@/lib/api';
import type { TournamentSummary } from '@/lib/types';
import { TournamentCard } from '@/components/tournament-card';
import { EmptyState, SectionHeading } from '@/components/ui';
import { FaqList } from '@/components/faq-list';
import { JsonLd, breadcrumbJsonLd, faqJsonLd } from '@/lib/seo';

export interface ModeConfig {
  slug: 'solo' | 'duo' | 'squad' | 'clash-squad' | 'lone-wolf' | 'clash-squad-1v1';
  apiType: 'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD' | 'LONE_WOLF' | 'CLASH_SQUAD_1V1';
  label: string;
  kicker: string;
  headline: string;
  intro: string;
  bullets: string[];
  prizeNote: string;
  faqs: Array<{ question: string; answer: string }>;
}

export const MODES: ModeConfig[] = [
  {
    slug: 'solo',
    apiType: 'SOLO',
    label: 'Solo',
    kicker: 'Mode · Solo',
    headline: 'Solo Free Fire Tournaments',
    intro:
      'One player, one legend. Every kill counts and placements pay — join solo Free Fire tournaments in Pakistan with PKR prize pools, transparent entry fees and instant wallet credit after verified results.',
    bullets: ['1 player per entry', 'Placement prizes + per-kill points', 'Entry from your cash balance in one tap'],
    prizeNote: 'Typical solo prize split: 1st ₨10,000 · 2nd ₨6,000 · 3rd ₨4,000 · per kill ₨30 (varies per tournament — always shown before you join).',
    faqs: [
      { question: 'How do I join a solo Free Fire tournament?', answer: 'Pick an open solo tournament, check the entry fee and prize split, then tap Join — the entry fee is debited from your wallet instantly and your slot is locked.' },
      { question: 'When do I get the room ID and password?', answer: 'Room credentials unlock automatically inside My Matches at the release time shown on your match card — usually 30 minutes before start, and only for registered players.' },
      { question: 'How are solo prizes paid?', answer: 'After admins verify results, placement prizes and per-kill points are credited straight to your winning balance — one-time-guarded so nothing is ever paid twice.' },
    ],
  },
  {
    slug: 'duo',
    apiType: 'DUO',
    label: 'Duo',
    kicker: 'Mode · Duo',
    headline: 'Duo Free Fire Tournaments',
    intro:
      'Bring a partner. Duo tournaments on CLUTCHNEX pair you and a teammate against the field — the captain registers the duo and each player pays their own share from their own wallet.',
    bullets: ['2 players per team', 'Captain registers, both pay their share', 'Team prizes split equally across members'],
    prizeNote: 'Duo prizes are awarded per team and split equally between both members after verified results — the full split is published on every tournament page before you join.',
    faqs: [
      { question: 'How do duo entries work?', answer: 'The captain registers the duo for the entry fee per team; every member pays their own share from their wallet — if anyone lacks balance the whole join rolls back.' },
      { question: 'Can I play with any teammate?', answer: 'Yes — invite any player to your duo team from the Teams page. One duo team per player is allowed at a time.' },
      { question: 'How are duo prizes split?', answer: 'Team awards are divided equally across current team members and credited to each winner\u2019s winning balance automatically.' },
    ],
  },
  {
    slug: 'squad',
    apiType: 'SQUAD',
    label: 'Squad',
    kicker: 'Mode · Squad',
    headline: 'Squad Free Fire Tournaments',
    intro:
      'Full 4v4 warfare. Register your squad, sync your Free Fire UIDs, and fight for PKR prize pools — with placement tables, per-kill points and MVP awards published up front.',
    bullets: ['4 players per team', 'Unique team tags, verified FF UIDs', 'Placement + kill pool + MVP awards'],
    prizeNote: 'Squad tournaments pay placement prizes, a capped per-kill pool and an MVP award — every number is visible on the tournament page before entry.',
    faqs: [
      { question: 'How many players are in a squad?', answer: 'Four. The captain registers the full squad and each of the four members pays their own share — slots are counted per team.' },
      { question: 'What if a teammate has no balance?', answer: 'The join is all-or-nothing: if any member cannot pay their share, the entire registration rolls back and no one is charged.' },
      { question: 'Do squads need matching in-game names?', answer: 'No — but every member\u2019s Free Fire UID is stored on the team profile so staff can verify results fairly.' },
    ],
  },
  {
    slug: 'clash-squad',
    apiType: 'CLASH_SQUAD',
    label: 'Clash Squad',
    kicker: 'Mode · Clash Squad',
    headline: 'Clash Squad Free Fire Tournaments',
    intro:
      'Fast 4v4 rounds, weapon buys, no second chances. Clash Squad tournaments are short, brutal and perfect for duos of reflex — quick matches, quick PKR payouts.',
    bullets: ['4v4 round-based combat', 'Short matches — more games per night', 'Same verified prize pipeline as battle royale'],
    prizeNote: 'Clash Squad prizes follow the same verified pipeline: placement table, per-kill points and MVP, all published before entry.',
    faqs: [
      { question: 'What is Clash Squad mode?', answer: 'A round-based 4v4 mode with economy rounds and weapon purchases — matches are much shorter than battle royale, so tournaments resolve quickly.' },
      { question: 'Are Clash Squad prizes different?', answer: 'The payout rules are identical to other modes — placement prizes, per-kill points and MVP awards credited after verified results.' },
      { question: 'How long is a Clash Squad tournament?', answer: 'Most finish the same evening; room credentials unlock before each round exactly like every CLUTCHNEX match.' },
    ],
  },
  {
    slug: 'lone-wolf',
    apiType: 'LONE_WOLF',
    label: 'Lone Wolf',
    kicker: 'Mode · Lone Wolf',
    headline: 'Lone Wolf Free Fire Tournaments',
    intro:
      'Solo survival in fast, small-arena rounds. Lone Wolf is a one-player-per-seat mode — no team, no captain, no waiting. Register alone, lock your slot, and win PKR prizes one clutch at a time.',
    bullets: ['1 player per seat', 'No team needed — direct solo entry', 'Fast rounds with placement + per-kill points'],
    prizeNote: 'Lone Wolf uses the same verified prize pipeline: placement prizes, per-kill points and MVP awards, all shown on the tournament page before you join.',
    faqs: [
      { question: 'How do I join a Lone Wolf tournament?', answer: 'Pick an open Lone Wolf tournament, confirm your Free Fire UID and in-game name, and pay the entry fee from your wallet — a seat is locked instantly.' },
      { question: 'Do I need a team for Lone Wolf?', answer: 'No. Lone Wolf is a solo-entry mode: every seat is one player, so there is no captain and no invite required.' },
      { question: 'How are Lone Wolf prizes paid?', answer: 'After results are verified, placement prizes and per-kill points are credited to your winning balance automatically.' },
    ],
  },
  {
    slug: 'clash-squad-1v1',
    apiType: 'CLASH_SQUAD_1V1',
    label: 'Clash Squad 1v1',
    kicker: 'Mode · Clash Squad 1v1',
    headline: 'Clash Squad 1v1 Free Fire Tournaments',
    intro:
      'One vs one, first to the finish. Clash Squad 1v1 tournaments put a single player in every seat with head-to-head brackets — no team needed, direct entry, fast payouts.',
    bullets: ['1 player per seat — direct solo entry', 'Head-to-head Clash Squad brackets', 'Placement prizes + per-kill points'],
    prizeNote: 'Clash Squad 1v1 uses the same verified prize pipeline as every other mode — placement, per-kill points and MVP are published before you enter.',
    faqs: [
      { question: 'What is Clash Squad 1v1?', answer: 'A single-player Clash Squad format: you and one opponent face off in rounds, with one player per tournament seat.' },
      { question: 'Do I need a team for 1v1?', answer: 'No. Clash Squad 1v1 is direct solo entry — confirm your UID and in-game name, pay, and you are seated.' },
      { question: 'How fast are 1v1 payouts?', answer: 'Prizes are credited after staff verify results, exactly like the other modes — placement and per-kill points go to your winning balance automatically.' },
    ],
  },
];

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'REGISTRATION_OPEN', label: 'Open' },
  { value: 'LIVE', label: 'Live' },
  { value: 'COMPLETED', label: 'Completed' },
];

export async function ModeLanding({ mode, status = '' }: { mode: ModeConfig; status?: string }) {
  const data = await apiServerSafe<{ items: TournamentSummary[]; total: number }>(
    `/public/tournaments?type=${mode.apiType}&status=${status}&limit=24`,
  );
  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Free Fire Tournaments', path: '/free-fire-tournaments' },
        { name: `${mode.label} Tournaments`, path: `/tournaments/${mode.slug}` },
      ])} />
      <JsonLd data={faqJsonLd(mode.faqs)} />

      {/* Hero */}
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-accent">{mode.kicker}</p>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">{mode.headline}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fg-2 sm:text-base">{mode.intro}</p>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-3">
        {mode.bullets.map((b) => (
          <li key={b} className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {b}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-3">
        {items.length > 0 ? (
          <Link href={`/tournaments/${items[0].slug}`} className="rounded-input bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_18px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong">
            Join a {mode.label} Tournament
          </Link>
        ) : (
          <Link href="/tournaments" className="rounded-input bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_18px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong">
            Browse all tournaments
          </Link>
        )}
        <Link href="/support" className="rounded-input border border-line px-5 py-2.5 text-sm font-semibold text-fg-2 transition hover:text-fg">
          How it works
        </Link>
      </div>

      {/* Status filter pills (server-driven links) */}
      <div className="mt-8 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/tournaments/${mode.slug}${tab.value ? `?status=${tab.value}` : ''}`}
            className={`shrink-0 rounded-pill border px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
              status === tab.value ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line bg-white/[3%] text-fg-3 hover:text-fg-2'
            }`}
          >
            {tab.label}
          </Link>
        ))}
        <span className="ml-auto shrink-0 self-center text-[11px] text-fg-3">{data?.total ?? 0} tournaments</span>
      </div>

      {/* Tournament cards */}
      <div className="mt-4">
        {items.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t) => <TournamentCard key={t.id} t={t} />)}
          </div>
        ) : (
          <EmptyState
            title={`No ${mode.label.toLowerCase()} tournaments right now`}
            sub="New tournaments drop every week — browse all modes or check back soon."
          />
        )}
      </div>

      {/* Prize note */}
      <div className="glass mt-8 rounded-card p-5">
        <h2 className="font-display text-base font-bold text-fg">How {mode.label.toLowerCase()} prizes work</h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-2">{mode.prizeNote}</p>
      </div>

      {/* FAQ */}
      <div className="mt-12">
        <SectionHeading kicker="Questions" title={`${mode.label} tournament FAQs`} />
        <FaqList faqs={mode.faqs.map((f) => ({ ...f, category: null }))} />
      </div>
    </div>
  );
}
