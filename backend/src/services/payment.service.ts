// =============================================================================
// Manual payments — deposits (never auto-credited) and withdrawals (debited at
// request time, reversed on rejection). Every financial step is transactional,
// notified, and audited; duplicate transaction IDs are blocked at the DB level.
// =============================================================================
import { Prisma, type DepositStatus, type WithdrawalStatus } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { getSetting } from './settings.service';
import { moveBalance, TX_OPTS } from './wallet.service';
import { fireDepositFraud, fireRejectedDepositTid, fireWithdrawalFraud } from './fraud.service';
import { notifyAdmins } from './notification.service';
import { creditReferralRewardTx } from './referral.service';

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const METHOD_LABEL: Record<string, string> = {
  JAZZCASH: 'JazzCash',
  EASYPAISA: 'EasyPaisa',
  BANK_TRANSFER: 'Bank Transfer',
  NAYAPAY: 'NayaPay',
  SADAPAY: 'SadaPay',
};
/** Methods that read from a Pakistani mobile wallet number (03XXXXXXXXX). */
const MOBILE_WALLET_METHODS = new Set(['JAZZCASH', 'EASYPAISA', 'NAYAPAY', 'SADAPAY']);

interface Ctx { ip?: string; userAgent?: string }

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// ---------------------------------------------------------------------------
// Payment destinations (Add Money page)
// ---------------------------------------------------------------------------

export async function listActivePaymentAccounts() {
  return prisma.paymentAccount.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, method: true, label: true, accountName: true,
      accountNumber: true, extra: true, instructions: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Admin — payment destinations (full control from the admin panel).
// ---------------------------------------------------------------------------

const PAYMENT_ACCOUNT_SELECT = {
  id: true, method: true, label: true, accountName: true, accountNumber: true,
  extra: true, instructions: true, isActive: true, displayOrder: true,
  createdAt: true, updatedAt: true,
} as const;

export async function listPaymentAccounts() {
  return prisma.paymentAccount.findMany({
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    select: PAYMENT_ACCOUNT_SELECT,
  });
}

export interface PaymentAccountInput {
  method: string;
  label: string;
  accountName: string;
  accountNumber: string;
  instructions?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  extra?: Record<string, unknown> | null;
}

export async function createPaymentAccount(adminId: string, input: PaymentAccountInput, ctx: Ctx) {
  const row = await prisma.paymentAccount.create({
    data: {
      method: input.method as never,
      label: input.label,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      instructions: input.instructions || null,
      displayOrder: input.displayOrder ?? 0,
      isActive: input.isActive ?? true,
      extra: input.extra ? (input.extra as Prisma.InputJsonValue) : undefined,
    },
    select: PAYMENT_ACCOUNT_SELECT,
  });
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'PAYMENT_ACCOUNT_CREATED', entity: 'PaymentAccount', entityId: row.id,
      after: { method: row.method, label: row.label },
      ip: ctx.ip, userAgent: ctx.userAgent,
    },
  });
  return row;
}

export async function updatePaymentAccount(adminId: string, id: string, input: PaymentAccountInput, ctx: Ctx) {
  const existing = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!existing) throw notFound('Payment account not found');
  const row = await prisma.paymentAccount.update({
    where: { id },
    data: {
      method: input.method as never,
      label: input.label,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      instructions: input.instructions || null,
      displayOrder: input.displayOrder ?? existing.displayOrder,
      isActive: input.isActive ?? existing.isActive,
      extra: input.extra !== undefined ? (input.extra as Prisma.InputJsonValue) : undefined,
    },
    select: PAYMENT_ACCOUNT_SELECT,
  });
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'PAYMENT_ACCOUNT_UPDATED', entity: 'PaymentAccount', entityId: id,
      before: { method: existing.method, label: existing.label },
      after: { method: row.method, label: row.label },
      ip: ctx.ip, userAgent: ctx.userAgent,
    },
  });
  return row;
}

export async function togglePaymentAccount(adminId: string, id: string, isActive: boolean, ctx: Ctx) {
  const existing = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!existing) throw notFound('Payment account not found');
  const row = await prisma.paymentAccount.update({
    where: { id },
    data: { isActive },
    select: PAYMENT_ACCOUNT_SELECT,
  });
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'PAYMENT_ACCOUNT_TOGGLED', entity: 'PaymentAccount', entityId: id,
      before: { isActive: existing.isActive }, after: { isActive },
      ip: ctx.ip, userAgent: ctx.userAgent,
    },
  });
  return row;
}

export async function deletePaymentAccount(adminId: string, id: string, ctx: Ctx) {
  const existing = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!existing) throw notFound('Payment account not found');
  await prisma.paymentAccount.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      actorId: adminId, action: 'PAYMENT_ACCOUNT_DELETED', entity: 'PaymentAccount', entityId: id,
      before: { method: existing.method, label: existing.label },
      ip: ctx.ip, userAgent: ctx.userAgent,
    },
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export async function createDeposit(
  userId: string,
  input: { amount: number; method: 'JAZZCASH' | 'EASYPAISA' | 'BANK_TRANSFER' | 'NAYAPAY' | 'SADAPAY'; transactionId: string; senderName: string; senderAccount?: string },
  screenshotPath: string,
  ctx: Ctx,
  screenshotHash?: string,
) {
  const min = Number(await getSetting('wallet.minDeposit', 100));
  const max = Number(await getSetting('wallet.maxDeposit', 25000));
  if (input.amount < min) throw badRequest('VALIDATION_ERROR', `Minimum deposit is PKR ${min}.`);
  if (input.amount > max) throw badRequest('VALIDATION_ERROR', `Maximum deposit is PKR ${max}.`);

  const existing = await prisma.deposit.findUnique({ where: { transactionId: input.transactionId } });
  if (existing) {
    // Phase 14 — a TID another account already claimed is a fraud signal, not
    // just a validation error (the insert never happens, so nothing else sees it).
    if (existing.userId !== userId) {
      fireRejectedDepositTid(userId, input.transactionId, existing.id, input.amount, ctx);
    }
    throw conflict('DUPLICATE_TRANSACTION', 'This transaction ID has already been submitted — each payment can be claimed only once.');
  }

  const bonusPct = Number(await getSetting('wallet.depositBonusPercent', 0));

  let dep;
  try {
    dep = await prisma.deposit.create({
      data: {
        userId,
        amount: new Prisma.Decimal(input.amount),
        method: input.method,
        transactionId: input.transactionId,
        senderName: input.senderName,
        senderAccount: input.senderAccount || null,
        screenshot: screenshotPath,
        screenshotHash: screenshotHash || null,
        status: 'PENDING',
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw conflict('DUPLICATE_TRANSACTION', 'This transaction ID has already been submitted — each payment can be claimed only once.');
    }
    throw e;
  }

  await prisma.notification.create({
    data: {
      userId,
      type: 'SYSTEM',
      title: 'Deposit submitted for review',
      body: `Your ${METHOD_LABEL[input.method]} deposit of PKR ${input.amount} (TID ${input.transactionId}) is pending manual verification. You will be notified once it is approved.`,
      data: { depositId: dep.id },
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: userId, action: 'DEPOSIT_SUBMITTED', entity: 'Deposit', entityId: dep.id,
      after: { amount: input.amount, method: input.method, tid: input.transactionId },
      ip: ctx.ip, userAgent: ctx.userAgent,
    },
  });

  // Manual verification queue — alert every admin (drives the bell + sound).
  const depositor = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  await notifyAdmins({
    type: 'SYSTEM',
    title: 'New deposit pending review 💰',
    body: `PKR ${input.amount} via ${METHOD_LABEL[input.method]} from ${depositor?.username ?? 'a player'} — TID ${input.transactionId}.`,
    data: { depositId: dep.id, area: 'deposits' },
  });

  // Phase 14 — detection runs AFTER the row commits, off the request path.
  fireDepositFraud(dep.id, ctx);

  return {
    deposit: serializeDeposit(dep),
    bonusPercent: bonusPct,
    note: 'Payment submitted — balance is credited after manual verification.',
  };
}

export async function listMyDeposits(userId: string, page: number, pageSize: number) {
  const [rows, total] = await Promise.all([
    prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.deposit.count({ where: { userId } }),
  ]);
  return { items: rows.map(serializeDeposit), page, pageSize, total };
}

/** Screenshot access — owner or ADMIN+. Streams the stored upload. */
export async function getDepositScreenshotPath(userId: string, role: string, depositId: string) {
  const dep = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!dep) throw notFound('Deposit not found');
  if (dep.userId !== userId && !['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(role)) {
    throw forbidden('You can only view your own deposit proofs.');
  }
  // screenshot is stored as "/uploads/<relative>" — strip the mount prefix.
  return dep.screenshot.replace(/^\/uploads\//, '');
}

function serializeDeposit(d: {
  id: string; amount: Prisma.Decimal; method: string; transactionId: string;
  senderName: string; senderAccount: string | null; status: string;
  adminNote: string | null; reviewedAt: Date | null; createdAt: Date;
}) {
  return {
    id: d.id,
    amount: num(d.amount),
    method: d.method,
    methodLabel: METHOD_LABEL[d.method],
    transactionId: d.transactionId,
    senderName: d.senderName,
    senderAccount: d.senderAccount,
    status: d.status,
    adminNote: d.adminNote,
    reviewedAt: d.reviewedAt,
    createdAt: d.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Withdrawals — approval chain: PENDING → APPROVED → PROCESSING → PAID
// (any active state may be REJECTED → ledger reversal).
// ---------------------------------------------------------------------------

export async function requestWithdrawal(
  userId: string,
  input: { amount: number; method: 'JAZZCASH' | 'EASYPAISA' | 'BANK_TRANSFER' | 'NAYAPAY' | 'SADAPAY'; accountName: string; accountNumber: string; accountDetails?: string },
  ctx: Ctx,
) {
  const min = Number(await getSetting('wallet.minWithdrawal', 100));
  const feePct = Number(await getSetting('wallet.withdrawalFeePercent', 0));
  if (input.amount < min) throw badRequest('VALIDATION_ERROR', `Minimum withdrawal is PKR ${min}.`);

  const acc = input.accountNumber.replaceAll(/[\s-]/g, '');
  if (MOBILE_WALLET_METHODS.has(input.method) && !/^03\d{9}$/.test(acc)) {
    throw badRequest('VALIDATION_ERROR', `Enter a valid ${METHOD_LABEL[input.method]} mobile number (03XXXXXXXXX).`);
  }
  if (input.method === 'BANK_TRANSFER' && !/^[A-Za-z0-9]{8,34}$/.test(acc)) {
    throw badRequest('VALIDATION_ERROR', 'Enter a valid account number or IBAN.');
  }

  const fee = round2((input.amount * feePct) / 100);
  const reference = `WDL${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
  const masked = acc.length > 6 ? `${acc.slice(0, 4)}••••${acc.slice(-3)}` : acc;
  const currency = await getSetting('platform.currency', 'PKR');

  const out = await prisma.$transaction(async (tx) => {
    const wd = await tx.withdrawal.create({
      data: {
        userId,
        amount: new Prisma.Decimal(input.amount),
        method: input.method,
        accountName: input.accountName,
        accountNumber: acc,
        accountDetails: input.accountDetails || null,
        status: 'PENDING',
      },
    });
    // Debit happens NOW (holding) — rejection reverses it. Insufficient
    // winning balance throws before anything is written.
    const entry = await moveBalance(tx, userId, 'WINNING', 'DEBIT', input.amount, 'WITHDRAWAL', {
      entityType: 'Withdrawal',
      entityId: wd.id,
      reference,
      description: `Withdrawal to ${METHOD_LABEL[input.method]} ${masked} — pending review`,
    }, currency);
    await tx.withdrawal.update({ where: { id: wd.id }, data: { walletTxId: entry.id } });

    await tx.notification.create({
      data: {
        userId,
        type: 'WITHDRAWAL_UPDATE',
        title: 'Withdrawal request received',
        body: `PKR ${input.amount} from your Winning balance is under review${fee > 0 ? ` (fee PKR ${fee})` : ''}. Payouts complete within 24–48 hours.`,
        data: { withdrawalId: wd.id },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId, action: 'WITHDRAWAL_REQUESTED', entity: 'Withdrawal', entityId: wd.id,
        after: { amount: input.amount, method: input.method, fee, reference },
        ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return wd;
  }, TX_OPTS);

  // Phase 14 — churn / burst / new-account / shared-payout checks.
  fireWithdrawalFraud(out.id, ctx);

  // Payout queue — alert every admin (drives the bell + sound).
  await notifyAdmins({
    type: 'SYSTEM',
    title: 'New withdrawal request 💸',
    body: `PKR ${input.amount} to ${METHOD_LABEL[input.method]} ${masked} — pending review.`,
    data: { withdrawalId: out.id, area: 'withdrawals' },
  });

  return { withdrawal: serializeWithdrawal(out), fee, net: round2(input.amount - fee) };
}

export async function listMyWithdrawals(userId: string, page: number, pageSize: number) {
  const [rows, total] = await Promise.all([
    prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.withdrawal.count({ where: { userId } }),
  ]);
  return { items: rows.map(serializeWithdrawal), page, pageSize, total };
}

/** Player cancels a still-PENDING withdrawal → holding released. */
export async function cancelWithdrawal(userId: string, id: string, ctx: Ctx) {
  const currency = await getSetting('platform.currency', 'PKR');
  return prisma.$transaction(async (tx) => {
    const wd = await tx.withdrawal.findUnique({ where: { id } });
    if (!wd || wd.userId !== userId) throw notFound('Withdrawal not found');
    if (wd.status !== 'PENDING') {
      throw badRequest('CONFLICT', 'Only withdrawals that are still pending can be cancelled.');
    }
    await tx.withdrawal.update({ where: { id }, data: { status: 'CANCELLED', reviewedAt: new Date() } });
    await moveBalance(tx, userId, 'WINNING', 'CREDIT', wd.amount.toNumber(), 'WITHDRAWAL_REVERSAL', {
      entityType: 'Withdrawal',
      entityId: wd.id,
      reference: `WDLR${Date.now()}`,
      description: 'Withdrawal cancelled — amount returned to Winning balance',
    }, currency);
    await tx.notification.create({
      data: {
        userId, type: 'WITHDRAWAL_UPDATE',
        title: 'Withdrawal cancelled',
        body: `PKR ${num(wd.amount)} has been returned to your Winning balance.`,
        data: { withdrawalId: wd.id },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId, action: 'WITHDRAWAL_CANCELLED', entity: 'Withdrawal', entityId: wd.id,
        before: { status: 'PENDING' }, after: { status: 'CANCELLED' }, ip: ctx.ip,
      },
    });
    return { id, status: 'CANCELLED' };
  }, TX_OPTS);
}

function serializeWithdrawal(w: {
  id: string; amount: Prisma.Decimal; method: string; accountName: string;
  accountNumber: string; accountDetails: string | null; status: string;
  adminNote: string | null; paidReference: string | null; reviewedAt: Date | null;
  paidAt: Date | null; createdAt: Date;
}) {
  const acc = w.accountNumber;
  return {
    id: w.id,
    amount: num(w.amount),
    method: w.method,
    methodLabel: METHOD_LABEL[w.method],
    accountName: w.accountName,
    accountMasked: acc.length > 6 ? `${acc.slice(0, 4)}••••${acc.slice(-3)}` : acc,
    accountDetails: w.accountDetails,
    status: w.status,
    adminNote: w.adminNote,
    paidReference: w.paidReference,
    reviewedAt: w.reviewedAt,
    paidAt: w.paidAt,
    createdAt: w.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Admin review (ADMIN+)
// ---------------------------------------------------------------------------

export async function listDeposits(filter: { status?: string; page: number; pageSize: number }) {
  const where: Prisma.DepositWhereInput = filter.status
    ? { status: filter.status as DepositStatus }
    : {};
  const [rows, total] = await Promise.all([
    prisma.deposit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
      include: { user: { select: { username: true, email: true } } },
    }),
    prisma.deposit.count({ where }),
  ]);
  return {
    items: rows.map((d) => ({
      ...serializeDeposit(d),
      user: { username: d.user.username, email: d.user.email },
      screenshot: '/api/wallet/deposits/' + d.id + '/screenshot',
    })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

export async function reviewDeposit(
  adminId: string,
  depositId: string,
  action: 'APPROVE' | 'REJECT',
  note: string,
  ctx: Ctx,
) {
  // Settings reads stay OUTSIDE the transaction (Phase 5 deadlock fix).
  const currency = await getSetting('platform.currency', 'PKR');
  // Referral reward gate: the referrer is paid when the referred player's
  // FIRST approved deposit reaches this minimum (default PKR 100).
  const referralMin = Number(await getSetting('referral.minFirstDeposit', 100));
  const out = await prisma.$transaction(async (tx) => {
    const dep = await tx.deposit.findUnique({ where: { id: depositId } });
    if (!dep) throw notFound('Deposit not found');
    if (dep.status !== 'PENDING') {
      throw conflict('CONFLICT', `This deposit was already ${dep.status.toLowerCase()}.`);
    }
    const now = new Date();
    let walletTxId: string | undefined;

    if (action === 'APPROVE') {
      // Credit happens exactly once — guarded by the PENDING status check above.
      const entry = await moveBalance(tx, dep.userId, 'CASH', 'CREDIT', dep.amount.toNumber(), 'DEPOSIT', {
        entityType: 'Deposit',
        entityId: dep.id,
        reference: dep.transactionId,
        description: `Manual ${METHOD_LABEL[dep.method]} deposit approved`,
        createdById: adminId,
      }, currency);
      walletTxId = entry.id;
    }

    const updated = await tx.deposit.update({
      where: { id: depositId },
      data: {
        status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        adminNote: note || null,
        reviewedById: adminId,
        reviewedAt: now,
        ...(walletTxId ? { walletTxId } : {}),
      },
    });

    if (action === 'APPROVE') {
      // Referral reward: is THIS approval the player's first approved deposit
      // of at least referral.minFirstDeposit? (Row is APPROVED now, so the
      // query includes it. Smaller earlier deposits never qualify — the reward
      // stays PENDING until a qualifying deposit is approved.) If the player
      // was referred, the referrer's PKR-50 reward credits in this SAME
      // transaction, exactly once.
      const firstQualifying = await tx.deposit.findFirst({
        where: {
          userId: dep.userId,
          status: 'APPROVED',
          amount: { gte: new Prisma.Decimal(referralMin) },
        },
        orderBy: { reviewedAt: 'asc' },
        select: { id: true },
      });
      if (firstQualifying?.id === dep.id) {
        await creditReferralRewardTx(tx, dep.userId, 'FIRST_DEPOSIT_APPROVED', currency);
      }
    }

    await tx.notification.create({
      data: {
        userId: dep.userId,
        type: action === 'APPROVE' ? 'DEPOSIT_APPROVED' : 'DEPOSIT_REJECTED',
        title: action === 'APPROVE' ? 'Deposit approved' : 'Deposit rejected',
        body: action === 'APPROVE'
          ? `PKR ${num(dep.amount)} has been added to your Cash balance. Good luck in the arena!`
          : `Your ${METHOD_LABEL[dep.method]} deposit (TID ${dep.transactionId}) could not be verified.${note ? ` Reason: ${note}` : ''} No money was credited — contact support if you believe this is a mistake.`,
        data: { depositId: dep.id },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: action === 'APPROVE' ? 'DEPOSIT_APPROVED' : 'DEPOSIT_REJECTED',
        entity: 'Deposit', entityId: dep.id,
        before: { status: 'PENDING' },
        after: { status: updated.status, amount: num(dep.amount), note: note || null },
        ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return updated;
  }, TX_OPTS);

  return serializeDeposit(out);
}

export async function listWithdrawals(filter: { status?: string; page: number; pageSize: number }) {
  const where: Prisma.WithdrawalWhereInput = filter.status
    ? { status: filter.status as WithdrawalStatus }
    : {};
  const [rows, total] = await Promise.all([
    prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
      include: { user: { select: { username: true, email: true } } },
    }),
    prisma.withdrawal.count({ where }),
  ]);
  return {
    items: rows.map((w) => ({ ...serializeWithdrawal(w), user: { username: w.user.username, email: w.user.email } })),
    page: filter.page, pageSize: filter.pageSize, total,
  };
}

const WITHDRAWAL_FLOW: Record<string, { from: string[]; to: string }> = {
  APPROVE: { from: ['PENDING'], to: 'APPROVED' },
  PROCESS: { from: ['APPROVED'], to: 'PROCESSING' },
  PAID: { from: ['PROCESSING'], to: 'PAID' },
  REJECT: { from: ['PENDING', 'APPROVED', 'PROCESSING'], to: 'REJECTED' },
};

export async function reviewWithdrawal(
  adminId: string,
  withdrawalId: string,
  action: 'APPROVE' | 'PROCESS' | 'PAID' | 'REJECT',
  note: string,
  paidReference: string,
  ctx: Ctx,
) {
  // Settings reads stay OUTSIDE the transaction (Phase 5 deadlock fix).
  const currency = await getSetting('platform.currency', 'PKR');
  const flow = WITHDRAWAL_FLOW[action]!;
  const out = await prisma.$transaction(async (tx) => {
    const wd = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!wd) throw notFound('Withdrawal not found');
    if (!flow.from.includes(wd.status)) {
      throw conflict('CONFLICT', `Cannot ${action.toLowerCase()} a withdrawal in state ${wd.status}.`);
    }
    if (action === 'PAID' && !paidReference) {
      throw badRequest('VALIDATION_ERROR', 'A payout transaction reference is required to mark as paid.');
    }

    let walletTxId: string | undefined;
    if (action === 'REJECT') {
      // Release the holding — winnings go back exactly as they left.
      const entry = await moveBalance(tx, wd.userId, 'WINNING', 'CREDIT', wd.amount.toNumber(), 'WITHDRAWAL_REVERSAL', {
        entityType: 'Withdrawal',
        entityId: wd.id,
        reference: `WDLR${Date.now()}`,
        description: `Withdrawal rejected${note ? ` — ${note}` : ''} — amount returned to Winning balance`,
        createdById: adminId,
      }, currency);
      walletTxId = entry.id;
    }

    const now = new Date();
    const updated = await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: flow.to as WithdrawalStatus,
        adminNote: note || wd.adminNote,
        reviewedById: adminId,
        reviewedAt: now,
        ...(action === 'PAID' ? { paidReference: paidReference ?? '' , paidAt: now } : {}),
        ...(walletTxId ? { walletTxId } : {}),
      },
    });

    const bodies: Record<string, string> = {
      APPROVED: 'Your withdrawal has been approved and is queued for payout.',
      PROCESSING: 'Your withdrawal is being processed — funds arrive within 24–48 hours.',
      PAID: `PKR ${num(wd.amount)} has been paid via ${METHOD_LABEL[wd.method]}. Reference: ${paidReference}.`,
      REJECTED: `Your withdrawal of PKR ${num(wd.amount)} was rejected.${note ? ` Reason: ${note}.` : ''} The amount has been returned to your Winning balance.`,
    };
    await tx.notification.create({
      data: {
        userId: wd.userId, type: 'WITHDRAWAL_UPDATE',
        title: `Withdrawal ${flow.to.toLowerCase()}`,
        body: bodies[flow.to] ?? '',
        data: { withdrawalId: wd.id },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: `WITHDRAWAL_${flow.to}`, entity: 'Withdrawal', entityId: wd.id,
        before: { status: wd.status }, after: { status: flow.to, note: note || null, paidReference: paidReference || null },
        ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return updated;
  }, TX_OPTS);

  return serializeWithdrawal(out);
}
