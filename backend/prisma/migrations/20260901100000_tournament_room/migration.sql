-- TOURNAMENT ROOM MANAGEMENT — an event's Free Fire Room ID / password.
--
-- Until now room credentials existed only per MATCH (Match.roomId/roomPassword with a
-- 30-minute release). Operators run single-room events where the room belongs to the
-- TOURNAMENT, and they need to control it from the tournament itself: enter it while the
-- event is still a draft, update it when a lobby gets locked, hide it, cancel it.
--
-- WHY A SEPARATE TABLE AND NOT A FEW COLUMNS ON `tournaments`
--   A tournament row is read and SPREAD all over this codebase — the public tournament
--   detail response is literally `{ ...core }` over an `include`. Eleven more columns
--   would mean eleven chances for one of those spreads to ship a live room password to
--   every visitor of a public page. On its own table, a response can only carry a
--   credential if a query deliberately selects it, and the release logic lives behind one
--   service. That is the difference between "we remembered to exclude it" and "it was
--   never reachable that way".
--
-- The release INSTANT is deliberately not stored by default: it is derived from the
-- event's `startTime`, so moving an event moves its release with it instead of silently
-- leaving a room unlocked since yesterday. `releaseAt` exists for the admin who wants to
-- pin an exact moment; `releaseMinutes` for one event that needs a different lead than the
-- platform-wide ROOM_RELEASE_MINUTES.
--
-- `status` is a CACHE of the derived state (the read path recomputes it from the
-- timestamps on every request); CANCELLED is the one value only an explicit admin action
-- can set, because a cancellation is a decision rather than a clock.
--
-- Additive only: no tournament gets a row until an admin enters a room, and the absence
-- of a row is exactly what the panel reports as "Room Not Added".
CREATE TYPE "RoomStatus" AS ENUM ('NOT_ADDED', 'SCHEDULED', 'AVAILABLE', 'CANCELLED');

CREATE TABLE IF NOT EXISTS "tournament_rooms" (
  "id"             TEXT NOT NULL,
  "tournamentId"   TEXT NOT NULL,
  "roomId"         TEXT,
  "roomPassword"   TEXT,
  "status"         "RoomStatus" NOT NULL DEFAULT 'NOT_ADDED',
  "releaseAt"      TIMESTAMPTZ,
  "releaseMinutes" INTEGER,
  "releasedAt"     TIMESTAMPTZ,
  "hiddenAt"       TIMESTAMPTZ,
  "cancelledAt"    TIMESTAMPTZ,
  "cancelReason"   TEXT,
  "note"           TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "tournament_rooms_pkey" PRIMARY KEY ("id"),
  -- CASCADE with the event: a soft-deleted tournament keeps its row (and its audit
  -- trail); a hard-deleted draft takes its room with it, so no orphan credential can
  -- outlive the event it belonged to.
  CONSTRAINT "tournament_rooms_tournamentId_fkey" FOREIGN KEY ("tournamentId")
    REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One room per event. The unique index is also the upsert key, so two admins saving the
-- room at the same moment cannot fork an event into two rooms.
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_rooms_tournamentId_key" ON "tournament_rooms"("tournamentId");
-- The release sweep filters on the cached status, then re-derives from the event's clock.
CREATE INDEX IF NOT EXISTS "tournament_rooms_status_idx" ON "tournament_rooms"("status");
