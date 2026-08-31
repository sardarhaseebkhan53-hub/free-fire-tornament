// Public player profile — spec §31: limited info only (never email/phone/payment data).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { apiServerDetail } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { RankBadge } from '@/components/rank-badge';
import { Reveal } from '@/components/reveal';
import type { RankInfo } from '@/lib/types';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const p = await apiServerDetail<PublicPlayer>(`/public/players/${encodeURIComponent(username)}`);
  if (!p) return { title: 'Player not found | CLUTCHNEX' };
  return pageMetadata({
    slug: `player-${username}`,
    title: `${p.freeFireIGN ?? p.username} (${p.username}) — Free Fire Player Stats | CLUTCHNEX`,
    description: `Free Fire stats for ${p.username}: ${p.stats.matchesPlayed} matches, ${p.stats.wins} wins, ${p.stats.kills} kills, ${p.stats.totalPoints} points.`,
    path: `/players/${username}`,
  });
}

interface PublicPlayer {
  username: string;
  avatar: string | null;
  joinedAt: string;
  freeFireIGN: string | null;
  city: string | null;
  bio: string | null;
  rankInfo?: RankInfo;
  stats: {
    matchesPlayed: number;
    wins: number;
    kills: number;
    totalPoints: number;
    winRate: number;
  };
}

export default async function PlayerProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const p = await apiServerDetail<PublicPlayer>(`/public/players/${encodeURIComponent(username)}`);
  if (!p) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/leaderboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-3 hover:text-accent">
        <ArrowLeft size={15} /> Leaderboard
      </Link>

      <div className="glass mt-6 rounded-card p-8 text-center">
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-accent/40 bg-accent/15 font-display text-2xl font-bold text-accent">
          {p.username.slice(0, 2).toUpperCase()}
        </span>
        <h1 className="mt-4 flex items-center justify-center gap-2 font-display text-2xl font-bold text-fg">
          {p.username}
          {p.stats.totalPoints > 0 && <ShieldCheck size={18} className="text-success" aria-label="Verified competitor" />}
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          {p.freeFireIGN ?? 'Free Fire player'} {p.city ? `· ${p.city}` : ''}
        </p>
        {p.rankInfo && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <RankBadge rankInfo={p.rankInfo} />
            {p.rankInfo.nextLabel && (
              <span className="text-[11px] text-fg-3">
                {p.rankInfo.progress}% to {p.rankInfo.nextLabel}
              </span>
            )}
          </div>
        )}
        {p.bio && <p className="mx-auto mt-3 max-w-md text-sm text-fg-3">{p.bio}</p>}

        <Reveal><div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Matches', String(p.stats.matchesPlayed)],
            ['Wins', String(p.stats.wins)],
            ['Win rate', `${p.stats.winRate}%`],
            ['Kills', String(p.stats.kills)],
            ['Points', String(p.stats.totalPoints)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-input bg-white/[4%] px-3 py-3">
              <p className="tabular font-display text-xl font-bold text-fg">{value}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-fg-3">{label}</p>
            </div>
          ))}
        </div></Reveal>
      </div>
    </div>
  );
}
