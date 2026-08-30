-- =============================================================================
-- PHASE 18 — immutable registration roster snapshot.
--
-- Problem this closes: a paid seat's prize split was resolved from the team's
-- LIVE membership at distribution time. A player could be removed after paying
-- (or join a partially paid team after the fact) and the split would silently
-- change. The snapshot freezes WHO the money belongs to at the moment the entry
-- fee is debited.
--
-- Additive only: no column is dropped, no financial row is rewritten. Existing
-- paid team registrations are backfilled from the membership that exists at
-- migration time, so historical payouts stay reproducible instead of falling
-- back to a live read on every distribution. The lookup path (tournamentId,
-- teamId) is already served by the existing "tournament_registrations_teamId_idx"
-- index, so no new index is needed.
-- =============================================================================

ALTER TABLE "tournament_registrations"
  ADD COLUMN "rosterUserIds" JSONB,
  ADD COLUMN "rosterCapturedAt" TIMESTAMP(3);

UPDATE "tournament_registrations" r
SET "rosterUserIds" = s.ids, "rosterCapturedAt" = now()
FROM (
  SELECT tm."teamId" AS team_id, jsonb_agg(tm."userId" ORDER BY tm."userId") AS ids
  FROM "team_members" tm
  GROUP BY tm."teamId"
) s
WHERE r."teamId" = s.team_id
  AND r."status" = 'CONFIRMED'
  AND r."rosterUserIds" IS NULL;
