import { z } from 'zod';

export const joinSchema = z.object({
  tournamentSlug: z.string().min(3).max(120),
  teamId: z.string().min(1).optional(),
  couponCode: z
    .string()
    .max(24)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim().toUpperCase() : undefined)),
  // Server-side validation in the join engine; trimmed here only.
  freeFireUID: z.string().trim().max(15).optional(),
  freeFireIGN: z.string().trim().max(24).optional(),
});

// Check-in takes only the event slug: the server owns the window, the seat lookup and
// the attendance stamp, so there is nothing for a client to assert about itself.
export const checkInSchema = z.object({
  tournamentSlug: z.string().min(3).max(120),
});

export const couponPreviewSchema = z.object({
  code: z.string().min(2).max(24),
  tournamentSlug: z.string().min(3).max(120),
});
