// Leaderboard — spec §18: global + weekly + monthly boards.
import Link from 'next/link';
import { apiServerSafe } from '@/lib/api';
import type { LeaderboardEntry } from '@/lib/types';
import { money } from '@/lib/format';
import { SectionHeading, Avatar, EmptyState } from '@/components/ui';

export const metadata = {
  title: 'Leaderboard — Top Free Fire Players',
  description: 'CLUTCHNEX rankings by points, wins, kills and earnings — global, weekly and monthly.',
};

const PERIODS = [
  { value: 'all', label: 'All Time' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const sp = await searchParams;
  const period = ['all', 'weekly', 'monthly'].includes(sp.period ?? '') ? (sp.period as string) : 'all';
  const data = await apiServerSafe<{ items: LeaderboardEntry[]; total: number }>(
    `/public/leaderboard?period=${period}&limit=20`,
  );
  const rows = data?.items ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <SectionHeading
        kicker="Rankings"
        title="Leaderboard"
        sub="Points = placement points + kills. Boards update after every verified result."
      />

      <div className="mb-6 flex gap-2">
        {PERIODS.map((p) => {
          const active = p.value === period;
          return (
            <Link
              key={p.value}
              href={`/leaderboard?period=${p.value}`}
              className={`rounded-pill border px-4 py-1.5 text-xs font-semibold transition ${
                active ? 'border-accent bg-accent/15 text-accent' : 'border-line text-fg-2 hover:text-fg'
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      {rows.length > 0 ? (
        <div className="glass overflow-hidden rounded-card">
          <div className="hidden grid-cols-[3rem_1fr_5rem_5rem_5rem_6rem_6rem] gap-2 border-b border-line px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-fg-3 sm:grid">
            <span>#</span><span>Player</span>
            <span className="text-right">Matches</span><span className="text-right">Wins</span>
            <span className="text-right">Kills</span><span className="text-right">Points</span>
            <span className="text-right">Earnings</span>
          </div>
          {rows.map((r) => (
            <div
              key={r.user.username}
              className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 border-b border-line px-5 py-3.5 last:border-0 sm:grid-cols-[3rem_1fr_5rem_5rem_5rem_6rem_6rem]"
            >
              <span className={`tabular font-display text-sm font-bold ${r.rank === 1 ? 'text-reward' : r.rank <= 3 ? 'text-fg' : 'text-fg-3'}`}>
                {r.rank}
              </span>
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={r.user.username} size={32} />
                <span className="min-w-0">
                  <Link href={`/players/${r.user.username}`} className="block truncate text-sm font-semibold text-fg hover:text-accent">
                    {r.user.username}
                  </Link>
                  <span className="block truncate text-xs text-fg-3">
                    {r.user.profile?.freeFireIGN ?? r.user.profile?.city ?? 'Free Fire player'}
                  </span>
                </span>
              </span>
              <span className="hidden text-right text-sm text-fg-2 sm:block">{r.matchesPlayed}</span>
              <span className="hidden text-right text-sm text-fg-2 sm:block">{r.wins}</span>
              <span className="hidden text-right text-sm text-fg-2 sm:block">{r.kills}</span>
              <span className="tabular hidden text-right text-sm font-bold text-accent sm:block">{r.totalPoints}</span>
              <span className="tabular text-right text-sm font-semibold text-reward">{money(r.earnings)}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No rankings yet for this period" sub="Play a verified tournament to appear here." />
      )}
    </div>
  );
}
