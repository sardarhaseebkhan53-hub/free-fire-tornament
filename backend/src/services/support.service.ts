// =============================================================================
// Phase 11 — Player support tickets.
//
// Players create tickets (category / priority / subject / message + optional
// screenshot attachment), converse with staff in a thread, and can close their
// own tickets. Ownership is enforced on every read/write; attachments are
// served only through the owner-or-staff gated route. Staff replies reuse the
// Phase 9 admin service (replyTicket) which already notifies the player; this
// service notifies staff when a player opens/replies.
//
// Status flow: OPEN (player) → staff replies → WAITING_USER → player replies →
// OPEN → … → RESOLVED (staff, with close) or CLOSED (player).
// CLOSED tickets are immutable — players open a new one instead.
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import type { z } from 'zod';
import type { createTicketSchema, ticketListQuerySchema } from '../validation/support.schema';

type CreateInput = z.infer<typeof createTicketSchema>;
type ListQuery = z.infer<typeof ticketListQuerySchema>;

const ticketRef = (id: string) => `TK-${id.slice(-6).toUpperCase()}`;

/** Staff (ADMIN/MODERATOR) get an in-app nudge when a player needs them. */
async function notifyStaff(ticketId: string, ref: string, subject: string, preview: string) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'] }, status: 'ACTIVE' },
    select: { id: true },
    take: 25,
  });
  if (staff.length === 0) return;
  await prisma.notification.createMany({
    data: staff.map((s) => ({
      userId: s.id,
      type: 'SUPPORT_REPLY' as const,
      title: `Ticket ${ref} needs staff`,
      body: `${subject} — ${preview.slice(0, 120)}`,
      data: { ticketId, area: 'support' },
    })),
  });
}

export async function createTicket(
  userId: string,
  input: CreateInput,
  attachmentPath: string | null,
) {
  const { ticket, message } = await prisma.$transaction(async (tx) => {
    const t = await tx.supportTicket.create({
      data: {
        userId,
        category: input.category,
        subject: input.subject,
        priority: input.priority,
      },
    });
    const m = await tx.supportMessage.create({
      data: {
        ticketId: t.id,
        senderId: userId,
        isStaff: false,
        body: input.message,
        attachment: attachmentPath,
      },
    });
    return { ticket: t, message: m };
  });

  await notifyStaff(ticket.id, ticketRef(ticket.id), ticket.subject, input.message);
  return {
    id: ticket.id,
    ref: ticketRef(ticket.id),
    category: ticket.category,
    subject: ticket.subject,
    priority: ticket.priority,
    status: ticket.status,
    createdAt: ticket.createdAt,
    message,
  };
}

export async function listMyTickets(userId: string, q: ListQuery) {
  const where: Prisma.SupportTicketWhereInput = {
    userId,
    ...(q.status ? { status: q.status } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: { body: true, isStaff: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
    }),
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
  ]);

  return {
    page: q.page,
    pageSize: q.pageSize,
    total,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    tickets: rows.map((t) => ({
      id: t.id,
      ref: ticketRef(t.id),
      category: t.category,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      replies: Math.max(0, t._count.messages - 1),
      lastMessage: t.messages[0]
        ? { preview: t.messages[0].body.slice(0, 140), isStaff: t.messages[0].isStaff, at: t.messages[0].createdAt }
        : null,
    })),
  };
}

async function ownedTicket(userId: string, ticketId: string) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound('Ticket not found.');
  if (ticket.userId !== userId) throw forbidden('This ticket belongs to another player.');
  return ticket;
}

export async function myTicketThread(userId: string, ticketId: string) {
  const ticket = await ownedTicket(userId, ticketId);
  const messages = await prisma.supportMessage.findMany({
    where: { ticketId },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { username: true, role: true } } },
  });
  return {
    id: ticket.id,
    ref: ticketRef(ticket.id),
    category: ticket.category,
    subject: ticket.subject,
    priority: ticket.priority,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      isStaff: m.isStaff,
      sender: m.isStaff ? (m.sender?.username ?? 'Staff') : 'You',
      senderRole: m.sender?.role ?? null,
      attachment: m.attachment ? `/api/support/attachments/${m.id}` : null,
      createdAt: m.createdAt,
    })),
  };
}

export async function replyMyTicket(
  userId: string,
  ticketId: string,
  body: string,
  attachmentPath: string | null,
) {
  const ticket = await ownedTicket(userId, ticketId);
  if (ticket.status === 'CLOSED') {
    throw badRequest('TICKET_CLOSED', 'This ticket is closed. Please open a new one.');
  }
  const message = await prisma.supportMessage.create({
    data: { ticketId, senderId: userId, isStaff: false, body, attachment: attachmentPath },
  });
  // Player answered — staff attention needed again.
  const status = ticket.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'OPEN';
  await prisma.supportTicket.update({ where: { id: ticketId }, data: { status } });
  await notifyStaff(ticketId, ticketRef(ticketId), ticket.subject, body);
  return { id: message.id, createdAt: message.createdAt, status };
}

export async function closeMyTicket(userId: string, ticketId: string) {
  const ticket = await ownedTicket(userId, ticketId);
  if (ticket.status === 'CLOSED') return { status: 'CLOSED' };
  await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'CLOSED' } });
  return { status: 'CLOSED' };
}

/** Owner-or-staff gate for attachment downloads (mirrors deposit screenshots). */
export async function ticketAttachmentPath(userId: string, role: string, messageId: string): Promise<string> {
  const message = await prisma.supportMessage.findUnique({
    where: { id: messageId },
    include: { ticket: { select: { userId: true } } },
  });
  if (!message?.attachment) throw notFound('Attachment not found.');
  const isStaff = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(role);
  if (message.ticket.userId !== userId && !isStaff) {
    throw forbidden('This attachment belongs to another player.');
  }
  // attachment is stored as `tickets/<file>` relative to UPLOAD_ROOT
  const rel = message.attachment.replace(/^\/uploads\//, '');
  return rel;
}
