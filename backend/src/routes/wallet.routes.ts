// /api/wallet — balances, ledger history, manual deposits and withdrawals.
// Screenshots come in as multipart uploads; everything else is JSON.
import { Router, type NextFunction, type Request } from 'express';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ok } from '../lib/respond';
import { badRequest } from '../lib/errors';
import { env } from '../lib/env';
import { requireScreenshot, UPLOAD_ROOT } from '../lib/upload';
import {
  convertCoinsSchema, depositSchema, transactionsQuerySchema, withdrawalSchema,
} from '../validation/wallet.schema';
import {
  convertCashToCoins, listTransactions, transactionsCsv, walletOverview,
} from '../services/wallet.service';
import {
  cancelWithdrawal, createDeposit, getDepositScreenshotPath, listActivePaymentAccounts,
  listMyDeposits, listMyWithdrawals, requestWithdrawal,
} from '../services/payment.service';

export const walletRouter = Router();

const ctxOf = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 200) });

function parseTypes(raw?: string) {
  if (!raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

walletRouter.get('/', requireAuth, async (req, res) => {
  return ok(res, await walletOverview(req.auth!.id));
});

walletRouter.get('/transactions', requireAuth, async (req, res) => {
  const q = transactionsQuerySchema.parse(req.query);
  const filter = {
    page: q.page,
    pageSize: q.pageSize,
    types: parseTypes(q.type),
    direction: q.direction,
    bucket: q.bucket,
    search: q.search || undefined,
    from: q.from,
    to: q.to,
  };
  if (q.format === 'csv') {
    const csv = await transactionsCsv(req.auth!.id, filter);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="clutchnex-transactions.csv"');
    return res.send(csv);
  }
  return ok(res, await listTransactions(req.auth!.id, filter));
});

walletRouter.get('/payment-accounts', requireAuth, async (_req, res) => {
  return ok(res, { accounts: await listActivePaymentAccounts() });
});

// --- Deposits ---------------------------------------------------------------

walletRouter.get('/deposits', requireAuth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 10));
  return ok(res, await listMyDeposits(req.auth!.id, page, pageSize));
});

walletRouter.post('/deposits', requireAuth, requireScreenshot, async (req, res) => {
  const input = depositSchema.parse(req.body);
  const rel = `deposits/${req.file!.filename}`;
  const out = await createDeposit(req.auth!.id, input, `/uploads/${rel}`, ctxOf(req));
  return ok(res, out, out.note, 201);
});

walletRouter.get('/deposits/:id/screenshot', requireAuth, async (req, res, next: NextFunction) => {
  try {
    const rel = await getDepositScreenshotPath(req.auth!.id, req.auth!.role, String(req.params.id));
    const abs = path.resolve(UPLOAD_ROOT, rel);
    if (!abs.startsWith(UPLOAD_ROOT)) throw badRequest('VALIDATION_ERROR', 'Invalid file path.');
    return res.sendFile(abs);
  } catch (e) {
    return next(e);
  }
});

// --- Withdrawals ------------------------------------------------------------

walletRouter.get('/withdrawals', requireAuth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 10));
  return ok(res, await listMyWithdrawals(req.auth!.id, page, pageSize));
});

walletRouter.post('/withdrawals', requireAuth, async (req, res) => {
  const input = withdrawalSchema.parse(req.body);
  const out = await requestWithdrawal(req.auth!.id, input, ctxOf(req));
  return ok(res, out, 'Withdrawal request submitted — admin approval required.', 201);
});

walletRouter.post('/withdrawals/:id/cancel', requireAuth, async (req, res) => {
  const out = await cancelWithdrawal(req.auth!.id, String(req.params.id), ctxOf(req));
  return ok(res, out, 'Withdrawal cancelled — winnings returned.');
});

// --- Coin conversion ----------------------------------------------------------

walletRouter.post('/coins/convert', requireAuth, async (req, res) => {
  const { amount } = convertCoinsSchema.parse(req.body);
  const out = await convertCashToCoins(req.auth!.id, amount);
  return ok(res, out, `${out.coinsCredited} coins credited.`);
});
