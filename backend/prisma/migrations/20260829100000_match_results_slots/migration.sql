-- =============================================================================
-- Match results workflow + admin slot control + per-tournament scoring (additive).
--
--  1. MatchStatus: add UPCOMING / ROOM_CREATED / ROOM_OPEN (compatible values).
--  2. New MatchResultStatus enum + Match.resultsStatus / resultsPublishedAt / notes.
--  3. MatchParticipant: bonus / penalty / finalScore / prizeAmount / notes /
--     readyAt / absent / evidenceUrl — admin result-entry columns.
--  4. TournamentRegistration: slotLocked / slotNote — admin slot control.
--  5. Tournament: placementPoints (per-tournament placement table),
--     bonusPoints, penaltyPoints defaults.
--  6. Team.joinCode — shareable join links.
--
-- Everything is additive + nullable/defaulted: existing rows keep working and
-- existing code paths (join engine, verification review, prize distribution)
-- are unaffected until the new admin surfaces use these columns.
-- =============================================================================

-- 1. Match statuses ----------------------------------------------------------
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'UPCOMING';
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'ROOM_CREATED';
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'ROOM_OPEN';

-- 2. Results workflow --------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "MatchResultStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'CONFIRMED', 'PUBLISHED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "resultsStatus" "MatchResultStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "resultsPublishedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- 3. Match participants ------------------------------------------------------
ALTER TABLE "match_participants"
  ADD COLUMN IF NOT EXISTS "bonus" INTEGER,
  ADD COLUMN IF NOT EXISTS "penalty" INTEGER,
  ADD COLUMN IF NOT EXISTS "finalScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "prizeAmount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "absent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "evidenceUrl" TEXT;

CREATE INDEX IF NOT EXISTS "match_participants_matchId_finalScore_idx"
  ON "match_participants" ("matchId", "finalScore");

-- 4. Registration slot control ----------------------------------------------
ALTER TABLE "tournament_registrations"
  ADD COLUMN IF NOT EXISTS "slotLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "slotNote" TEXT;

-- 5. Tournament scoring configuration ---------------------------------------
ALTER TABLE "tournaments"
  ADD COLUMN IF NOT EXISTS "placementPoints" JSONB,
  ADD COLUMN IF NOT EXISTS "bonusPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "penaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- 6. Team join codes ---------------------------------------------------------
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "joinCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "teams_joinCode_key" ON "teams" ("joinCode");
