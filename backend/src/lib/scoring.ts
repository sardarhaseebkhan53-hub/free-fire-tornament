// =============================================================================
// Scoring — per-tournament formula (never hard-coded in one place).
//
//   Final Score = PlacementPoints(position) + Kills × pointsPerKill + Bonus − Penalty
//
// The placement table lives on the Tournament row (`placementPoints`, a JSON
// array like [12,9,8,7,6,5,4,3,2,1]); when unset it falls back to the platform
// default. Both are applied server-side; the admin UI only previews.
// =============================================================================

/** Platform default placement table (positions 1..10). */
export const DEFAULT_PLACEMENT_POINTS = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

/** Normalize any stored/supplied table into a number[] (invalid → default). */
export function normalizePlacementTable(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PLACEMENT_POINTS];
  const parsed = raw.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  return parsed.length > 0 ? parsed : [...DEFAULT_PLACEMENT_POINTS];
}

/** Points for a placement from a table (out-of-range → 0). */
export function placementPointsFor(placement: number, table: number[]): number {
  if (!Number.isInteger(placement) || placement < 1) return 0;
  return table[placement - 1] ?? 0;
}

export interface ScoreInput {
  placement: number;
  kills: number;
  pointsPerKill: number;
  table: number[];
  bonus: number;
  penalty: number;
}

/** Final score with the full formula. Never negative. */
export function finalScoreFor(input: ScoreInput): number {
  const base = placementPointsFor(input.placement, input.table);
  const killPoints = Math.max(0, input.kills) * Math.max(0, input.pointsPerKill);
  const total = base + killPoints + Math.max(0, input.bonus) - Math.max(0, input.penalty);
  return Math.max(0, Math.round(total));
}

/** Legacy helper kept for the verification-review path (placement table optional). */
export function pointsFor(placement: number, kills: number, perKill: number, table?: number[]): number {
  const t = table && table.length ? table : [...DEFAULT_PLACEMENT_POINTS];
  return placementPointsFor(placement, t) + kills * perKill;
}

/** Rank rows by final score (tie-break: kills, then placement). */
export function rankByScore<T extends { key: string; score: number; kills: number; placement: number | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) =>
    b.score - a.score ||
    b.kills - a.kills ||
    (b.placement ?? 999) - (a.placement ?? 999) ||
    a.key.localeCompare(b.key),
  );
}
