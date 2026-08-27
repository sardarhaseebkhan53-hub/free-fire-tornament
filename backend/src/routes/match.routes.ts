// /api/matches — My Matches (timed credential release), player result
// submissions, and admin match creation.
import { Router, type NextFunction } from 'express';
import path from 'node:path';
import { requireAuth, requireRole } from '../middleware/auth';
import { ok } from '../lib/respond';
import { badRequest } from '../lib/errors';
import { UPLOAD_ROOT } from '../lib/upload';
import { createMatch, myMatches } from '../services/match.service';
import { resultScreenshotPath, submitResult } from '../services/result.service';
import { createMatchSchema } from '../validation/team.schema';
import { submitResultSchema } from '../validation/result.schema';
import { optionalScreenshot } from '../lib/upload';

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
    { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 200) },
  );
  return ok(res, { id: sub.id, status: sub.status }, 'Result submitted — pending staff verification.', 201);
});

// Owner or staff — result screenshot access
matchRouter.get('/results/:id/screenshot', requireAuth, async (req, res, next: NextFunction) => {
  try {
    const rel = await resultScreenshotPath(req.auth!.id, req.auth!.role, String(req.params.id));
    const abs = path.resolve(UPLOAD_ROOT, rel);
    if (!abs.startsWith(UPLOAD_ROOT)) throw badRequest('VALIDATION_ERROR', 'Invalid file path.');
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
