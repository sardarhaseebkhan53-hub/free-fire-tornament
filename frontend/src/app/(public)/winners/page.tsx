// Winners wall — verified, credited prize payouts.
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import type { WinnerRow } from '@/lib/types';
import { money, dateOnly, MODE_LABEL } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import type { Metadata } from 'next';
import { SectionHeading, Badge, EmptyState } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { TournamentImage } from '@/components/tournament-image';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: 'winners',
    title: 'Free Fire Winners — Verified PKR Prize Payouts | CLUTCHNEX',
    description: 'Every CLUTCHNEX winner and verified payout. Real tournaments, real results.',
    path: '/winners',
    keywords: 'free fire winners, FF prize payouts, free fire pkr winnings',
  });
}

export default async function WinnersPage() {
  const winners = await apiServerSafe<WinnerRow[]>('/public/winners?limit=24');
  const rows = winners ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Reveal>
        <SectionHeading
          kicker="Hall of fame"
          title="Winners"
          sub="Prizes are credited only after result verification — every row below is a real, paid payout."
        />
      </Reveal>

      {rows.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((w, i) => (
            <Reveal key={i} delay={(i % 2) * 70}>
            <div key={i} className="glass relative flex items-center gap-4 overflow-hidden rounded-card p-5">
              {w.tournament.banner && (
                <TournamentImage
                  src={w.tournament.banner}
                  alt=""
                  label={w.tournament.title}
                  className="absolute inset-0 h-full w-full object-cover opacity-[12%]"
                />
              )}
              <span className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
                w.position === 1 ? 'bg-reward/20 text-reward' : 'bg-accent/15 text-accent'
              }`}>
                <Trophy size={20} />
              </span>
              <div className="relative min-w-0 flex-1">
                <p className="truncate font-display text-base font-bold text-fg">
                  {w.user?.username ?? w.team?.name ?? '—'}
                </p>
                <Link href={`/tournaments/${w.tournament.slug}`} className="block truncate text-xs text-fg-3 hover:text-accent">
                  {w.tournament.title}
                </Link>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge tone="accent">{MODE_LABEL[w.tournament.type]}</Badge>
                  <span className="text-[11px] text-fg-3">{dateOnly(w.creditedAt)}</span>
                </div>
              </div>
              <div className="relative text-right">
                <p className="gold-text tabular font-display text-lg font-bold">{money(w.amount)}</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">#{w.position} place</p>
              </div>
            </div>
            </Reveal>
          ))}
        </div>
      ) : (
        <EmptyState title="No payouts published yet" sub="Winners appear here after the first verified tournament results." />
      )}
    </div>
  );
}
