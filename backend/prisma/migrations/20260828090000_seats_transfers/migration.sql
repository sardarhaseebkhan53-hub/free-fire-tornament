-- Phase: 48-seat allocation + user-to-user wallet transfers.
--
-- 1. tournament_registrations.seatNumber — the player's assigned seat/slot
--    (1..maxSlots). Assigned atomically in the join transaction; team modes
--    share one seat across members. Backfilled from registration order below.
-- 2. WalletTxType gains TRANSFER_SENT / TRANSFER_RECEIVED / REFUND.
-- 3. wallet_transfers — peer-to-peer transfers with an idempotency key.

-- ---------------------------------------------------------------------------
-- Seats
-- ---------------------------------------------------------------------------
ALTER TABLE "tournament_registrations" ADD COLUMN "seatNumber" INTEGER;

CREATE INDEX "tournament_registrations_tournamentId_seatNumber_idx"
  ON "tournament_registrations"("tournamentId", "seatNumber");

-- Backfill existing confirmed registrations in registration order. SOLO rows
-- get their own rank; team-mode rows share the earliest rank of their team.
WITH ranked AS (
  SELECT
    "id",
    "tournamentId",
    "teamId",
    ROW_NUMBER() OVER (PARTITION BY "tournamentId" ORDER BY "registeredAt", "id") AS rn
  FROM "tournament_registrations"
  WHERE "status" = 'CONFIRMED'
),
team_seat AS (
  SELECT "tournamentId", "teamId", MIN(rn) AS seat
  FROM ranked
  WHERE "teamId" IS NOT NULL
  GROUP BY "tournamentId", "teamId"
)
UPDATE "tournament_registrations" tr
SET "seatNumber" = sub.seat
FROM (
  SELECT r."id", CASE WHEN r."teamId" IS NULL THEN r.rn ELSE ts.seat END AS seat
  FROM ranked r
  LEFT JOIN team_seat ts
    ON ts."tournamentId" = r."tournamentId" AND ts."teamId" = r."teamId"
) sub
WHERE tr."id" = sub."id" AND tr."seatNumber" IS NULL;

-- ---------------------------------------------------------------------------
-- Ledger types for transfers
-- ---------------------------------------------------------------------------
ALTER TYPE "WalletTxType" ADD VALUE 'TRANSFER_SENT';
ALTER TYPE "WalletTxType" ADD VALUE 'TRANSFER_RECEIVED';
ALTER TYPE "WalletTxType" ADD VALUE 'REFUND';

-- ---------------------------------------------------------------------------
-- Wallet transfers
-- ---------------------------------------------------------------------------
CREATE TABLE "wallet_transfers" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "senderTxId" TEXT,
    "recipientTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_transfers_senderId_requestId_key"
  ON "wallet_transfers"("senderId", "requestId");
CREATE INDEX "wallet_transfers_senderId_createdAt_idx"
  ON "wallet_transfers"("senderId", "createdAt");
CREATE INDEX "wallet_transfers_recipientId_createdAt_idx"
  ON "wallet_transfers"("recipientId", "createdAt");
CREATE INDEX "wallet_transfers_createdAt_idx"
  ON "wallet_transfers"("createdAt");

ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
