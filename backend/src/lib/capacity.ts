// =============================================================================
// Tournament capacity — the SINGLE source of truth for slot math.
//
// The platform never treats any number (48 included) as a universal slot
// configuration. Every event's structure is:
//
//   seats (maxSlots)  = player positions for solo-style modes,
//                       team/group positions for team-based modes
//   playersPerTeam    = 1 for solo-style modes, 2 DUO, 4 SQUAD/CLASH_SQUAD,
//                       admin-configured (1–8) for CUSTOM
//   total players     = maxSlots × playersPerTeam
//
// Services and API responses MUST go through these helpers so the database,
// the join engine and every UI surface agree on what a "slot" is.
// =============================================================================

export type TournamentTypeLike =
  | 'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD' | 'LONE_WOLF' | 'CLASH_SQUAD_1V1' | 'CUSTOM';

/** Default players-per-team for every built-in mode. CUSTOM is per-event. */
export const MODE_TEAM_SIZE: Record<TournamentTypeLike, number> = {
  SOLO: 1,
  DUO: 2,
  SQUAD: 4,
  CLASH_SQUAD: 4,
  LONE_WOLF: 1,
  CLASH_SQUAD_1V1: 1,
  CUSTOM: 1, // overridden by the event's own playersPerTeam column
};

/** Modes where one registration slot holds a whole team of playersPerTeam. */
export function isTeamMode(type: TournamentTypeLike, playersPerTeam: number): boolean {
  if (type === 'CUSTOM') return playersPerTeam > 1;
  return (MODE_TEAM_SIZE[type] ?? 1) > 1;
}

export interface CapacitySubject {
  type: TournamentTypeLike;
  maxSlots: number;
  playersPerTeam?: number | null;
}

/**
 * Resolved players-per-team. Built-in modes are PINNED to their real Free Fire
 * team size (a stored drift can never change what a seat means); only CUSTOM
 * reads the admin-configured column.
 */
export function playersPerTeamOf(t: CapacitySubject): number {
  if (t.type === 'CUSTOM') return Math.max(1, t.playersPerTeam ?? 1);
  return MODE_TEAM_SIZE[t.type] ?? 1;
}

export interface CapacityView {
  /** Seat count stored on the tournament row (maxSlots). */
  seats: number;
  playersPerTeam: number;
  /** Total individual player positions = seats × playersPerTeam. */
  totalPlayers: number;
  /** True when a seat is a team/group position rather than one player. */
  teamMode: boolean;
  /** What one slot on this event represents — for honest UI copy. */
  slotUnit: 'players' | 'teams';
}

export function capacityOf(t: CapacitySubject): CapacityView {
  const playersPerTeam = playersPerTeamOf(t);
  const teamMode = isTeamMode(t.type, playersPerTeam);
  return {
    seats: t.maxSlots,
    playersPerTeam,
    totalPlayers: t.maxSlots * playersPerTeam,
    teamMode,
    slotUnit: teamMode ? 'teams' : 'players',
  };
}

/**
 * Derives the playersPerTeam value to persist for a tournament type.
 * CUSTOM keeps whatever the admin configured; every built-in mode is pinned to
 * its real Free Fire team size so the two can never disagree.
 */
export function playersPerTeamFor(type: TournamentTypeLike, customPlayersPerTeam?: number): number {
  if (type === 'CUSTOM') return Math.min(8, Math.max(1, Math.floor(customPlayersPerTeam ?? 4)));
  return MODE_TEAM_SIZE[type] ?? 1;
}
