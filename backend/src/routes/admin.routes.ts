// /api/admin — payment review endpoints (Phase 7 scope: deposits +
// withdrawals). Full admin panel ships in Phase 9 on the same API.
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { ok } from '../lib/respond';
import {
  depositListQuerySchema, depositReviewSchema, withdrawalListQuerySchema, withdrawalReviewSchema,
} from '../validation/wallet.schema';
import { reviewResultSchema, submissionListQuerySchema } from '../validation/result.schema';
import {
  distributePrizes, listSubmissions, reviewResult, tournamentStandings,
} from '../services/result.service';
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

// --- Phase 8 — result verification + prize distribution ----------------------

adminRouter.get('/results', async (req, res) => {
  const q = submissionListQuerySchema.parse(req.query);
  return ok(res, await listSubmissions(q));
});

adminRouter.post('/results/:id/review', async (req, res) => {
  const { action, note, placement, kills } = reviewResultSchema.parse(req.body);
  const out = await reviewResult(
    req.auth!.id, String(req.params.id), action, { note, placement, kills },
    { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 200) },
  );
  return ok(res, out, `Result ${out.status.toLowerCase()}.`);
});

adminRouter.get('/tournaments/:id/results', async (req, res) => {
  return ok(res, await tournamentStandings(String(req.params.id)));
});

adminRouter.post('/tournaments/:id/distribute-prizes', async (req, res) => {
  const out = await distributePrizes(req.auth!.id, String(req.params.id), {
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 200),
  });
  return ok(res, out, `Distributed ${out.totalPaid} PKR across ${out.awards.length} awards.`, 201);
});
