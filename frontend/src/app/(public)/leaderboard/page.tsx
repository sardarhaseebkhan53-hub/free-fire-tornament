// Leaderboard — spec §18: global + weekly + monthly boards.
import Link from 'next/link';
import { apiServerSafe } from '@/lib/api';
import type { LeaderboardEntry } from '@/lib/types';
import { SectionHeading, Avatar, EmptyState } from '@/components/ui';
import { RankBadgeSmall } from '@/components/rank-badge';
import { pageMetadata } from '@/lib/seo';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: 'leaderboard',
    title: 'Free Fire Leaderboard — Top Players in Pakistan | CLUTCHNEX',
    description: 'CLUTCHNEX rankings by points, wins and kills — global, weekly and monthly.',
    path: '/leaderboard',
    keywords: 'free fire leaderboard, FF top players pakistan, free fire rankings',
  });
}

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
        <>
          {/* Top 3 — podium treatment (2nd · 1st · 3rd) */}
          {rows.length >= 3 && (
            <div className="mb-8 grid grid-cols-3 items-end gap-2 sm:gap-4">
              {[rows[1], rows[0], rows[2]].map((r) => {
                const place = r.rank;
                const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉';
                const ring =
                  place === 1
                    ? 'border-reward/60 bg-gradient-to-b from-reward/20 to-transparent shadow-[0_0_36px_-8px_rgba(245,185,66,0.5)]'
                    : place === 2
                      ? 'border-fg-2/30 bg-gradient-to-b from-fg-2/12 to-transparent'
                      : 'border-[#B45309]/40 bg-gradient-to-b from-[#B45309]/15 to-transparent';
                const order = place === 1 ? 'order-first' : place === 2 ? 'order-none' : 'order-last';
                return (
                  <Link
                    key={r.user.username}
                    href={`/players/${r.user.username}`}
                    className={`glass group relative rounded-card border p-3 text-center transition duration-300 hover:-translate-y-1 sm:p-5 ${ring} ${order} ${
                      place === 1 ? 'pt-6 sm:pt-8' : 'pt-4 sm:pt-6'
                    }`}
                  >
                    <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 text-xl sm:text-2xl" aria-hidden>
                      {medal}
                    </span>
                    <div className="mx-auto w-fit">
                      <Avatar name={r.user.username} size={place === 1 ? 52 : 40} />
                    </div>
                    <p className="mt-2 truncate text-xs font-bold text-fg group-hover:text-accent sm:text-sm">{r.user.username}</p>
                    <p className="tabular mt-1 font-display text-sm font-bold text-reward sm:text-lg">{r.totalPoints}</p>
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-fg-3 sm:text-[10px]">
                      {r.wins}W · {r.kills} kills
                    </p>
                    <span className="mt-1 inline-block rounded-pill border border-line px-2 py-0.5 text-[9px] font-bold text-fg-2 sm:text-[10px]">
                      #{place}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="glass overflow-hidden rounded-card">
            <div className="hidden grid-cols-[3rem_1fr_5rem_5rem_5rem_6rem] gap-2 border-b border-line px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-fg-3 sm:grid">
              <span>#</span><span>Player</span>
              <span className="text-right">Matches</span><span className="text-right">Wins</span>
              <span className="text-right">Kills</span><span className="text-right">Points</span>
            </div>
            {rows.map((r) => (
              <div
                key={r.user.username}
                className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 border-b border-line px-5 py-3.5 last:border-0 sm:grid-cols-[3rem_1fr_5rem_5rem_5rem_6rem]"
              >
                <span className={`tabular font-display text-sm font-bold ${r.rank === 1 ? 'text-reward' : r.rank <= 3 ? 'text-fg' : 'text-fg-3'}`}>
                  {r.rank}
                </span>
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.user.username} size={32} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Link href={`/players/${r.user.username}`} className="truncate text-sm font-semibold text-fg hover:text-accent">
                        {r.user.username}
                      </Link>
                      <RankBadgeSmall rankInfo={r.rankInfo} />
                    </span>
                    <span className="block truncate text-xs text-fg-3">
                      {r.user.profile?.freeFireIGN ?? r.user.profile?.city ?? 'Free Fire player'}
                    </span>
                  </span>
                </span>
                <span className="hidden text-right text-sm text-fg-2 sm:block">{r.matchesPlayed}</span>
                <span className="hidden text-right text-sm text-fg-2 sm:block">{r.wins}</span>
                <span className="hidden text-right text-sm text-fg-2 sm:block">{r.kills}</span>
                <span className="tabular hidden text-right text-sm font-bold text-accent sm:block">{r.totalPoints}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <EmptyState title="No rankings yet for this period" sub="Play a verified tournament to appear here." />
      )}
    </div>
  );
}
