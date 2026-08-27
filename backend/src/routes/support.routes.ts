// =============================================================================
// /api/support — player-side support tickets (Phase 11).
// Authenticated; attachments are optional multipart images; every read/write
// is ownership-checked in the service.
// =============================================================================
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { uploadResponseHeaders } from '../lib/security';
import { ticketCreateLimiter } from '../middleware/rateLimit';
import { ok } from '../lib/respond';
import { optionalTicketAttachment, resolveUploadPath } from '../lib/upload';
import { createTicketSchema, ticketListQuerySchema, ticketReplySchema } from '../validation/support.schema';
import {
  closeMyTicket, createTicket, listMyTickets, myTicketThread, replyMyTicket, ticketAttachmentPath,
} from '../services/support.service';

export const supportRouter = Router();

supportRouter.use(requireAuth);

// Create — optional `attachment` image alongside JSON fields
supportRouter.post('/', ticketCreateLimiter, optionalTicketAttachment, async (req, res) => {
  const input = createTicketSchema.parse(req.body);
  const rel = req.file ? `tickets/${req.file.filename}` : null;
  const out = await createTicket(req.auth!.id, input, rel);
  return ok(res, out, `Ticket ${out.ref} opened — staff will reply soon.`, 201);
});

// My tickets (paged, filterable)
supportRouter.get('/', async (req, res) => {
  const q = ticketListQuerySchema.parse(req.query);
  return ok(res, await listMyTickets(req.auth!.id, q));
});

// One thread
supportRouter.get('/:id', async (req, res) => {
  return ok(res, await myTicketThread(req.auth!.id, String(req.params.id)));
});

// Reply — optional attachment
supportRouter.post('/:id/reply', optionalTicketAttachment, async (req, res) => {
  const { body } = ticketReplySchema.parse(req.body);
  const rel = req.file ? `tickets/${req.file.filename}` : null;
  const out = await replyMyTicket(req.auth!.id, String(req.params.id), body, rel);
  return ok(res, out, 'Reply sent.');
});

// Close own ticket
supportRouter.post('/:id/close', async (req, res) => {
  return ok(res, await closeMyTicket(req.auth!.id, String(req.params.id)), 'Ticket closed.');
});

// Attachment download — owner or staff only (mirrors deposit screenshots)
supportRouter.get('/attachments/:messageId', async (req, res, next) => {
  try {
    const rel = await ticketAttachmentPath(req.auth!.id, req.auth!.role, String(req.params.messageId));
    const abs = resolveUploadPath(rel);
    uploadResponseHeaders(res, rel.split('/').pop() ?? 'attachment');
    return res.sendFile(abs);
  } catch (e) {
    return next(e);
  }
});
