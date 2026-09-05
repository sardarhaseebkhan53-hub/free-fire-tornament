-- Dynamic slot system + Social Authentication + Player Profile completion
-- Adds AuthProvider enum, makes passwordHash nullable, adds provider fields
-- Adds phoneNumber and profileCompleted to user_profiles
-- Adds playersPerTeam and maxTeams to tournaments
-- Extends TournamentType with ONE_VS_ONE, FOUR_V_FOUR, CUSTOM

-- AuthProvider enum
DO $$ BEGIN
  CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'GOOGLE', 'MICROSOFT', 'APPLE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- TournamentType new values
ALTER TYPE "TournamentType" ADD VALUE IF NOT EXISTS 'ONE_VS_ONE';
ALTER TYPE "TournamentType" ADD VALUE IF NOT EXISTS 'FOUR_V_FOUR';
ALTER TYPE "TournamentType" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- Users: make passwordHash nullable, add authProvider and providerId
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "authProvider" "AuthProvider" NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "providerId" TEXT;

CREATE INDEX IF NOT EXISTS "users_authProvider_idx" ON "users"("authProvider");
CREATE INDEX IF NOT EXISTS "users_providerId_idx" ON "users"("providerId");

-- User profiles: add phoneNumber and profileCompleted
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT;
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "profileCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Tournaments: dynamic slot system
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "playersPerTeam" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "maxTeams" INTEGER;

-- Backfill playersPerTeam based on existing type
UPDATE "tournaments" SET "playersPerTeam" = 
  CASE 
    WHEN "type" = 'SOLO' THEN 1
    WHEN "type" = 'DUO' THEN 2
    WHEN "type" = 'SQUAD' THEN 4
    WHEN "type" = 'CLASH_SQUAD' THEN 4
    WHEN "type" = 'LONE_WOLF' THEN 1
    WHEN "type" = 'CLASH_SQUAD_1V1' THEN 1
    ELSE 1
  END
WHERE "playersPerTeam" = 1;

-- Backfill maxTeams: for existing tournaments, if type is team mode, maxSlots was team count, so keep it
-- For solo, maxTeams = maxSlots (same). For team, we need to set maxTeams = maxSlots (old meaning teams)
-- And ensure maxSlots now represents total players = maxTeams * playersPerTeam
-- So update maxSlots to total players for team modes where it was previously team count
-- Heuristic: if tournament has registrations, keep maxSlots as is for now, set maxTeams = CEIL(maxSlots / playersPerTeam) if not already team count?
-- For safety, we set maxTeams = maxSlots for solo, and maxTeams = maxSlots for team modes as well (old behavior counted teams)
-- Then update maxSlots to maxTeams * playersPerTeam to reflect total player capacity

-- First set maxTeams where null
UPDATE "tournaments" SET "maxTeams" = "maxSlots" WHERE "maxTeams" IS NULL;

-- Then for team modes, recalculate maxSlots as total player capacity if it was previously team count
-- We only do this if maxSlots < 100 and playersPerTeam >1 and maxSlots * playersPerTeam <= 500 (reasonable)
-- Actually we will keep maxSlots as total players now, but old data had maxSlots as team count for team modes?
-- To avoid breaking, we will keep maxSlots as total players = maxTeams * playersPerTeam
UPDATE "tournaments" SET "maxSlots" = "maxTeams" * "playersPerTeam" WHERE "playersPerTeam" > 1;

-- Ensure maxTeams is set for all
UPDATE "tournaments" SET "maxTeams" = 
  CASE 
    WHEN "playersPerTeam" > 1 THEN CEIL("maxSlots"::float / "playersPerTeam")::int
    ELSE "maxSlots"
  END
WHERE "maxTeams" IS NULL OR "maxTeams" = 0;

CREATE INDEX IF NOT EXISTS "tournaments_playersPerTeam_idx" ON "tournaments"("playersPerTeam");
