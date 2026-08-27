import { z } from 'zod';

export const notificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(15),
});

export const markReadSchema = z.object({
  id: z.string().min(10).optional(),
  all: z.boolean().optional(),
});
