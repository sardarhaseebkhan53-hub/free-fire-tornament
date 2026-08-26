// /api/matches — My Matches (timed credential release) + admin match creation.
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { ok } from '../lib/respond';
import { createMatch, myMatches } from '../services/match.service';
import { createMatchSchema } from '../validation/team.schema';

export const matchRouter = Router();

// Registered players only — the ONLY endpoint that can return room credentials
matchRouter.get('/my', requireAuth, async (req, res) => {
  return ok(res, await myMatches(req.auth!.id));
});

// Admin/moderator — schedule a match (tournament builder uses this in Phase 9)
matchRouter.post('/', requireAuth, requireRole('MODERATOR'), async (req, res) => {
  const body = createMatchSchema.parse(req.body);
  const match = await createMatch(body);
  return ok(res, { id: match.id, matchNumber: match.matchNumber, scheduledAt: match.scheduledAt }, 'Match scheduled', 201);
});
