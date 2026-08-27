// =============================================================================
// /api/nexa — the NEXA assistant endpoint (Phase 11).
//
// Public (works for guests and signed-in players), heavily rate-limited, and
// deliberately READ-ONLY: the engine answers questions; it has no routes that
// mutate anything. Swapping in a real AI later means implementing NexaEngine
// and changing one line below.
// =============================================================================
import { Router } from 'express';
import { ok } from '../lib/respond';
import { nexaLimiter } from '../middleware/rateLimit';
import { nexaAskSchema } from '../validation/support.schema';
import { nexaContext, ruleEngine } from '../services/nexa.service';

export const nexaRouter = Router();

nexaRouter.post('/', nexaLimiter, async (req, res) => {
  const { message } = nexaAskSchema.parse(req.body);
  const ctx = await nexaContext();
  // Register the active engine here — ruleEngine today, a real AI tomorrow.
  const engine = ruleEngine;
  const answer = await engine.answer(message, ctx);
  return ok(res, {
    engine: engine.name,
    intent: answer.intent,
    reply: answer.reply,
    quickReplies: answer.quickReplies,
    guarded: answer.guarded,
    limits: 'NEXA answers questions only — it never approves payments, changes balances or reveals room credentials.',
  });
});
