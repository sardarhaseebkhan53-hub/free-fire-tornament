-- =============================================================================
-- Social authentication (Google / Microsoft / Apple) + dynamic tournament slots
--
-- 1. Users may be password-less when they sign in socially; the sign-in method
--    is recorded in authProvider and every provider identity is linked through
--    oauth_accounts (unique per provider subject → no duplicate accounts).
-- 2. Tournament capacity stops being a fixed number: playersPerTeam stores the
--    team size of the format (1 for solo-style modes, admin-set for CUSTOM),
--    so total player capacity is ALWAYS maxSlots × playersPerTeam.
-- =============================================================================

-- --- 1. Social authentication ------------------------------------------------

-- Social-only accounts have no local password.
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- How the account was created / primarily signs in (PASSWORD|GOOGLE|MICROSOFT|APPLE).
ALTER TABLE "users" ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'PASSWORD';

CREATE TABLE "oauth_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_accounts_provider_providerAccountId_key"
    ON "oauth_accounts"("provider", "providerAccountId");

CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

ALTER TABLE "oauth_accounts"
    ADD CONSTRAINT "oauth_accounts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- 2. Dynamic tournament slots ---------------------------------------------

-- CUSTOM: admin-defined format (players-per-team × teams).
ALTER TYPE "TournamentType" ADD VALUE 'CUSTOM';

-- Players per team/group. Backfilled from the mode so every existing event
-- keeps its exact current capacity (maxSlots × playersPerTeam):
--   SOLO / LONE_WOLF / CLASH_SQUAD_1V1 → 1 (a seat is one player)
--   DUO → 2 · SQUAD / CLASH_SQUAD → 4 (a seat is a whole team)
ALTER TABLE "tournaments" ADD COLUMN "playersPerTeam" INTEGER NOT NULL DEFAULT 1;

UPDATE "tournaments"
SET "playersPerTeam" = CASE "type"
    WHEN 'DUO' THEN 2
    WHEN 'SQUAD' THEN 4
    WHEN 'CLASH_SQUAD' THEN 4
    ELSE 1
END;

-- Optional admin label for CUSTOM formats.
ALTER TABLE "tournaments" ADD COLUMN "customLabel" VARCHAR(60);
