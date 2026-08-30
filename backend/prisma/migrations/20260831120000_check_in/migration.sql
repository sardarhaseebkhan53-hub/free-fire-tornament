-- PHASE 19 — check-in for paid seats.
--
-- A paid registration entitles a player to a seat; it does not prove they showed up.
-- Before this, room credentials and results had no notion of attendance, and an
-- absent team silently consumed a slot the operator could not reassign or explain.
--
-- Additive only: existing rows keep checkedInAt = NULL, which the read side treats as
-- "not checked in yet" — never as corruption. The two nullable tournament columns let
-- an admin set an explicit window; when they are NULL the window is DERIVED from the
-- tournament's own timestamps (open at registrationDeadline, close at startTime), so
-- every existing event has a working check-in without a backfill.
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "checkInOpensAt" TIMESTAMPTZ;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "checkInClosesAt" TIMESTAMPTZ;

ALTER TABLE "tournament_registrations" ADD COLUMN IF NOT EXISTS "checkedInAt" TIMESTAMPTZ;
ALTER TABLE "tournament_registrations" ADD COLUMN IF NOT EXISTS "noShowAt" TIMESTAMPTZ;

-- The scheduler's no-show pass scans by (tournament, checkedInAt IS NULL) at start time.
CREATE INDEX IF NOT EXISTS "tournament_registrations_tournamentId_checkedInAt_idx"
  ON "tournament_registrations"("tournamentId", "checkedInAt");
-- Due-window lookups for the check-in deadline pass.
CREATE INDEX IF NOT EXISTS "tournaments_checkInClosesAt_idx"
  ON "tournaments"("checkInClosesAt");
