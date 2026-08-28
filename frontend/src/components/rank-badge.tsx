'use client';
// ZP Battle "Skill-Based Ranking" badge — shows a player's live rank tier.
// Rendered from the server-derived `rankInfo` object (no client-side math).
import type { RankInfo } from '@/lib/types';

export function RankBadge({ rankInfo, small, showProgress }: {
  rankInfo?: RankInfo | null;
  small?: boolean;
  showProgress?: boolean;
}) {
  if (!rankInfo) return null;
  const style = {
    color: rankInfo.color,
    borderColor: `${rankInfo.color}55`,
    background: `${rankInfo.color}1a`,
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span
        className={`inline-flex items-center gap-1 rounded-pill border font-bold uppercase tracking-wide ${small ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'}`}
        style={style}
        title={rankInfo.nextLabel ? `${rankInfo.label} → ${rankInfo.nextLabel}` : `${rankInfo.label} (top rank)`}
      >
        {rankInfo.label}
        {showProgress && rankInfo.nextLabel && (
          <span className="opacity-80">· {rankInfo.progress}%</span>
        )}
      </span>
    </span>
  );
}

export function RankBadgeSmall({ rankInfo }: { rankInfo?: RankInfo | null }) {
  return <RankBadge rankInfo={rankInfo} small />;
}
