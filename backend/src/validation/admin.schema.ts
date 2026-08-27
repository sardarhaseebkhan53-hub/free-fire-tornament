import { z } from 'zod';

const pageSchema = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(5).max(100).default(20) };

export const userListQuerySchema = z.object({ q: z.string().trim().max(64).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_VERIFICATION']).optional(), ...pageSchema });

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
  type: z.enum(['SOLO', 'DUO', 'SQUAD', 'CLASH_SQUAD']),
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
});

export const tournamentStatusSchema = z.object({
  status: z.enum(['DRAFT', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED', 'CANCELLED']),
});

export const matchStatusSchema = z.object({
  status: z.enum(['SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED']),
});

export const matchListQuerySchema = z.object({ tournamentId: z.string().max(40).optional(), ...pageSchema });

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
  publish: z.boolean().default(false),
});

export const blogStatusSchema = z.object({ publish: z.boolean() });

export const createAdSchema = z.object({
  placement: z.enum(['HEADER', 'TOURNAMENT_PAGE', 'SIDEBAR', 'BLOG', 'FOOTER', 'MOBILE', 'INTERSTITIAL']),
  name: z.string().trim().min(2).max(80),
  targetUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  embedHtml: z.string().trim().max(4000).optional().or(z.literal('')),
});

export const adToggleSchema = z.object({ isActive: z.boolean() });

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

export const auditLogQuerySchema = z.object({
  action: z.string().trim().max(40).optional(),
  entity: z.string().trim().max(40).optional(),
  ...pageSchema,
});

export const revenueQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});
