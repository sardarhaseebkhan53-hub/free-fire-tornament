// /api/matches — My Matches (timed credential release), player result
// submissions, and admin match creation.
import { Router, type NextFunction } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { ok } from '../lib/respond';
import { reqContext, uploadResponseHeaders } from '../lib/security';
import { createMatch, myMatches } from '../services/match.service';
import { resultScreenshotPath, submitResult } from '../services/result.service';
import { createMatchSchema } from '../validation/team.schema';
import { submitResultSchema } from '../validation/result.schema';
import { optionalScreenshot, resolveUploadPath } from '../lib/upload';

export const matchRouter = Router();

// Registered players only — the ONLY endpoint that can return room credentials
matchRouter.get('/my', requireAuth, async (req, res) => {
  return ok(res, await myMatches(req.auth!.id));
});

// Player — submit result proof for a completed match (screenshot optional)
matchRouter.post('/:matchId/result', requireAuth, optionalScreenshot, async (req, res) => {
  const input = submitResultSchema.parse(req.body);
  const screenshot = req.file ? `/uploads/results/${req.file.filename}` : null;
  const sub = await submitResult(
    req.auth!.id,
    String(req.params.matchId),
    input,
    screenshot,
    reqContext(req),
  );
  return ok(res, { id: sub.id, status: sub.status }, 'Result submitted — pending staff verification.', 201);
});

// Owner or staff — result screenshot access
matchRouter.get('/results/:id/screenshot', requireAuth, async (req, res, next: NextFunction) => {
  try {
    const rel = await resultScreenshotPath(req.auth!.id, req.auth!.role, String(req.params.id));
    const abs = resolveUploadPath(rel);
    uploadResponseHeaders(res, rel.split('/').pop() ?? 'screenshot');
    return res.sendFile(abs);
  } catch (e) {
    return next(e);
  }
});

// Admin/moderator — schedule a match (tournament builder uses this in Phase 9)
matchRouter.post('/', requireAuth, requireRole('MODERATOR'), async (req, res) => {
  const body = createMatchSchema.parse(req.body);
  const match = await createMatch(body);
  return ok(res, { id: match.id, matchNumber: match.matchNumber, scheduledAt: match.scheduledAt }, 'Match scheduled', 201);
});
