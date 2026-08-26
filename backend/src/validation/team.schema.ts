import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(3, 'Team name must be at least 3 characters').max(24),
  tag: z.string().min(2, 'Tag must be 2–5 characters').max(5).regex(/^[a-zA-Z0-9]+$/, 'Tag may only contain letters and numbers'),
  type: z.enum(['DUO', 'SQUAD']),
});

export const updateTeamSchema = z.object({
  name: z.string().min(3).max(24).optional(),
  tag: z.string().min(2).max(5).regex(/^[a-zA-Z0-9]+$/).optional(),
});

export const inviteSchema = z.object({
  username: z.string().min(3).max(20),
});

export const idBodySchema = z.object({ userId: z.string().min(1) });

export const createMatchSchema = z.object({
  tournamentId: z.string().min(1),
  matchNumber: z.coerce.number().int().positive(),
  round: z.coerce.number().int().positive().optional(),
  map: z.string().max(40).optional(),
  scheduledAt: z.string().datetime({ offset: true }),
  roomId: z.string().max(20).optional(),
  roomPassword: z.string().max(30).optional(),
  releaseMinutesBeforeStart: z.coerce.number().int().min(0).max(240).optional(),
});
