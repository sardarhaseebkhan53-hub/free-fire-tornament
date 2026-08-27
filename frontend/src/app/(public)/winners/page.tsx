// Winners wall — verified, credited prize payouts.
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import type { WinnerRow } from '@/lib/types';
import { money, dateOnly, MODE_LABEL } from '@/lib/format';
import { SectionHeading, Badge, EmptyState } from '@/components/ui';

export const metadata = {
  title: 'Winners — Verified Prize Payouts',
  description: 'Every CLUTCHNEX winner and verified payout. Real tournaments, real results.',
};

export default async function WinnersPage() {
  const winners = await apiServerSafe<WinnerRow[]>('/public/winners?limit=24');
  const rows = winners ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <SectionHeading
        kicker="Hall of fame"
        title="Winners"
        sub="Prizes are credited only after result verification — every row below is a real, paid payout."
      />

      {rows.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((w, i) => (
            <div key={i} className="glass flex items-center gap-4 rounded-card p-5">
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
                w.position === 1 ? 'bg-reward/20 text-reward' : 'bg-accent/15 text-accent'
              }`}>
                <Trophy size={20} />
              </span>
              <div className="min-w-0 flex-1">
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
              <div className="text-right">
                <p className="tabular font-display text-lg font-bold text-reward">{money(w.amount)}</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">#{w.position} place</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No payouts published yet" sub="Winners appear here after the first verified tournament results." />
      )}
    </div>
  );
}
