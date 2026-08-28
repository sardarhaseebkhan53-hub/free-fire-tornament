// =============================================================================
// Wallet transfers — user-to-user PKR movement (Phase: wallet transfer).
//
// Integrity rules (enforced server-side, never from the client):
//   • the whole transfer is ONE database transaction: debit sender, credit
//     recipient, create transfer row + audit — all or nothing;
//   • balances are only touched through moveBalance (immutable ledger);
//   • self-transfer, non-existent/inactive recipients, negative/zero amounts,
//     below-minimum, above-maximum and over-daily-limit transfers are refused;
//   • a client-generated requestId makes double-submission idempotent;
//   • amounts at/above the configured threshold raise a fraud alert.
// =============================================================================
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { getSetting } from './settings.service';
import { moveBalance, TX_OPTS } from './wallet.service';
import { raiseFraudAlert } from './fraud.service';
import { audit } from '../lib/security';
import { notifyAdmins } from './notification.service';

export interface TransferInput {
  recipientUsername: string;
  amount: number;
  note?: string;
  /** Client-generated idempotency key (uuid). */
  requestId: string;
}

export interface TransferActor {
  ip?: string;
  userAgent?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function createTransfer(senderId: string, input: TransferInput, actor: TransferActor = {}) {
  // All settings reads happen OUTSIDE the transaction (single-writer dev DB
  // deadlock rule — same as the join engine).
  const [
    currency, enabled, minAmount, maxAmount, dailyLimit, highValueThreshold,
  ] = await Promise.all([
    getSetting('platform.currency', 'PKR'),
    getSetting('wallet.transferEnabled', true),
    getSetting('wallet.transferMin', 10),
    getSetting('wallet.transferMax', 25000),
    getSetting('wallet.transferDailyLimit', 50000),
    getSetting('wallet.transferHighValueThreshold', 10000),
  ]);

  if (!enabled) throw badRequest('VALIDATION_ERROR', 'Transfers are temporarily disabled.');

  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest('VALIDATION_ERROR', 'Transfer amount must be a positive number.');
  }
  if (amount < Number(minAmount)) {
    throw badRequest('VALIDATION_ERROR', `Minimum transfer is ${currency} ${Number(minAmount)}.`);
  }
  if (amount > Number(maxAmount)) {
    throw badRequest('VALIDATION_ERROR', `Maximum single transfer is ${currency} ${Number(maxAmount)}.`);
  }
  if (!/^[0-9a-fA-F-]{8,64}$/.test(input.requestId)) {
    throw badRequest('VALIDATION_ERROR', 'Invalid request id.');
  }

  const username = input.recipientUsername.trim();
  const [sender, recipient] = await Promise.all([
    prisma.user.findUnique({ where: { id: senderId }, select: { id: true, username: true, status: true } }),
    prisma.user.findUnique({ where: { username }, select: { id: true, username: true, status: true } }),
  ]);
  if (!sender || sender.status !== 'ACTIVE') throw badRequest('FORBIDDEN', 'Your account is not active.');
  if (!recipient) throw notFound('Recipient not found. Check the username and try again.');
  if (recipient.id === senderId) {
    throw badRequest('VALIDATION_ERROR', 'You cannot transfer money to your own account.');
  }
  if (recipient.status !== 'ACTIVE') {
    throw badRequest('VALIDATION_ERROR', 'That account cannot receive transfers right now.');
  }

  const note = input.note?.trim().slice(0, 140) || null;

  const transfer = await prisma.$transaction(async (tx) => {
    // Idempotency: a replayed request returns the original transfer instead of
    // moving money twice (the unique index is the hard guarantee).
    const existing = await tx.walletTransfer.findUnique({
      where: { senderId_requestId: { senderId, requestId: input.requestId } },
    });
    if (existing) {
      return { transfer: existing, replay: true as const };
    }

    // Daily send limit (server-side; the client can never bypass it).
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const sentToday = await tx.walletTransfer.aggregate({
      where: { senderId, createdAt: { gte: dayStart } },
      _sum: { amount: true },
    });
    const alreadySent = Number(sentToday._sum.amount ?? 0);
    if (round2(alreadySent + amount) > Number(dailyLimit)) {
      throw badRequest(
        'VALIDATION_ERROR',
        `Daily transfer limit reached (${currency} ${Number(dailyLimit)} per day).`,
      );
    }

    const sentEntry = await moveBalance(
      tx, senderId, 'CASH', 'DEBIT', amount, 'TRANSFER_SENT',
      {
        entityType: 'WalletTransfer',
        reference: `to ${recipient.username}`,
        description: note ?? `Transfer to ${recipient.username}`,
      },
      currency,
    );
    const receivedEntry = await moveBalance(
      tx, recipient.id, 'CASH', 'CREDIT', amount, 'TRANSFER_RECEIVED',
      {
        entityType: 'WalletTransfer',
        reference: `from ${sender.username}`,
        description: note ?? `Transfer from ${sender.username}`,
      },
      currency,
    );

    const row = await tx.walletTransfer.create({
      data: {
        senderId,
        recipientId: recipient.id,
        amount: new Prisma.Decimal(amount),
        note,
        requestId: input.requestId,
        senderTxId: sentEntry.id,
        recipientTxId: receivedEntry.id,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: senderId,
        action: 'WALLET_TRANSFER',
        entity: 'WalletTransfer',
        entityId: row.id,
        after: { senderId, recipientId: recipient.id, amount, requestId: input.requestId },
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
    });

    // Both sides get an inbox notification inside the same transaction.
    await tx.notification.createMany({
      data: [
        {
          userId: recipient.id, type: 'ACCOUNT',
          title: `${currency} ${amount} received`,
          body: `${sender.username} sent you ${currency} ${amount}.${note ? ` Note: ${note}` : ''}`,
          data: { transferId: row.id, from: sender.username },
        },
        {
          userId: senderId, type: 'ACCOUNT',
          title: `Transfer sent — ${currency} ${amount}`,
          body: `You sent ${currency} ${amount} to ${recipient.username}.`,
          data: { transferId: row.id, to: recipient.username },
        },
      ],
    });

    return { transfer: row, replay: false as const };
  }, TX_OPTS);

  // Post-commit side effects — must never fail the transfer itself.
  if (!transfer.replay) {
    await Promise.all([
      audit({
        actorId: senderId,
        action: 'WALLET_TRANSFER_COMPLETED',
        entity: 'WalletTransfer',
        entityId: transfer.transfer.id,
        after: { amount, recipient: recipient.username, requestId: input.requestId },
        ip: actor.ip,
        userAgent: actor.userAgent,
      }),
      // High-value movement → fraud team attention.
      amount >= Number(highValueThreshold)
        ? raiseFraudAlert({
            userId: senderId,
            kind: 'HIGH_VALUE_TRANSFER',
            severity: 'MEDIUM',
            subject: transfer.transfer.id,
            details: { transferId: transfer.transfer.id, amount, recipient: recipient.username },
          })
        : Promise.resolve(null),
      notifyAdmins({
        type: 'SYSTEM',
        title: amount >= Number(highValueThreshold) ? 'High-value wallet transfer' : 'Wallet transfer',
        body: `${sender.username} → ${recipient.username}: ${currency} ${amount}`,
        data: { transferId: transfer.transfer.id },
      }),
    ]);
  }

  return {
    transfer: {
      id: transfer.transfer.id,
      senderUsername: sender.username,
      recipientUsername: recipient.username,
      amount,
      note: transfer.transfer.note,
      createdAt: transfer.transfer.createdAt,
    },
    replayed: transfer.replay,
    currency,
  };
}

// ---------------------------------------------------------------------------
// History reads
// ---------------------------------------------------------------------------

function serializeTransfer(t: {
  id: string; amount: Prisma.Decimal; note: string | null; status: string; createdAt: Date;
  sender: { username: string }; recipient: { username: string };
}) {
  return {
    id: t.id,
    amount: Number(t.amount),
    note: t.note,
    status: t.status,
    createdAt: t.createdAt,
    senderUsername: t.sender.username,
    recipientUsername: t.recipient.username,
  };
}

/** Transfers the caller sent or received, newest first. */
export async function myTransfers(userId: string, page = 1, pageSize = 20) {
  const take = Math.min(100, Math.max(5, pageSize));
  const [sent, received, total] = await Promise.all([
    prisma.walletTransfer.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * take,
      take,
      select: {
        id: true, amount: true, note: true, status: true, createdAt: true,
        sender: { select: { username: true } },
        recipient: { select: { username: true } },
      },
    }),
    prisma.walletTransfer.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * take,
      take,
      select: {
        id: true, amount: true, note: true, status: true, createdAt: true,
        sender: { select: { username: true } },
        recipient: { select: { username: true } },
      },
    }),
    prisma.walletTransfer.count({ where: { OR: [{ senderId: userId }, { recipientId: userId }] } }),
  ]);
  return { sent: sent.map(serializeTransfer), received: received.map(serializeTransfer), total };
}

/** Admin view — every transfer on the platform (filterable). */
export async function listAllTransfers(filters: { page: number; pageSize: number; search?: string }) {
  const take = Math.min(200, Math.max(5, filters.pageSize));
  const search = filters.search?.trim();
  const where: Prisma.WalletTransferWhereInput = search
    ? {
        OR: [
          { sender: { username: { contains: search, mode: 'insensitive' } } },
          { recipient: { username: { contains: search, mode: 'insensitive' } } },
          { note: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.walletTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * take,
      take,
      select: {
        id: true, amount: true, note: true, status: true, createdAt: true,
        sender: { select: { username: true } },
        recipient: { select: { username: true } },
      },
    }),
    prisma.walletTransfer.count({ where }),
  ]);
  return { items: items.map(serializeTransfer), page: filters.page, pageSize: take, total };
}

export async function transfersVolume(dayStart: Date) {
  const agg = await prisma.walletTransfer.aggregate({
    where: { createdAt: { gte: dayStart } },
    _sum: { amount: true },
    _count: true,
  });
  return { count: agg._count, volume: Number(agg._sum.amount ?? 0) };
}
