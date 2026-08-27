import { z } from 'zod';

export const TICKET_CATEGORIES = [
  'PAYMENT', 'TOURNAMENT', 'WITHDRAWAL', 'ACCOUNT', 'TEAM', 'TECHNICAL', 'REPORT_PLAYER', 'OTHER',
] as const;
export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const createTicketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(5, 'Subject must be at least 5 characters').max(120),
  priority: z.enum(TICKET_PRIORITIES).default('MEDIUM'),
  message: z.string().trim().min(10, 'Describe your issue in at least 10 characters').max(4000),
});

export const ticketReplySchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(4000),
});

export const ticketListQuerySchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
});

export const nexaAskSchema = z.object({
  message: z.string().trim().min(1, 'Ask NEXA something').max(500),
});
