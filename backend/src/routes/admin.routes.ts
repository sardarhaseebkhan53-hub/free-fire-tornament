// /api/admin — the full admin control surface (Phase 9).
// Payments + results review live in their phase services; everything here is
// ADMIN+ and audited.
import { Router, type Request } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { ok } from '../lib/respond';
import {
  adjustBalanceSchema, adToggleSchema, auditLogQuerySchema, blogListQuerySchema,
  createAdSchema, createBlogSchema, createTournamentSchema, fraudListQuerySchema,
  fraudReviewSchema, matchListQuerySchema,
  matchStatusSchema, revenueQuerySchema, financeQuerySchema, settingUpdateSchema, ticketListQuerySchema,
  ticketReplySchema, tournamentStatusSchema, upsertSeoSchema, userListQuerySchema,
  userStatusSchema, blogStatusSchema, paymentAccountSchema, paymentAccountToggleSchema,
} from '../validation/admin.schema';
import { listFraudAlerts, reviewFraudAlert } from '../services/fraud.service';
import { adminWriteLimiter } from '../middleware/rateLimit';
import {
  adjustBalance, adminStats, createAd, createBlog, createTournament, listAds,
  listAuditLogs, listBlog, listMatchesAdmin, listSeo, listSettings, listTickets,
  listTournamentsAdmin, listUsers, replyTicket, revenueAnalytics, setBlogStatus,
  setMatchStatus, setTournamentStatus, setUserStatus, toggleAd, updateSetting,
  upsertSeo,
} from '../services/admin.service';
import { financeCsv, financeDashboard } from '../services/finance.service';
import { listAllTransfers } from '../services/transfer.service';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('ADMIN'));

const ctxOf = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 200) });

// Dashboard + revenue
adminRouter.get('/stats', async (_req, res) => ok(res, await adminStats()));
adminRouter.get('/revenue', async (req, res) => {
  const { days } = revenueQuerySchema.parse(req.query);
  return ok(res, await revenueAnalytics(days));
});

// Wallet transfers — platform-wide audit view
adminRouter.get('/transfers', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(5, Number(req.query.pageSize) || 25));
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  return ok(res, await listAllTransfers({ page, pageSize, search }));
});
// Phase 10 — financial dashboard (full P&L; deposits never conflated with revenue)
adminRouter.get('/finance', async (req, res) => {
  const q = financeQuerySchema.parse(req.query);
  if (q.format === 'csv') {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="clutchnex-financials.csv"');
    return res.send(await financeCsv(q));
  }
  return ok(res, await financeDashboard(q));
});

// Users
adminRouter.get('/users', async (req, res) => ok(res, await listUsers(userListQuerySchema.parse(req.query))));
adminRouter.post('/users/:id/status', async (req, res) => {
  const { status, reason } = userStatusSchema.parse(req.body);
  return ok(res, await setUserStatus(req.auth!.id, String(req.params.id), status, reason, ctxOf(req)), `User ${status.toLowerCase()}.`);
});
adminRouter.post('/users/:id/adjust-balance', async (req, res) => {
  const input = adjustBalanceSchema.parse(req.body);
  return ok(res, await adjustBalance(req.auth!.id, String(req.params.id), input, ctxOf(req)), 'Balance adjusted and audited.');
});

// Tournaments + builder
adminRouter.get('/tournaments', async (req, res) => {
  const q = userListQuerySchema.partial({ q: true, status: true }).parse(req.query);
  return ok(res, await listTournamentsAdmin({ page: q.page, pageSize: q.pageSize }));
});
adminRouter.post('/tournaments', async (req, res) => {
  const input = createTournamentSchema.parse(req.body);
  return ok(res, await createTournament(req.auth!.id, input, ctxOf(req)), input.publish ? 'Tournament published.' : 'Tournament saved as draft.', 201);
});
adminRouter.post('/tournaments/:id/status', async (req, res) => {
  const { status } = tournamentStatusSchema.parse(req.body);
  return ok(res, await setTournamentStatus(req.auth!.id, String(req.params.id), status, ctxOf(req)), `Tournament ${status.toLowerCase()}.`);
});

// Matches
adminRouter.get('/matches', async (req, res) => {
  const q = matchListQuerySchema.parse(req.query);
  return ok(res, await listMatchesAdmin(q));
});
adminRouter.post('/matches/:id/status', async (req, res) => {
  const { status } = matchStatusSchema.parse(req.body);
  return ok(res, await setMatchStatus(req.auth!.id, String(req.params.id), status, ctxOf(req)), `Match ${status.toLowerCase()}.`);
});

// Payments review (Phase 7 services)
import { depositListQuerySchema, depositReviewSchema, withdrawalListQuerySchema, withdrawalReviewSchema } from '../validation/wallet.schema';
import { reviewResultSchema, submissionListQuerySchema } from '../validation/result.schema';
import {
  listDeposits, listWithdrawals, reviewDeposit, reviewWithdrawal,
  listPaymentAccounts, createPaymentAccount, updatePaymentAccount,
  togglePaymentAccount, deletePaymentAccount,
} from '../services/payment.service';
import { distributePrizes, listSubmissions, reviewResult, tournamentStandings } from '../services/result.service';

adminRouter.get('/deposits', async (req, res) => {
  const q = depositListQuerySchema.parse(req.query);
  return ok(res, await listDeposits(q));
});
adminRouter.post('/deposits/:id/review', async (req, res) => {
  const { action, note } = depositReviewSchema.parse(req.body);
  return ok(res, await reviewDeposit(req.auth!.id, String(req.params.id), action, note, ctxOf(req)), action === 'APPROVE' ? 'Deposit approved and credited.' : 'Deposit rejected.');
});
adminRouter.get('/withdrawals', async (req, res) => {
  const q = withdrawalListQuerySchema.parse(req.query);
  return ok(res, await listWithdrawals(q));
});
adminRouter.post('/withdrawals/:id/review', async (req, res) => {
  const { action, note, paidReference } = withdrawalReviewSchema.parse(req.body);
  const out = await reviewWithdrawal(req.auth!.id, String(req.params.id), action, note, paidReference, ctxOf(req));
  return ok(res, out, `Withdrawal ${out.status.toLowerCase()}.`);
});
// Payment destinations — the Add Money accounts players pay into. Admin controls
// them all (create / edit / toggle / delete), every change audited.
adminRouter.get('/payment-accounts', async (_req, res) => ok(res, await listPaymentAccounts()));
adminRouter.post('/payment-accounts', adminWriteLimiter, async (req, res) => {
  const input = paymentAccountSchema.parse(req.body);
  return ok(res, await createPaymentAccount(req.auth!.id, input, ctxOf(req)), 'Payment account created.');
});
adminRouter.put('/payment-accounts/:id', adminWriteLimiter, async (req, res) => {
  const input = paymentAccountSchema.parse(req.body);
  return ok(res, await updatePaymentAccount(req.auth!.id, String(req.params.id), input, ctxOf(req)), 'Payment account updated.');
});
adminRouter.post('/payment-accounts/:id/toggle', adminWriteLimiter, async (req, res) => {
  const { isActive } = paymentAccountToggleSchema.parse(req.body);
  return ok(res, await togglePaymentAccount(req.auth!.id, String(req.params.id), isActive, ctxOf(req)), 'Payment account updated.');
});
adminRouter.delete('/payment-accounts/:id', adminWriteLimiter, async (req, res) => {
  return ok(res, await deletePaymentAccount(req.auth!.id, String(req.params.id), ctxOf(req)), 'Payment account deleted.');
});

// Results verification (Phase 8 services)
adminRouter.get('/results', async (req, res) => {
  const q = submissionListQuerySchema.parse(req.query);
  return ok(res, await listSubmissions(q));
});
adminRouter.post('/results/:id/review', async (req, res) => {
  const { action, note, placement, kills } = reviewResultSchema.parse(req.body);
  const out = await reviewResult(req.auth!.id, String(req.params.id), action, { note, placement, kills }, ctxOf(req));
  return ok(res, out, `Result ${out.status.toLowerCase()}.`);
});
adminRouter.get('/tournaments/:id/results', async (req, res) => ok(res, await tournamentStandings(String(req.params.id))));
adminRouter.post('/tournaments/:id/distribute-prizes', async (req, res) => {
  const out = await distributePrizes(req.auth!.id, String(req.params.id), ctxOf(req));
  return ok(res, out, `Distributed ${out.totalPaid} PKR across ${out.awards.length} awards.`, 201);
});

// Phase 14 — fraud & abuse review queue
adminRouter.get('/fraud', async (req, res) => {
  const q = fraudListQuerySchema.parse(req.query);
  return ok(res, await listFraudAlerts(q));
});
adminRouter.post('/fraud/:id/review', adminWriteLimiter, async (req, res) => {
  const { action, note } = fraudReviewSchema.parse(req.body);
  const out = await reviewFraudAlert(req.auth!.id, String(req.params.id), action, note, ctxOf(req));
  return ok(res, out, action === 'REVIEWED' ? 'Alert marked reviewed.' : 'Alert dismissed.');
});

// Support
adminRouter.get('/tickets', async (req, res) => {
  const q = ticketListQuerySchema.parse(req.query);
  return ok(res, await listTickets(q));
});
adminRouter.post('/tickets/:id/reply', async (req, res) => {
  const { body, close } = ticketReplySchema.parse(req.body);
  return ok(res, await replyTicket(req.auth!.id, String(req.params.id), body, close), close ? 'Ticket resolved.' : 'Reply sent.');
});

// Blog CMS
adminRouter.get('/blog', async (req, res) => {
  const q = blogListQuerySchema.parse(req.query);
  return ok(res, await listBlog(q));
});
adminRouter.post('/blog', async (req, res) => {
  const input = createBlogSchema.parse(req.body);
  return ok(res, await createBlog(req.auth!.id, input), input.publish ? 'Post published.' : 'Post saved as draft.', 201);
});
adminRouter.post('/blog/:id/status', async (req, res) => {
  const { publish } = blogStatusSchema.parse(req.body);
  return ok(res, await setBlogStatus(req.auth!.id, String(req.params.id), publish), publish ? 'Post published.' : 'Post unpublished.');
});

// Ads
adminRouter.get('/ads', async (_req, res) => ok(res, await listAds()));
adminRouter.post('/ads', async (req, res) => {
  const input = createAdSchema.parse(req.body);
  return ok(res, await createAd(req.auth!.id, input), 'Ad created.', 201);
});
adminRouter.post('/ads/:id/toggle', async (req, res) => {
  const { isActive } = adToggleSchema.parse(req.body);
  return ok(res, await toggleAd(req.auth!.id, String(req.params.id), isActive), isActive ? 'Ad activated.' : 'Ad paused.');
});

// SEO
adminRouter.get('/seo', async (_req, res) => ok(res, await listSeo()));
adminRouter.post('/seo', async (req, res) => {
  const input = upsertSeoSchema.parse(req.body);
  return ok(res, await upsertSeo(req.auth!.id, input), 'SEO settings saved.');
});

// Settings + audit trail
adminRouter.get('/settings', async (_req, res) => ok(res, await listSettings()));
adminRouter.post('/settings', async (req, res) => {
  const { key, value } = settingUpdateSchema.parse(req.body);
  return ok(res, await updateSetting(req.auth!.id, key, value, ctxOf(req)), 'Setting saved.');
});
adminRouter.get('/audit-logs', async (req, res) => {
  const q = auditLogQuerySchema.parse(req.query);
  return ok(res, await listAuditLogs(q));
});
