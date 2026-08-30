// /api/tournaments — join flow, my registrations, coupon preview.
// Entry fees/prizes are NEVER accepted from the client; the server computes
// every amount from the tournament record (security rule §59/§65).
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ok } from '../lib/respond';
import { notFound } from '../lib/errors';
import { couponLimiter, joinLimiter, roomLimiter } from '../middleware/rateLimit';
import { reqContext } from '../lib/security';
import { joinSchema, couponPreviewSchema, checkInSchema } from '../validation/tournament.schema';
import { checkIn } from '../services/checkin.service';
import { playerRoomView } from '../services/room.service';
import {
  cancelRegistration, joinTournament, myRegistrations, previewCoupon,
} from '../services/tournament.service';

export const tournamentRouter = Router();

// Join (auth required) — race-safe, transactional
tournamentRouter.post('/join', requireAuth, joinLimiter, async (req, res) => {
  const input = joinSchema.parse(req.body);
  const ctx = reqContext(req);
  const out = await joinTournament(req.auth!.id, input, ctx.ip, ctx.userAgent);
  return ok(res, out, 'Tournament joined successfully', 201);
});

// Coupon preview before join (auth required — personal limits apply)
tournamentRouter.get('/coupon-preview', requireAuth, couponLimiter, async (req, res) => {
  const q = couponPreviewSchema.parse(req.query);
  const t = await prisma.tournament.findUnique({
    where: { slug: q.tournamentSlug },
    select: { id: true, entryFeePerPlayer: true },
  });
  if (!t) throw notFound('Tournament not found');
  const out = await previewCoupon(q.code, t.id, req.auth!.id, Number(t.entryFeePerPlayer), reqContext(req));
  return ok(res, out);
});

// My registrations / matches (room credentials are added in Phase 6)
tournamentRouter.get('/my', requireAuth, async (req, res) => {
  return ok(res, await myRegistrations(req.auth!.id));
});

// ---------------------------------------------------------------------------
// THE ROOM — the only endpoint anywhere that can return a Room ID / password.
//
// Everything the service does not want a client to see is absent from this
// response by construction (see room.service's playerRoomView): the eligibility
// check and the release check both happen here, server-side, against a freshly
// read row. `Cache-Control: no-store` closes the last window a timed release
// would otherwise leave — a proxy, a back/forward cache or a service worker
// holding an earlier answer and replaying it after the fact, or (worse) replaying
// an unlocked one to someone else.
//
// Declared before `/:slug/cancel` on purpose: the parameter is a tournament slug,
// and a route shape that could shadow `room` must never be reachable that way.
// ---------------------------------------------------------------------------
tournamentRouter.get('/:slug/room', requireAuth, roomLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return ok(res, await playerRoomView(req.auth!.id, String(req.params.slug).slice(0, 120)));
});

// Check in for an event (PHASE 19). Idempotent, window-guarded, seat must be CONFIRMED.
tournamentRouter.post('/check-in', requireAuth, async (req, res) => {
  const input = checkInSchema.parse(req.body);
  const out = await checkIn(req.auth!.id, input.tournamentSlug, reqContext(req));
  return ok(res, out, out.alreadyCheckedIn ? 'Already checked in.' : 'Checked in — see you at the lobby.');
});

// Cancel my registration (captain cancels the whole team in team modes)
tournamentRouter.post('/:slug/cancel', requireAuth, async (req, res) => {
  const out = await cancelRegistration(req.auth!.id, String(req.params.slug).slice(0, 120));
  return ok(res, out, 'Registration cancelled — refund credited.');
});
