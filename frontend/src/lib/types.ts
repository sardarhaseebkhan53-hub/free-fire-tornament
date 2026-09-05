// API payload types (mirror the backend public contract).
// Decimal fields arrive as strings over JSON.

export type TournamentType =
  | 'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD' | 'LONE_WOLF' | 'CLASH_SQUAD_1V1' | 'CUSTOM';

export interface TournamentSummary {
  id: string;
  title: string;
  slug: string;
  type: TournamentType;
  map: string | null;
  status: string;
  banner: string | null;
  isVerified: boolean;
  isFeatured: boolean;
  entryFeePerPlayer: string;
  prizePool: string;
  platformFee: string;
  /** Seat count — what one slot IS depends on `capacityUnit`. */
  maxSlots: number;
  registeredSlots: number;
  /** CUSTOM events carry an admin label for their format. */
  customLabel?: string | null;
  numWinners: number;
  startTime: string;
  registrationDeadline: string;
  /** Players per team/group — 1 for solo-style modes. */
  teamSize: number;
  playersPerTeam: number;
  /** What maxSlots/registeredSlots count: 'players' (solo) or 'teams'. */
  capacityUnit: 'players' | 'teams';
  /** maxSlots × playersPerTeam — the real individual-player capacity. */
  totalPlayerCapacity: number;
  /** Confirmed individual players (headcount from registrations). */
  registeredPlayers: number;
  playersLeft: number;
  /** Team-mode counters (null on solo modes). */
  teamsTotal: number | null;
  teamsFilled: number | null;
  entryFeePerTeam: number;
  slotsLeft: number;
  registrationOpen: boolean;
  startsInMs: number;
}

export interface PrizeRow {
  position: number;
  amount: string;
  label: string | null;
  kind: string | null;
  perKill: string | null;
  cap: string | null;
}

export interface TournamentDetails extends TournamentSummary {
  description: string | null;
  rules: string | null;
  endTime: string | null;
  refundPercent: string;
  pointsPerKill: number;
  allowIndependentDuo: boolean;
  allowIndependentSquad: boolean;
  prizeBreakdown: { entryFeesCollected: number; prizePool: number; platformFee: number };
  prizes: PrizeRow[];
  matches: Array<{
    id: string;
    round: number;
    matchNumber: number;
    map: string | null;
    scheduledAt: string;
    status: string;
    credentialsUnlocked: boolean;
    credentialsReleaseInMs: number | null;
  }>;
  /**
   * The event room, as state + timing (`RoomPublicView`) — this response has no credential
   * fields to leak, which is why the player's card can render "Hidden" honestly. The values
   * come from `GET /api/tournaments/:slug/room`, per viewer. Absent on rows built before
   * this feature, and on any surface that stopped selecting the room.
   */
  room?: RoomState | null;
  participants: Array<{
    seatNumber: number | null;
    user: { username: string; avatar: string | null; uid: string | null; ign: string | null };
    team: {
      name: string;
      tag: string;
      members: Array<{ username: string; uid: string | null }>;
    } | null;
  }>;
}

/** ZP Battle "Skill-Based Ranking" — a live tier derived from total points. */
export interface RankInfo {
  tier: string;
  label: string;
  color: string;
  icon: string;
  nextLabel: string | null;
  progress: number;
}

export interface LeaderboardEntry {
  rank: number;
  matchesPlayed: number;
  wins: number;
  kills: number;
  totalPoints: number;
  rankInfo?: RankInfo;
  user: {
    username: string;
    avatar: string | null;
    profile: { freeFireIGN: string | null; city: string | null } | null;
  };
}

export interface WinnerRow {
  position: number;
  amount: string;
  creditedAt: string;
  tournament: { title: string; slug: string; type: string; banner: string | null };
  user: { username: string; avatar: string | null } | null;
  team: { name: string; tag: string } | null;
}

export interface HomeStats {
  totalPlayers: number;
  totalTournaments: number;
  liveTournaments: number;
  totalPrizeDistributed: string;
  currency: string;
}

export interface BlogSummary {
  title: string;
  slug: string;
  excerpt: string | null;
  coverImage: string | null;
  category: string;
  publishedAt: string;
  author: { username: string };
}

export interface Faq {
  question: string;
  answer: string;
  category: string | null;
}

/* ───────────────────────── tournament room (Phase 20) ───────────────────────
   Field names here mirror `room.service.ts` exactly: `RoomState` is its
   `RoomPublicView`, `PlayerRoom` is what `playerRoomView` returns, `AdminRoom` is
   `adminRoomView`'s `room`. The public shapes deliberately have NO credential fields —
   "Hidden" is the server's answer, not a masked one — and the admin shape is the only one
   that carries `roomPassword`, so nothing here can be the reason a password leaks. */
export type RoomStatus = 'NOT_ADDED' | 'SCHEDULED' | 'AVAILABLE' | 'CANCELLED';
export type RoomReleaseSource = 'PINNED' | 'EVENT' | 'GLOBAL';

/** State + timing, never values. Sent to players, lists and the admin table. */
export interface RoomState {
  status: RoomStatus;
  /** the human phrase from the API: `Room Scheduled`, `Room Cancelled`, … */
  label: string;
  /** null while no credentials exist — there is nothing to unlock yet */
  releaseAt: string | null;
  releaseInMs: number | null;
  releaseMinutes: number;
  /** an admin hid it again: kept on the row, never served */
  hidden: boolean;
  /** only while CANCELLED */
  cancelReason: string | null;
}

/** `GET /api/tournaments/:slug/room` for a confirmed seat. */
export interface PlayerRoom extends RoomState {
  /** populated only while `status === 'AVAILABLE'`, otherwise null by construction */
  roomId: string | null;
  roomPassword: string | null;
  eligible: boolean;
  seatNumber: number | null;
}

/** `room` of `GET /api/admin/tournaments/:id/room` — the raw resolver state. */
export interface AdminRoom extends RoomState {
  releaseAt: string;
  releaseInMs: number;
  hasRoomId: boolean;
  hasRoomPassword: boolean;
  /** true exactly when an eligible player may see the values right now */
  unlocked: boolean;
  releasedAt: string | null;
  releaseSource: RoomReleaseSource;
  roomId: string | null;
  roomPassword: string | null;
  note: string | null;
  cancelledAt: string | null;
  updatedAt: string | null;
}

export interface AdminRoomDetail {
  tournament: {
    id: string;
    title: string;
    slug: string;
    type: string;
    status: string;
    startTime: string;
    registrationDeadline: string;
    endTime: string | null;
    maxSlots: number;
    registeredSlots: number;
    confirmedSeats: number;
  };
  room: AdminRoom;
  config: { globalReleaseMinutes: number };
  /** per-match rooms, which run on their own clock (`match.service.ts`) */
  matchRooms: Array<{
    id: string;
    matchNumber: number;
    scheduledAt: string | null;
    status: string;
    hasCredentials: boolean;
    releaseAt: string | null;
  }>;
}

export interface AdminRoomSaveResult {
  room: AdminRoom;
  releasedImmediately: boolean;
  releaseAt: string;
  releaseInMs: number;
  releaseMinutes: number;
  releaseSource: RoomReleaseSource;
}
