// =============================================================================
// Player rank ladder (ZP Battle "Skill-Based Ranking").
//
// A lightweight, pure-function rank classifier derived from a player's total
// points (placement points + kill points). It drives the leaderboard badges,
// player profiles and the dashboard. No schema change, no DB dependency — a
// rank is always computed on the fly, so it can never drift out of sync.
// =============================================================================

export interface RankTier {
  tier: string; // stable key, e.g. "DIAMOND"
  label: string; // display label, e.g. "Diamond"
  minPoints: number; // inclusive threshold
  color: string; // badge/accent colour
  /** Optional icon glyph used by the UI (Lucide icon names are resolved client-side). */
  icon: string;
}

export const RANK_TIERS: readonly RankTier[] = [
  { tier: 'BRONZE', label: 'Bronze', minPoints: 0, color: '#CD7F32', icon: 'Shield' },
  { tier: 'SILVER', label: 'Silver', minPoints: 150, color: '#C0C7D1', icon: 'Shield' },
  { tier: 'GOLD', label: 'Gold', minPoints: 400, color: '#F5C518', icon: 'Shield' },
  { tier: 'PLATINUM', label: 'Platinum', minPoints: 900, color: '#E5E4E2', icon: 'Shield' },
  { tier: 'DIAMOND', label: 'Diamond', minPoints: 1800, color: '#66E0FF', icon: 'Gem' },
  { tier: 'MASTER', label: 'Master', minPoints: 3500, color: '#B39DDB', icon: 'Crown' },
  { tier: 'GRANDMASTER', label: 'Grandmaster', minPoints: 6000, color: '#FF6E6E', icon: 'Crown' },
] as const;

export interface RankInfo {
  tier: string;
  label: string;
  color: string;
  icon: string;
  /** Points needed to reach the next tier, or null at the top. */
  nextLabel: string | null;
  /** Progress (0..100) toward the next tier, or 100 at the top. */
  progress: number;
}

/** Highest tier whose minPoints is <= points. Always at least BRONZE. */
export function rankFor(points: number): RankInfo {
  const p = Math.max(0, Number.isFinite(points) ? points : 0);
  // Start from BRONZE (index 0 is always populated by the constant array).
  let current: RankTier = RANK_TIERS[0]!;
  for (const tier of RANK_TIERS) {
    if (p >= tier.minPoints) current = tier;
  }
  const idx = RANK_TIERS.indexOf(current);
  const next = idx >= 0 ? RANK_TIERS[idx + 1] ?? null : null;
  const progress = next
    ? Math.min(100, Math.round(((p - current.minPoints) / (next.minPoints - current.minPoints)) * 100))
    : 100;
  return {
    tier: current.tier,
    label: current.label,
    color: current.color,
    icon: current.icon,
    nextLabel: next?.label ?? null,
    progress,
  };
}

/** Human labels + colours for the frontend, so the UI never hardcodes ranks. */
export function rankCatalog(): Array<{ tier: string; label: string; color: string; minPoints: number; icon: string }> {
  return RANK_TIERS.map((r) => ({
    tier: r.tier,
    label: r.label,
    color: r.color,
    minPoints: r.minPoints,
    icon: r.icon,
  }));
}
