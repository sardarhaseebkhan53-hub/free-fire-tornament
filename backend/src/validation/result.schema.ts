import { z } from 'zod';

export const submitResultSchema = z.object({
  placement: z.coerce.number().int().min(1, 'Placement must be at least 1').max(100),
  kills: z.coerce.number().int().min(0).max(99),
  notes: z.string().trim().max(300).optional().default(''),
});

export const reviewResultSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'DISQUALIFY']),
  note: z.string().trim().max(300).optional().default(''),
  placement: z.coerce.number().int().min(1).max(100).optional(),
  kills: z.coerce.number().int().min(0).max(99).optional(),
});

export const submissionListQuerySchema = z.object({
  status: z.enum(['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});
