// /free-fire-tournaments — the SEO hub (design 45): keyword-rich hero, mode
// cards linking to the mode landings, featured tournaments, FAQ. Structured
// data: FAQPage + BreadcrumbList; Organization/WebSite live on the home page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Gamepad2, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import type { TournamentSummary, Faq } from '@/lib/types';
import { TournamentCard } from '@/components/tournament-card';
import { SectionHeading } from '@/components/ui';
import { FaqList } from '@/components/faq-list';
import { JsonLd, breadcrumbJsonLd, faqJsonLd, pageMetadata } from '@/lib/seo';

const MODE_CARDS = [
  { href: '/tournaments/solo', label: 'Solo', icon: Gamepad2, desc: 'One player, one legend — every kill counts toward PKR prizes.' },
  { href: '/tournaments/duo', label: 'Duo', icon: Users, desc: 'Bring a partner — captain registers, both pay their share.' },
  { href: '/tournaments/squad', label: 'Squad', icon: ShieldCheck, desc: 'Full 4v4 battle royale warfare with your best three.' },
  { href: '/tournaments/clash-squad', label: 'Clash Squad', icon: Sparkles, desc: 'Round-based 4v4 fights — short matches, fast payouts.' },
];

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: 'free-fire-tournaments',
    title: 'Free Fire Tournaments in Pakistan — Solo, Duo, Squad & Clash Squad | CLUTCHNEX',
    description:
      'Play Free Fire tournaments in Pakistan with verified PKR prize pools: Solo, Duo, Squad and Clash Squad. Transparent entry fees, manual payment verification (JazzCash/EasyPaisa), secure room credentials and fast withdrawals.',
    path: '/free-fire-tournaments',
    keywords: 'free fire tournament pakistan, FF tournament PKR, free fire tournament join, free fire esports pakistan, win money free fire',
  });
}

export default async function FreeFireTournamentsHub() {
  const [featured, faqs] = await Promise.all([
    apiServerSafe<{ items: TournamentSummary[] }>('/public/tournaments?limit=3&sort=startTime'),
    apiServerSafe<Faq[]>('/public/faqs'),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Free Fire Tournaments', path: '/free-fire-tournaments' },
      ])} />
      {faqs && faqs.length > 0 && <JsonLd data={faqJsonLd(faqs.slice(0, 8))} />}

      {/* Hero */}
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-accent">Pakistan&apos;s Free Fire arena</p>
      <h1 className="mt-2 max-w-3xl font-display text-3xl font-bold leading-tight tracking-tight text-fg sm:text-4xl">
        Free Fire Tournaments in Pakistan
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fg-2 sm:text-base">
        Solo, Duo, Squad and Clash Squad tournaments with verified PKR prize pools. Add money through
        JazzCash, EasyPaisa or bank transfer, lock your slot, and play — room IDs unlock securely before
        every match and prizes hit your wallet after results are verified.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/tournaments" className="rounded-input bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_18px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong">
          Join a Tournament
        </Link>
        <Link href="/support" className="rounded-input border border-line px-5 py-2.5 text-sm font-semibold text-fg-2 transition hover:text-fg">
          How It Works
        </Link>
      </div>
      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-fg-3">
        <span>✓ Verified prizes</span> <span>✓ Manual payment verification</span> <span>✓ Secure room credentials</span> <span>✓ Fast withdrawals</span>
      </p>

      {/* Mode cards */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {MODE_CARDS.map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.href} href={m.href} className="glass group rounded-card p-5 transition hover:-translate-y-1 hover:border-accent/40">
              <span className="flex h-10 w-10 items-center justify-center rounded-input bg-accent/15 text-accent">
                <Icon size={20} />
              </span>
              <h2 className="mt-3 font-display text-lg font-bold text-fg">{m.label}</h2>
              <p className="mt-1 text-xs leading-relaxed text-fg-3">{m.desc}</p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-accent">
                Browse {m.label} <ArrowRight size={13} className="transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          );
        })}
      </div>

      {/* Featured tournaments */}
      <div className="mt-12">
        <SectionHeading
          kicker="Live arena"
          title="Featured Free Fire tournaments"
          action={<Link href="/tournaments" className="rounded-input border border-line px-4 py-2 text-xs font-bold text-fg-2 transition hover:text-fg">View all</Link>}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(featured?.items ?? []).map((t) => <TournamentCard key={t.id} t={t} />)}
        </div>
      </div>

      {/* FAQ */}
      {faqs && faqs.length > 0 && (
        <div className="mt-12">
          <SectionHeading kicker="Questions" title="Free Fire tournament FAQs" />
          <FaqList faqs={faqs.slice(0, 6)} />
        </div>
      )}
    </div>
  );
}
