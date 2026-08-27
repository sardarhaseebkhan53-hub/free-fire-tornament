-- Phase 14 — security hardening.
-- Deposit proofs get a content hash so a screenshot reused across accounts or
-- across deposits can be detected (DUPLICATE_PROOF / REUSED_PROOF fraud rules).
ALTER TABLE "deposits" ADD COLUMN "screenshotHash" TEXT;

-- CreateIndex
CREATE INDEX "deposits_screenshotHash_idx" ON "deposits"("screenshotHash");
