import { z } from 'zod';

/**
 * A URL that is safe to put in an href.
 *
 * Zod's .url() only checks that the string parses, and `javascript:alert(1)`,
 * `data:text/html,…` and `vbscript:…` all parse fine — so .url() alone lets an
 * admin-storeable link execute script the moment anything renders it. Ads are
 * not rendered on a public page today, but the field exists to be rendered, so
 * the check belongs here rather than at every future call site.
 */
export const safeUrl = (max = 300) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => {
      if (value === '') return true;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return false;
      }
      // Relative paths are allowed; anything with a scheme must be http(s).
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    }, 'URL must start with http:// or https://');

const pageSchema = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(5).max(100).default(20) };

export const userListQuerySchema = z.object({ q: z.string().trim().max(64).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_VERIFICATION']).optional(), ...pageSchema });

const TOURNAMENT_LIST_STATUSES = ['DRAFT', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED', 'CANCELLED'] as const;

/** Admin tournament list — must NOT reuse userListQuerySchema: that schema's
 * `status` enum is account states (ACTIVE/BANNED/…), so a leftover `?status=`
 * from another admin page (or a tournament status filter) 400'd the list.
 * Unknown / empty status values are dropped rather than rejected so a shared
 * `?status=` from Users / Deposits cannot take the calendar down. */
export const tournamentListQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  status: z.preprocess((v) => {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s !== 'string' || s === '') return undefined;
    return (TOURNAMENT_LIST_STATUSES as readonly string[]).includes(s) ? s : undefined;
  }, z.enum(TOURNAMENT_LIST_STATUSES).optional()),
  ...pageSchema,
});

export const userStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']),
  reason: z.string().trim().max(200).optional().default(''),
});

export const adjustBalanceSchema = z.object({
  bucket: z.enum(['CASH', 'COINS', 'WINNING', 'BONUS']),
  amount: z.coerce.number().int().refine((v) => v !== 0, 'Amount must be non-zero'),
  note: z.string().trim().min(3, 'A note is required for audited adjustments').max(200),
});

export const prizeSchema = z.object({
  kind: z.enum(['PLACEMENT', 'KILL_POOL', 'MVP', 'BONUS']),
  amount: z.coerce.number().min(0),
  perKill: z.coerce.number().min(0).optional(),
  cap: z.coerce.number().min(0).optional(),
  label: z.string().trim().max(40).optional(),
});

export const createTournamentSchema = z.object({
  title: z.string().trim().min(4).max(120),
  type: z.enum(['SOLO', 'DUO', 'SQUAD', 'CLASH_SQUAD', 'LONE_WOLF', 'CLASH_SQUAD_1V1']),
  description: z.string().trim().max(2000).optional().default(''),
  map: z.string().trim().max(40).optional().default(''),
  startTime: z.coerce.date(),
  registrationDeadline: z.coerce.date(),
  maxSlots: z.coerce.number().int().min(2).max(500),
  minSlotsToStart: z.coerce.number().int().min(2).max(500),
  entryFeePerPlayer: z.coerce.number().min(0).max(100000),
  pointsPerKill: z.coerce.number().int().min(0).max(20).default(1),
  numWinners: z.coerce.number().int().min(1).max(50).default(3),
  refundPercent: z.coerce.number().min(0).max(100).default(100),
  prizes: z.array(prizeSchema).min(1).max(20),
  publish: z.boolean().default(false),
  confirmLoss: z.boolean().default(false),
  // Spec §5 — full tournament configuration
  banner: z.string().trim().max(300).optional().default(''),
  rules: z.string().trim().max(4000).optional().default(''),
  placementPoints: z.array(z.coerce.number().int().min(0).max(1000)).max(50).optional(),
  bonusPoints: z.coerce.number().int().min(0).max(9999).default(0),
  penaltyPoints: z.coerce.number().int().min(0).max(9999).default(0),
  roomId: z.string().trim().max(20).optional().default(''),
  roomPassword: z.string().trim().max(30).optional().default(''),
  // The event's OWN room (Room ID / password on the tournament, released on the room
  // schedule). Deliberately a nested object rather than reusing the two fields above:
  // those seed the first MATCH's credentials and predate this feature, so keeping them
  // separate means no existing caller of this endpoint changes meaning.
  room: z
    .object({
      roomId: z.string().trim().max(40).optional().default(''),
      roomPassword: z.string().trim().max(60).optional().default(''),
      releaseMinutesBeforeStart: z.coerce.number().int().min(0).max(1440).nullish(),
      note: z.string().trim().max(400).optional().default(''),
    })
    .optional(),
  matchNumber: z.coerce.number().int().min(1).max(500).optional().default(1),
  matchMap: z.string().trim().max(40).optional().default(''),
  matchScheduledOffsetMinutes: z.coerce.number().int().min(0).max(1440).optional().default(0),
})
  // A tournament cannot start in the past, and registration must close on or
  // before it starts. Without these the admin form happily saved a match whose
  // start time had already elapsed, which is why the detail page rendered
  // "match starts in Now" while registration was still counting down.
  .refine((v) => v.startTime.getTime() > Date.now(), {
    path: ['startTime'],
    message: 'Start time must be in the future.',
  })
  .refine((v) => v.registrationDeadline.getTime() <= v.startTime.getTime(), {
    path: ['registrationDeadline'],
    message: 'Registration must close at or before the tournament start time.',
  })
  .refine((v) => v.minSlotsToStart <= v.maxSlots, {
    path: ['minSlotsToStart'],
    message: 'Minimum slots to start cannot exceed max slots.',
  });

export const tournamentScoringSchema = z.object({
  pointsPerKill: z.coerce.number().int().min(0).max(20),
  placementPoints: z.array(z.coerce.number().int().min(0).max(1000)).max(50),
  bonusPoints: z.coerce.number().int().min(0).max(9999),
  penaltyPoints: z.coerce.number().int().min(0).max(9999),
});

export const tournamentStatusSchema = z.object({
  status: z.enum(['DRAFT', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED', 'CANCELLED']),
});

/**
 * Tournament room — the admin's add/update payload.
 *
 * Every field is `nullish` rather than optional-with-default, because "leave the Room ID
 * alone" and "clear the Room ID" are different instructions and the service has to be
 * able to tell them apart. `''` means clear: a form that blanks a field is the admin
 * removing a value, not a transport accident.
 *
 * The credential patterns live in room.service (they are shared with the builder), so the
 * schema only bounds length — this is the layer that refuses an oversized body, not the
 * layer that decides what a room ID is.
 */
export const tournamentRoomSchema = z
  .object({
    roomId: z.string().trim().max(40).nullish(),
    roomPassword: z.string().trim().max(60).nullish(),
    /** Pinned release instant; null/'' re-derives it from the event's start time. */
    releaseAt: z.string().trim().max(40).nullish(),
    releaseMinutesBeforeStart: z.coerce.number().int().min(0).max(1440).nullish(),
    enabled: z.boolean().optional(),
    note: z.string().trim().max(400).nullish(),
  })
  // Nothing sent is not the same as an empty room: the service rejects "clear both", but
  // an accidental `{}` (a form submitted before hydration) must not be a silent write.
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to save — change a room field first.' });

/** The four room switches. A reason is mandatory for CANCEL, enforced in the service. */
export const tournamentRoomStatusSchema = z.object({
  action: z.enum(['HIDE', 'SHOW', 'CANCEL', 'REACTIVATE']),
  reason: z.string().trim().max(200).optional(),
});

export const matchStatusSchema = z.object({
  status: z.enum(['UPCOMING', 'SCHEDULED', 'ROOM_CREATED', 'ROOM_OPEN', 'CREDENTIALS_RELEASED', 'LIVE', 'COMPLETED', 'CANCELLED']),
});

export const matchListQuerySchema = z.object({
  tournamentId: z.string().max(40).optional(),
  q: z.string().trim().max(64).optional(),
  status: z.enum(['UPCOMING', 'SCHEDULED', 'ROOM_CREATED', 'ROOM_OPEN', 'CREDENTIALS_RELEASED', 'LIVE', 'COMPLETED', 'CANCELLED']).optional(),
  sort: z.enum(['scheduledAt', 'matchNumber', 'status']).optional().default('scheduledAt'),
  dir: z.enum(['asc', 'desc']).optional().default('desc'),
  ...pageSchema,
});

/** Admin result-row editor (spec §39) — server recomputes final score. */
export const adminResultRowSchema = z.object({
  participantId: z.string().min(1),
  position: z.coerce.number().int().min(1).max(500).nullish(),
  kills: z.coerce.number().int().min(0).max(999).nullish(),
  bonus: z.coerce.number().int().min(0).max(9999).nullish(),
  penalty: z.coerce.number().int().min(0).max(9999).nullish(),
  prize: z.coerce.number().min(0).max(10_000_000).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  status: z.enum(['REGISTERED', 'PLAYED', 'DISQUALIFIED']).optional(),
  absent: z.boolean().optional(),
  ready: z.boolean().optional(),
  evidenceUrl: z.string().trim().max(300).nullish(),
});

export const resultsStatusSchema = z.object({
  status: z.enum(['DRAFT', 'UNDER_REVIEW', 'CONFIRMED', 'PUBLISHED']),
});

/** Admin slot control (spec §12) */
export const slotAssignSchema = z.object({
  slot: z.coerce.number().int().min(1).max(500),
  reason: z.string().trim().max(300).optional().default(''),
});

export const slotClearSchema = z.object({
  reason: z.string().trim().max(300).optional().default(''),
});

export const slotLockSchema = z.object({
  locked: z.boolean(),
  note: z.string().trim().max(300).nullish().default(''),
});

export const participantStateSchema = z.object({
  ready: z.boolean().optional(),
  absent: z.boolean().optional(),
  status: z.enum(['REGISTERED', 'PLAYED', 'DISQUALIFIED']).optional(),
  note: z.string().trim().max(500).optional(),
});

export const registrationReadySchema = z.object({
  ready: z.boolean(),
  note: z.string().trim().max(300).nullish().default(''),
});

/** Pair independently-registered players into a DUO or SQUAD team (spec §Modes). */
export const teamPairSchema = z.object({
  registrationIds: z.array(z.string().min(1).max(40)).min(2).max(4),
});

/** Leaderboard admin controls (spec §40) — financial records untouched. */
export const leaderboardAdjustSchema = z.object({
  userId: z.string().min(1),
  kills: z.coerce.number().int().min(-10000).max(10000).optional(),
  totalPoints: z.coerce.number().int().min(-100000).max(100000).optional(),
  wins: z.coerce.number().int().min(-1000).max(1000).optional(),
  matchesPlayed: z.coerce.number().int().min(-1000).max(1000).optional(),
  note: z.string().trim().min(3).max(300),
});

export const matchUpdateSchema = z.object({
  notes: z.string().trim().max(500).nullish(),
  roomId: z.string().trim().max(20).nullish(),
  roomPassword: z.string().trim().max(30).nullish(),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  map: z.string().trim().max(40).nullish(),
});

// Both sides optional: omitting (or nulling) one half returns it to the derived default.
// The ordering check here is a courtesy — the service re-validates against the PROJECTED
// window, since a derived half can be the one that breaks the sequence.
export const checkInWindowSchema = z
  .object({
    opensAt: z.coerce.date().nullable().optional(),
    closesAt: z.coerce.date().nullable().optional(),
  })
  .refine((v) => !v.opensAt || !v.closesAt || v.closesAt.getTime() > v.opensAt.getTime(), {
    path: ['closesAt'],
    message: 'Check-in must close after it opens.',
  });

export const ticketListQuerySchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED']).optional(), ...pageSchema });

export const ticketReplySchema = z.object({
  body: z.string().trim().min(2).max(2000),
  close: z.boolean().default(false),
});

export const blogListQuerySchema = z.object(pageSchema);

export const createBlogSchema = z.object({
  title: z.string().trim().min(4).max(140),
  category: z.enum(['TOURNAMENTS', 'GUIDES', 'TIPS', 'NEWS', 'STRATEGY', 'ANNOUNCEMENTS']).default('NEWS'),
  excerpt: z.string().trim().max(300).optional().default(''),
  content: z.string().trim().min(20).max(50000),
  seoTitle: z.string().trim().max(140).optional().default(''),
  seoDescription: z.string().trim().max(320).optional().default(''),
  publish: z.boolean().default(false),
});

export const blogStatusSchema = z.object({ publish: z.boolean() });

export const createAdSchema = z.object({
  placement: z.enum(['HEADER', 'TOURNAMENT_PAGE', 'SIDEBAR', 'BLOG', 'FOOTER', 'MOBILE', 'INTERSTITIAL']),
  name: z.string().trim().min(2).max(80),
  targetUrl: safeUrl(300).optional(),
  embedHtml: z.string().trim().max(4000).optional().or(z.literal('')),
});

export const adToggleSchema = z.object({ isActive: z.boolean() });

export const paymentAccountSchema = z.object({
  method: z.enum(['JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'NAYAPAY', 'SADAPAY']),
  label: z.string().trim().min(2).max(80),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().min(4).max(64),
  instructions: z.string().trim().max(500).optional().nullish().default(''),
  displayOrder: z.coerce.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  extra: z.record(z.string(), z.unknown()).optional().nullish(),
});

export const paymentAccountToggleSchema = z.object({ isActive: z.boolean() });

export const upsertSeoSchema = z.object({
  pageSlug: z.string().trim().min(1).max(80),
  title: z.string().trim().max(160).optional().default(''),
  description: z.string().trim().max(320).optional().default(''),
  canonicalUrl: z.string().trim().max(300).optional().default(''),
  keywords: z.string().trim().max(300).optional().default(''),
});

export const settingUpdateSchema = z.object({
  key: z.string().trim().min(2).max(80),
  value: z.unknown(),
});

/** Full wallet-ledger filter for the admin Transactions page. */
export const adminTransactionsQuerySchema = z.object({
  type: z.string().trim().max(40).optional(),
  bucket: z.string().trim().max(20).optional(),
  direction: z.enum(['CREDIT', 'DEBIT']).optional(),
  q: z.string().trim().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  csv: z.enum(['1', 'true']).optional(),
  ...pageSchema,
});

export const auditLogQuerySchema = z.object({
  action: z.string().trim().max(40).optional(),
  entity: z.string().trim().max(40).optional(),
  ...pageSchema,
});

/** Phase 14 — fraud review queue. */
export const fraudListQuerySchema = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  kind: z.string().trim().max(40).optional(),
  ...pageSchema,
});

export const fraudReviewSchema = z.object({
  action: z.enum(['REVIEWED', 'DISMISSED']),
  note: z.string().trim().max(500).optional().default(''),
});

export const revenueQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});

/** Phase 10 — financial dashboard query. */
export const financeQuerySchema = z.object({
  days: z.coerce.number().int().refine((d) => [30, 60, 90].includes(d), 'Window must be 30, 60 or 90 days').default(30),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  format: z.enum(['json', 'csv']).optional(),
});
