// API payload types (mirror the backend public contract).
// Decimal fields arrive as strings over JSON.

export interface TournamentSummary {
  id: string;
  title: string;
  slug: string;
  type: 'SOLO' | 'DUO' | 'SQUAD' | 'CLASH_SQUAD';
  map: string | null;
  status: string;
  banner: string | null;
  isVerified: boolean;
  isFeatured: boolean;
  entryFeePerPlayer: string;
  prizePool: string;
  platformFee: string;
  maxSlots: number;
  registeredSlots: number;
  numWinners: number;
  startTime: string;
  registrationDeadline: string;
  teamSize: number;
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
  participants: Array<{
    seatNumber: number | null;
    user: { username: string; avatar: string | null };
    team: { name: string; tag: string } | null;
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
