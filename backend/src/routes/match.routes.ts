// /api/matches — My Matches (timed credential release), player result
// submissions, and admin match creation.
import { Router, type NextFunction } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { ok } from '../lib/respond';
import { reqContext, uploadResponseHeaders } from '../lib/security';
import { createMatch, matchTable, myMatches } from '../services/match.service';
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

// Admin/moderator — schedule a match (audited; syncs participants)
matchRouter.post('/', requireAuth, requireRole('MODERATOR'), async (req, res) => {
  const body = createMatchSchema.parse(req.body);
  const ctx = reqContext(req);
  const match = await createMatch(body, req.auth!.id, ctx);
  return ok(res, { id: match.id, matchNumber: match.matchNumber, scheduledAt: match.scheduledAt }, 'Match scheduled', 201);
});

// Staff — export the room-style match table as CSV
matchRouter.get('/:id/export', requireAuth, requireRole('MODERATOR'), async (req, res) => {
  const table = await matchTable(String(req.params.id));
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Slot', 'Player/Team', 'FF Name', 'UID', 'Team', 'Registration', 'Payment', 'Ready', 'Status', 'Position', 'Kills', 'Points', 'Final Score', 'Prize', 'Notes'];
  const lines = [head.map(esc).join(',')];
  for (const r of table.rows) {
    lines.push([r.slot, r.playerOrTeam, r.ign, r.uid, r.team, r.registrationId, r.payment, r.ready ? 'READY' : '—', r.status, r.placement, r.kills, r.points, r.finalScore, r.prize, r.notes]
      .map(esc).join(','));
  }
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="match-${String(req.params.id).slice(0, 8)}.csv"`);
  return res.send(lines.join('\n'));
});
