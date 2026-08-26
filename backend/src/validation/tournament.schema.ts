import { z } from 'zod';

export const joinSchema = z.object({
  tournamentSlug: z.string().min(3).max(120),
  teamId: z.string().min(1).optional(),
  couponCode: z
    .string()
    .max(24)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim().toUpperCase() : undefined)),
});

export const couponPreviewSchema = z.object({
  code: z.string().min(2).max(24),
  tournamentSlug: z.string().min(3).max(120),
});
