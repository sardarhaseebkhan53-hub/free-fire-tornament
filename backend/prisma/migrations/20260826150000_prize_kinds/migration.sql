-- Prize kinds: PLACEMENT | KILL_POOL | MVP | BONUS
-- Enables the kill-pool budget (mandatory cap) and MVP rewards from the
-- CLUTCHNEX pricing spec. The prize engine (Phase 8) distributes each kind
-- according to tournament rules; kill pools can never exceed their cap.
ALTER TABLE "prizes" ADD COLUMN "kind" TEXT;

-- Per-kill rate and budget cap for KILL_POOL prizes
ALTER TABLE "prizes" ADD COLUMN "perKill" DECIMAL(14,2);
ALTER TABLE "prizes" ADD COLUMN "cap" DECIMAL(14,2);
