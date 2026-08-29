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
  // Normalize here so " Hamza_Sniper " behaves exactly like "hamza_sniper",
  // and fail early with a readable message instead of a generic lookup miss.
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be 20 characters or fewer')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers and _')
    .toLowerCase(),
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
  notes: z.string().trim().max(500).optional(),
  releaseMinutesBeforeStart: z.coerce.number().int().min(0).max(240).optional(),
});

export const joinTeamByCodeSchema = z.object({
  code: z.string().trim().min(4).max(24),
});
