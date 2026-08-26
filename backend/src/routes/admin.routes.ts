// /api/admin — payment review endpoints (Phase 7 scope: deposits +
// withdrawals). Full admin panel ships in Phase 9 on the same API.
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { ok } from '../lib/respond';
import {
  depositListQuerySchema, depositReviewSchema, withdrawalListQuerySchema, withdrawalReviewSchema,
} from '../validation/wallet.schema';
import {
  listDeposits, listWithdrawals, reviewDeposit, reviewWithdrawal,
} from '../services/payment.service';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('ADMIN'));

adminRouter.get('/deposits', async (req, res) => {
  const q = depositListQuerySchema.parse(req.query);
  return ok(res, await listDeposits(q));
});

adminRouter.post('/deposits/:id/review', async (req, res) => {
  const { action, note } = depositReviewSchema.parse(req.body);
  const out = await reviewDeposit(req.auth!.id, String(req.params.id), action, note, {
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 200),
  });
  return ok(res, out, action === 'APPROVE' ? 'Deposit approved and credited.' : 'Deposit rejected.');
});

adminRouter.get('/withdrawals', async (req, res) => {
  const q = withdrawalListQuerySchema.parse(req.query);
  return ok(res, await listWithdrawals(q));
});

adminRouter.post('/withdrawals/:id/review', async (req, res) => {
  const { action, note, paidReference } = withdrawalReviewSchema.parse(req.body);
  const out = await reviewWithdrawal(req.auth!.id, String(req.params.id), action, note, paidReference, {
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 200),
  });
  return ok(res, out, `Withdrawal ${out.status.toLowerCase()}.`);
});
